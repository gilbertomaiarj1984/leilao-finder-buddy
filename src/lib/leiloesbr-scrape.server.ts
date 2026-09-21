import { parse, type HTMLElement } from "node-html-parser";

import { publicFetch, BASE_URL } from "./leiloesbr-auth.server";
import {
  decodeHtmlEntities,
  extractArtist,
  looksNonVinyl,
  parseInfoLine,
  upcomingDayKeys,
  type VinylLot,
} from "./vinyl-parse";

const VINYL_CATEGORY = "|446973636F2064652076696E696C|";
const PER_PAGE = 126;
const WINDOW_DAYS = 5; // quantos dias de leilões trazer (hoje + próximos)
const MAX_PAGES = 150; // teto de páginas por varredura (janela maior = mais páginas)

// Cache/merge em memória: GARANTE a lista mesmo que o banco esteja indisponível
// (ex.: migração ainda não aplicada). O banco é usado como camada durável quando
// disponível — a UI nunca fica vazia por causa do banco.
let memCache: { at: number; days: string[]; lots: VinylLot[]; updatedAt: string | null } | null =
  null;

// TTL curto para pular a releitura da tabela `lots` (janela inteira) quando o mesmo
// processo atende chamadas em sequência rápida — é o caso do laço do cron
// (`aieval`/`aiident`/`market` chamam `scrapeVinylLots(false)` a cada iteração) e de
// navegação normal no app. Reduz consultas ao Postgres sem mudar o resultado visível
// (a mesma janela não muda de um segundo para o outro). Best-effort: se o cache em
// memória estiver vazio (ex.: logo após um restart), cai no caminho normal de sempre.
const SNAPSHOT_TTL_MS = 30_000;

function listUrl(page: number): string {
  const params = new URLSearchParams({
    pesquisa: "",
    op: "3",
    v: String(PER_PAGE),
    b: "0",
    pag: String(page),
  });
  return `${BASE_URL}/busca_andamento.asp?${params.toString()}&tp=${VINYL_CATEGORY}`;
}

// A varredura geral é pública: buscamos deslogados para evitar o 500 intermitente
// que o site devolve em sessões autenticadas sob carga. O login fica só para a vigia.
async function fetchPage(page: number): Promise<string> {
  return await publicFetch(listUrl(page), {});
}

function absolute(href: string | undefined): string {
  if (!href) return BASE_URL;
  if (/^https?:/i.test(href)) return href;
  return `${BASE_URL}/${href.replace(/^\//, "")}`;
}

function parseCard(card: HTMLElement): VinylLot | null {
  const link = card.querySelector('a[href*="abre_catalogo.asp"]');
  const href = link?.getAttribute("href");
  if (!href) return null;

  const titleAnchor = card.querySelector(".product-title a[title]");
  const title = decodeHtmlEntities(
    titleAnchor?.getAttribute("title") ?? card.querySelector("h3")?.text ?? "",
  );
  if (!title) return null;

  const infoNodes = card.querySelectorAll(".mostbidded__info");
  const info = parseInfoLine(infoNodes[0]?.text ?? "");
  if (!info) return null;

  const houseAnchor = infoNodes[infoNodes.length - 1]?.querySelector("a");
  const idMatch = href.match(/\|(\d+)\|(\d+)/);

  // The site emits an unclosed <span> inside the favourite button, so the DOM
  // subtree with the watch anchor is unreliable — read it from the raw markup.
  const raw = card.outerHTML;
  const watchData = (raw.match(/data-watch="([^"]+)"/)?.[1] ?? "").split(",");
  const watched = /class="[^"]*\bwatch\b[^"]*\bativo\b[^"]*"/.test(raw);

  // Número do lote exibido: tenta o atributo title="Lote-XXX"; senão o padrão
  // "Lote:<b>NN</b>" (usado nos cards); por fim, o texto do próprio título.
  const rawFlat = raw.replace(/\s+/g, " ");
  const lote = (
    raw.match(/title="Lote-?\s*([^"]+)"/i)?.[1] ??
    rawFlat.match(/lote\s*:?\s*<b[^>]*>\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
    title.match(/\blote\s*n?[ºo°]?\s*[:.-]?\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  return {
    id: idMatch ? `${idMatch[1]}-${idMatch[2]}` : href,
    idPeca: watchData[0]?.trim() || (idMatch?.[2] ?? ""),
    idLeilao: watchData[2]?.trim() || (idMatch?.[1] ?? ""),
    base: watchData[3]?.trim() || "0",
    lote,
    watched,

    title,
    url: absolute(href),
    image: card.querySelector("img")?.getAttribute("src") ?? null,
    price: (card.querySelector(".venda-price")?.text ?? "").trim(),
    dayKey: info.dayKey,
    time: info.time,
    uf: (card.querySelector(".pesq-uf")?.text ?? "").trim(),
    house: (houseAnchor?.text ?? "Casa não informada").trim(),
    houseUrl: absolute(houseAnchor?.getAttribute("href") ?? undefined),
    artist: extractArtist(title),
  };
}

function parseCards(html: string): VinylLot[] {
  const root = parse(html);
  return root
    .querySelectorAll(".mostbidded .product")
    .map(parseCard)
    .filter((lot): lot is VinylLot => lot !== null);
}

function lastPage(html: string): number {
  const pages = [...html.matchAll(/pag=(\d+)/g)].map((m) => Number(m[1]));
  return pages.length ? Math.max(...pages) : 1;
}

function sortLots(lots: VinylLot[]): VinylLot[] {
  return lots.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      a.house.localeCompare(b.house, "pt-BR") ||
      a.title.localeCompare(b.title, "pt-BR"),
  );
}

/**
 * Percorre as páginas (op=3) coletando lotes de vinil que passem em `keep`, até
 * `MAX_PAGES` ou o fim da listagem.
 *
 * ⚠️ NÃO paramos mais cedo ao achar uma página cujo dia mínimo já passou de
 * `stopDay` — a suposição de que a ordenação das páginas é estritamente
 * monotônica por data (comentário antigo: "os dias mais próximos ficam nas
 * ÚLTIMAS páginas") não se sustenta na prática. Achado real (2026-09-21): o dia
 * 24/9 aparecia com 0 lotes na ferramenta enquanto 21/22/23/25 tinham centenas
 * cada, e casas confirmadas com lotes reais de vinil nesse dia ("Peça Única
 * Colecionismo", "Livros Universo") simplesmente não apareciam. Causa: leilões
 * ficam intercalados na listagem (não ordenados só por data), então uma página
 * com `minDay > stopDay` não garante que TODAS as páginas seguintes também
 * estejam fora da janela — só que aquela página específica está. Parar ali
 * pulava para sempre as páginas restantes (nunca escaneadas), mesmo que
 * contivessem dias dentro da janela. `MAX_PAGES` (150) já é a proteção contra
 * varredura descontrolada; o filtro por `dayKey`/`keep` por item continua
 * sendo quem decide o que entra, não mais um corte por página.
 */
async function scrapePages(keep: (lot: VinylLot) => boolean): Promise<VinylLot[]> {
  const firstHtml = await fetchPage(1);
  const total = lastPage(firstHtml);
  const byId = new Map<string, VinylLot>();
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPage(page);
    } catch {
      continue;
    }
    const lots = parseCards(html);
    if (!lots.length) continue;
    for (const lot of lots) {
      if (looksNonVinyl(lot.title)) continue;
      if (keep(lot)) byId.set(lot.id, lot);
    }
  }
  return [...byId.values()];
}

export type FindLotMatch = {
  page: number;
  idLeilao: string;
  house: string;
  title: string;
  dayKey: string;
  url: string;
  wouldKeep: boolean; // passaria no filtro `looksNonVinyl`?
};

/**
 * Diagnóstico: varre TODAS as páginas da listagem geral (mesma categoria travada
 * "Disco de Vinil", sem filtro de dia/`looksNonVinyl`) procurando `query` como
 * idLeilao exato, substring do nome da casa ou substring da URL do lote. Serve para
 * distinguir "o item nem está na categoria vinil da LeilõesBR" (nada a fazer do nosso
 * lado — categorização é da casa/plataforma) de "está na categoria mas o NOSSO
 * parser/filtro descartou" (bug nosso). Não persiste nada.
 */
export async function findLotDebug(
  query: string,
): Promise<{ query: string; totalPages: number; scannedPages: number; matches: FindLotMatch[] }> {
  const q = query.trim().toLowerCase();
  const firstHtml = await fetchPage(1);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPage(page);
    } catch {
      continue;
    }
    for (const lot of parseCards(html)) {
      const hit =
        lot.idLeilao === q ||
        lot.house.toLowerCase().includes(q) ||
        lot.url.toLowerCase().includes(q);
      if (!hit) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { query, totalPages: total, scannedPages: scanned, matches };
}

// `tp` é passado CRU (sem URL-encode dos `|`) igual ao resto do arquivo — é assim que o
// próprio site usa (ex.: VINYL_CATEGORY acima); `null` = sem filtro de categoria nenhum.
function listUrlSearch(page: number, pesquisa: string, tp: string | null): string {
  const params = new URLSearchParams({
    pesquisa,
    op: "3",
    v: String(PER_PAGE),
    b: "0",
    pag: String(page),
  });
  const base = `${BASE_URL}/busca_andamento.asp?${params.toString()}`;
  return tp ? `${base}&tp=${tp}` : base;
}

async function fetchPageSearch(page: number, pesquisa: string, tp: string | null): Promise<string> {
  return await publicFetch(listUrlSearch(page, pesquisa, tp), {});
}

/**
 * Diagnóstico nível 2: para o caso em que `findLotDebug` NÃO achou o idLeilao em
 * NENHUMA página da categoria "Disco de Vinil" (mesmo a casa marcando o item como
 * vinil no catálogo DELA — categoria interna da casa, não necessariamente a mesma
 * tag que ela manda pra LeilõesBR). Aqui usamos `pesquisa` (busca por texto livre do
 * próprio site, filtrada no SERVIDOR — mantém o total de páginas viável) e
 * OPCIONALMENTE sem travar `tp=` (categoria), pra achar o mesmo `idLeilao` em
 * QUALQUER categoria. Se achar aqui com `lockToVinyl:false` mas `findLotDebug` não
 * achou nada, confirma que o item está categorizado FORA de "Disco de Vinil" na
 * LeilõesBR (decisão da casa/plataforma, não um bug nosso). Não persiste nada.
 */
export async function findLotSearch(
  idLeilao: string,
  pesquisa: string,
  lockToVinyl: boolean,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  lockToVinyl: boolean;
  totalPages: number;
  scannedPages: number;
  matches: FindLotMatch[];
}> {
  const tp = lockToVinyl ? VINYL_CATEGORY : null;
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    for (const lot of parseCards(html)) {
      if (lot.idLeilao !== idLeilao) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { idLeilao, pesquisa, lockToVinyl, totalPages: total, scannedPages: scanned, matches };
}

/**
 * Diagnóstico nível 3: `findLotSearch` confirmou que um `idLeilao` está na listagem
 * geral (com `pesquisa`, sem travar categoria) mas fora de "Disco de Vinil" — porém
 * `VinylLot`/`parseCard` não capturam NENHUM campo de categoria (não existia motivo
 * até agora). Aqui devolvemos o HTML BRUTO do(s) card(s) que batem o `idLeilao`
 * (truncado, pra não estourar o log) — permite inspecionar visualmente onde/como o
 * site representa a categoria de cada item na listagem geral, sem precisar de
 * acesso de rede/browser no ambiente de dev. Não persiste nada.
 */
export async function findLotRawCard(
  idLeilao: string,
  pesquisa: string,
  lockToVinyl: boolean,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  lockToVinyl: boolean;
  totalPages: number;
  cards: string[];
}> {
  const tp = lockToVinyl ? VINYL_CATEGORY : null;
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const cards: string[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    const root = parse(html);
    for (const card of root.querySelectorAll(".mostbidded .product")) {
      const href = card.querySelector('a[href*="abre_catalogo.asp"]')?.getAttribute("href") ?? "";
      if (!href.includes(`|${idLeilao}|`)) continue;
      cards.push(card.outerHTML.slice(0, 4000));
    }
  }
  return { idLeilao, pesquisa, lockToVinyl, totalPages: total, cards };
}

/**
 * Diagnóstico nível 4: no catálogo PRÓPRIO da casa (fora do escopo da LeilõesBR),
 * "Disco de vinil" filtra por `tipo=|129|` — um CÓDIGO NUMÉRICO local da casa, bem
 * diferente do `tp=|446973636F2064652076696E696C|` (texto "Disco de vinil" em hex)
 * que a LeilõesBR usa na busca geral. Podem ser esquemas de categoria DIFERENTES
 * (numérico por casa vs. texto/hex da plataforma) — aqui testamos um `tp` CRU
 * qualquer (ex.: `|129|`) direto na busca geral da LeilõesBR, pra ver se esse código
 * também filtra por lá e se o `idLeilao` aparece com ele. Não persiste nada.
 */
export async function findLotByCategory(
  idLeilao: string,
  pesquisa: string,
  tp: string,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  tp: string;
  totalPages: number;
  scannedPages: number;
  matches: FindLotMatch[];
}> {
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    for (const lot of parseCards(html)) {
      if (lot.idLeilao !== idLeilao) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { idLeilao, pesquisa, tp, totalPages: total, scannedPages: scanned, matches };
}

export type GalleryEntry = { code: string; name: string; count: number | null };

/**
 * Diagnóstico (Fase 1 da investigação de descoberta por "galeria" — ver
 * docs/notas-desenvolvimento.md, Pendências): busca a página 1 de `busca_andamento.asp`
 * (categoria `tp` opcional, `null` = sem filtro) e tenta extrair a seção "GALERIAS" — lista
 * de casas com um código `ga=<n>` que filtra `busca_andamento.asp?ga=<n>[&tp=...]` só pra
 * aquela casa (achado pelo usuário navegando manualmente). A estrutura EXATA do HTML nunca
 * foi inspecionada por código neste ambiente (sem rede pros sites de leilão) — tentamos um
 * padrão plausível (checkbox com `value` numérico + texto próximo) e SEMPRE devolvemos
 * também um trecho do HTML bruto ao redor da palavra "galeria" como `rawSnippet`, pra
 * confirmar/ajustar o parser com dado real de produção em vez de achismo, igual ao espírito
 * de `findLotRawCard`. Não persiste nada.
 */
export async function listGalleries(
  tp: string | null = VINYL_CATEGORY,
): Promise<{ tp: string | null; galleries: GalleryEntry[]; rawSnippet: string | null }> {
  const html = await fetchPageSearch(1, "", tp);
  const root = parse(html);

  // Estrutura confirmada rodando step=galleries em produção (v0.69.35): um <ul
  // id="comboGalerias"> com um <li> por galeria, cada um com um checkbox
  // (`input.ga[value]`, o código de `ga=<código>`) e um <label> com o nome — em <div>s
  // irmãos, não aninhados um dentro do outro (por isso a heurística por regex anterior,
  // que só olhava o texto logo após o checkbox, sempre batia em espaço em branco e
  // descartava todas as galerias).
  // Sem vírgula/união no seletor (evita depender de suporte incerto no parser) —
  // tenta pelo id do <ul> confirmado e cai para a classe do <li> como reforço.
  const items = root.querySelectorAll("#comboGalerias li");
  if (items.length === 0) items.push(...root.querySelectorAll(".lista-subcats-item"));

  const galleries: GalleryEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const code = item.querySelector('input[type="checkbox"][value]')?.getAttribute("value");
    if (!code || seen.has(code)) continue;
    const raw = decodeHtmlEntities(item.querySelector("label")?.text?.trim() ?? "");
    if (!raw) continue;
    const countMatch = raw.match(/\((\d+)\)\s*$/);
    seen.add(code);
    galleries.push({
      code,
      name: countMatch ? raw.slice(0, countMatch.index).trim() : raw,
      count: countMatch ? Number(countMatch[1]) : null,
    });
  }

  const galleryIdx = html.search(/galeria/i);
  const rawSnippet = galleryIdx >= 0 ? html.slice(galleryIdx, galleryIdx + 8000) : null;

  return { tp, galleries, rawSnippet };
}

/** Faz upsert dos lotes no banco e registra os leilões vistos (best-effort). */
// ⚠️ O upsert de `lots` abaixo NÃO tem try/catch ao redor de si — propositalmente.
// `supabaseAdmin.from(...).upsert(...)` (o shim em `db-query.server.ts`) NUNCA lança:
// erros do Postgres (ex.: DATABASE_URL ausente, conexão recusada) viram
// `{ data: null, error }` normalmente. Sem checar `error` e relançar, essa falha
// desaparecia em silêncio — a call resolvia como se tivesse gravado, `scrapeVinylChunk`/
// `enrichMissingLotes` reportavam sucesso (`persisted: true`) e o site foi perdendo lotes
// sem log nenhum (achado v0.69.28, ver "Pendências" em notas-desenvolvimento.md). Deixamos
// propagar para os `try/catch` dos chamadores (que já existem e alimentam `persisted`).
async function persistLots(fresh: VinylLot[]): Promise<void> {
  if (!fresh.length) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const rows = fresh.map((lot) => ({
    id: lot.id,
    id_leilao: lot.idLeilao,
    id_peca: lot.idPeca,
    base: lot.base,
    lote: lot.lote,
    title: lot.title,
    url: lot.url,
    image: lot.image,
    price: lot.price,
    day_key: lot.dayKey,
    start_time: lot.time,
    uf: lot.uf,
    house: lot.house,
    house_url: lot.houseUrl,
    artist: lot.artist,
    last_seen_at: nowIso,
    updated_at: nowIso,
  }));
  // Upsert por id: atualiza preço/campos dos lotes que ainda estão no site e
  // ACRESCENTA os novos, sem apagar os que já não aparecem (merge durável).
  const { error } = await supabaseAdmin.from("lots").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  try {
    const { recordAuctions } = await import("./leiloesbr-auctions.server");
    await recordAuctions(fresh);
  } catch (error) {
    console.error("[leiloesbr] não foi possível salvar o histórico de leilões", error);
  }
}

/** Remove do banco os lotes fora da janela atual de dias. */
async function pruneOutOfWindow(windowStart: string, windowEnd: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("lots")
      .delete()
      .or(`day_key.lt.${windowStart},day_key.gt.${windowEnd}`);
  } catch (error) {
    console.error("[leiloesbr] não foi possível limpar lotes fora da janela", error);
  }
}

type LotRow = {
  id: string;
  id_leilao: string;
  id_peca: string;
  base: string;
  lote: string;
  title: string;
  url: string;
  image: string | null;
  price: string;
  day_key: string;
  start_time: string;
  uf: string;
  house: string;
  house_url: string;
  artist: string;
};

function rowToLot(row: LotRow): VinylLot {
  return {
    id: row.id,
    idPeca: row.id_peca,
    idLeilao: row.id_leilao,
    base: row.base,
    lote: row.lote,
    watched: false, // a vigia é sobreposta na UI a partir de listWatched
    title: row.title,
    url: row.url,
    image: row.image,
    price: row.price,
    dayKey: row.day_key,
    time: row.start_time,
    uf: row.uf,
    house: row.house,
    houseUrl: row.house_url,
    artist: row.artist,
  };
}

const LOT_COLUMNS =
  "id, id_leilao, id_peca, base, lote, title, url, image, price, day_key, start_time, uf, house, house_url, artist";

/**
 * Instante da última atualização dos lotes da janela = maior `updated_at` no banco
 * (o trigger `update_lots_updated_at` toca a coluna a cada upsert). Best-effort:
 * retorna null quando o banco está indisponível (aí o cliente cai no cache em memória).
 */
async function latestUpdatedAt(windowStart: string, windowEnd: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("lots")
      .select("updated_at")
      .gte("day_key", windowStart)
      .lte("day_key", windowEnd)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { updated_at: string } | null)?.updated_at ?? null;
  } catch {
    return null;
  }
}

async function readLots(windowStart: string, windowEnd: string): Promise<VinylLot[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: VinylLot[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lots")
      .select(LOT_COLUMNS)
      .gte("day_key", windowStart)
      .lte("day_key", windowEnd)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data as LotRow[] | null) ?? [];
    for (const row of batch) out.push(rowToLot(row));
    if (batch.length < PAGE) break;
  }
  return sortLots(out);
}

/** Une (por id) o cache em memória + o banco (best-effort) + os recém-varridos. */
async function mergeSources(
  windowStart: string,
  windowEnd: string,
  fresh: VinylLot[],
): Promise<VinylLot[]> {
  const merged = new Map<string, VinylLot>();
  if (memCache) {
    for (const lot of memCache.lots) {
      if (lot.dayKey >= windowStart && lot.dayKey <= windowEnd) merged.set(lot.id, lot);
    }
  }
  try {
    for (const lot of await readLots(windowStart, windowEnd)) merged.set(lot.id, lot);
  } catch (error) {
    console.error("[leiloesbr] não foi possível ler os lotes do banco", error);
  }
  for (const lot of fresh) merged.set(lot.id, lot); // recém-varridos vencem (preço novo)
  return sortLots([...merged.values()]);
}

async function fillArtists(fresh: VinylLot[]): Promise<void> {
  if (!fresh.length) return;
  try {
    const { fillMissingArtists } = await import("./known-artists.server");
    await fillMissingArtists(fresh);
  } catch (error) {
    console.error("[leiloesbr] não foi possível aplicar a base de artistas", error);
  }
}

/**
 * Preenche o nº do lote (que NÃO vem na listagem geral) buscando o catálogo de
 * cada leilão no site da casa (`catalogo.asp?Num=`). Processa até `maxAuctions`
 * leilões por chamada (para caber no tempo do servidor) e devolve quantos lotes
 * atualizou e quantos leilões ainda faltam. Persiste no banco e atualiza o cache.
 */
/** Lista os leilões (domínio + idLeilao) que ainda têm lotes SEM número — p/ diagnóstico. */
export async function listMissingAuctions(
  limit = 5,
): Promise<{ domain: string; idLeilao: string; ids: string[] }[]> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;
  let lots: VinylLot[] = [];
  try {
    lots = await mergeSources(windowStart, windowEnd, []);
  } catch {
    return [];
  }
  const { parseAuctionRef } = await import("./leiloesbr-catalog.server");
  const auctions = new Map<string, { domain: string; idLeilao: string; ids: string[] }>();
  for (const lot of lots) {
    if (lot.lote) continue;
    const ref = parseAuctionRef(lot.url);
    if (!ref) continue;
    const key = `${ref.domain}|${ref.idLeilao}`;
    const entry = auctions.get(key) ?? { domain: ref.domain, idLeilao: ref.idLeilao, ids: [] };
    if (entry.ids.length < 5) entry.ids.push(lot.idPeca);
    auctions.set(key, entry);
  }
  return [...auctions.values()].slice(0, limit);
}

export async function enrichMissingLotes(
  maxAuctions = 6,
  offset = 0,
): Promise<{
  updated: number;
  total: number;
  nextOffset: number | null;
  done: boolean;
  persisted: boolean;
}> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;

  let lots: VinylLot[];
  try {
    lots = await mergeSources(windowStart, windowEnd, []);
  } catch {
    return { updated: 0, total: 0, nextOffset: null, done: true, persisted: false };
  }

  const { parseAuctionRef, fetchLoteMap } = await import("./leiloesbr-catalog.server");

  // Lista ESTÁVEL de TODOS os leilões da janela (ordenada), guardando quais idPecas
  // ainda estão SEM número. A lista não encolhe entre chamadas, então o cursor
  // `offset` avança de forma determinística por todos os leilões (não repete os 6
  // primeiros). Leilões de casas fora da plataforma simplesmente não rendem número.
  const auctions = new Map<string, { domain: string; idLeilao: string; missing: Set<string> }>();
  for (const lot of lots) {
    const ref = parseAuctionRef(lot.url);
    if (!ref) continue;
    const key = `${ref.domain}|${ref.idLeilao}`;
    const entry = auctions.get(key) ?? {
      domain: ref.domain,
      idLeilao: ref.idLeilao,
      missing: new Set<string>(),
    };
    if (!lot.lote) entry.missing.add(lot.idPeca);
    auctions.set(key, entry);
  }
  const all = [...auctions.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  const total = all.length;
  const start = Math.max(0, offset);
  const batch = all.slice(start, start + maxAuctions);
  const nextStart = start + maxAuctions;
  const done = nextStart >= total;
  const nextOffset = done ? null : nextStart;

  const loteByPeca = new Map<string, string>();
  for (const auction of batch) {
    if (auction.missing.size === 0) continue; // leilão já completo — pula
    try {
      const map = await fetchLoteMap(auction.domain, auction.idLeilao);
      for (const id of auction.missing) {
        const lote = map.get(id);
        if (lote) loteByPeca.set(id, lote);
      }
    } catch (error) {
      console.error("[leiloesbr] falha ao ler catálogo da casa", error);
    }
  }
  if (!loteByPeca.size) return { updated: 0, total, nextOffset, done, persisted: true };

  // Aplica no cache em memória e coleta os lotes alterados para persistir.
  if (memCache) {
    for (const lot of memCache.lots) {
      const lote = loteByPeca.get(lot.idPeca);
      if (lote && !lot.lote) lot.lote = lote;
    }
  }
  const changed: VinylLot[] = [];
  for (const lot of lots) {
    const lote = loteByPeca.get(lot.idPeca);
    if (lote && !lot.lote) {
      lot.lote = lote;
      changed.push(lot);
    }
  }
  let persisted = true;
  try {
    await persistLots(changed);
  } catch (error) {
    console.error("[leiloesbr] não foi possível persistir os nº de lote", error);
    persisted = false;
  }

  return { updated: changed.length, total, nextOffset, done, persisted };
}

/**
 * Retorna os lotes da janela. A fonte GARANTIDA é o cache/merge em memória; o
 * banco é camada durável quando disponível (não quebra se a tabela não existir).
 * Varre o site quando está "stale" ou em `force`, mescla tudo por id (sem apagar)
 * e faz upsert best-effort — o "atualizar" acrescenta diferenças.
 */
export async function scrapeVinylLots(
  force = false,
): Promise<{ days: string[]; lots: VinylLot[]; updatedAt: string | null }> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;

  // Leitura normal: NUNCA varre o site. O banco é a fonte da listagem, o que faz o
  // app funcionar igual em produção (onde a varredura de ~150 páginas excede o
  // tempo de execução do servidor e a requisição era abortada, deixando a tela vazia).
  if (!force) {
    // Cache "quente": mesma instância, mesma janela, dentro do TTL — devolve sem tocar
    // o banco (pula a leitura paginada de `lots` inteira + a consulta de `updatedAt`).
    if (
      memCache &&
      Date.now() - memCache.at < SNAPSHOT_TTL_MS &&
      memCache.days.length === days.length &&
      memCache.days.every((d, i) => d === days[i])
    ) {
      return { days: memCache.days, lots: memCache.lots, updatedAt: memCache.updatedAt };
    }

    const lots = await mergeSources(windowStart, windowEnd, []);
    if (lots.length) {
      const at = memCache?.at ?? Date.now();
      const updatedAt =
        (await latestUpdatedAt(windowStart, windowEnd)) ?? new Date(at).toISOString();
      memCache = { at, days, lots, updatedAt };
      return { days, lots, updatedAt };
    }
  }

  let fresh: VinylLot[] = [];
  try {
    fresh = await scrapePages((lot) => lot.dayKey >= windowStart && lot.dayKey <= windowEnd);
  } catch (error) {
    console.error("[leiloesbr] varredura falhou; usando o que já temos", error);
  }
  await fillArtists(fresh);

  const at = Date.now();
  const lots = await mergeSources(windowStart, windowEnd, fresh);

  if (fresh.length) {
    try {
      await persistLots(fresh);
      await pruneOutOfWindow(windowStart, windowEnd);
    } catch (error) {
      console.error("[leiloesbr] não foi possível persistir os lotes", error);
    }
  }
  const updatedAt = (await latestUpdatedAt(windowStart, windowEnd)) ?? new Date(at).toISOString();
  memCache = { at, days, lots, updatedAt };
  return { days, lots, updatedAt };
}

/** Re-varre apenas UM dia, mescla (não apaga os demais) e faz upsert best-effort. */
export async function refreshVinylDay(
  day: string,
): Promise<{ days: string[]; lots: VinylLot[]; updatedAt: string | null }> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;
  if (!days.includes(day)) return await scrapeVinylLots(true);

  let fresh: VinylLot[] = [];
  try {
    fresh = await scrapePages((lot) => lot.dayKey === day);
  } catch (error) {
    console.error("[leiloesbr] varredura do dia falhou", error);
  }
  await fillArtists(fresh);

  const at = fresh.length ? Date.now() : (memCache?.at ?? Date.now());
  const lots = await mergeSources(windowStart, windowEnd, fresh);

  if (fresh.length) {
    try {
      await persistLots(fresh);
    } catch (error) {
      console.error("[leiloesbr] não foi possível persistir os lotes do dia", error);
    }
  }
  const updatedAt = (await latestUpdatedAt(windowStart, windowEnd)) ?? new Date(at).toISOString();
  memCache = { at, days, lots, updatedAt };
  return { days, lots, updatedAt };
}

/**
 * Varredura em BLOCOS sequenciais: cada chamada varre `size` páginas a partir de
 * `fromPage` (ou da última página quando null) e faz upsert. Evita a varredura
 * completa numa única requisição (que estoura o tempo em produção). Retorna a
 * próxima página a varrer (null quando terminou a janela) e o total de páginas.
 */
export async function scrapeVinylChunk(
  fromPage: number | null,
  size: number,
): Promise<{ total: number; nextPage: number | null; scraped: number; persisted: boolean }> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;

  let start = fromPage ?? 0;
  let total = fromPage ?? 0;
  if (fromPage == null) {
    const firstHtml = await fetchPage(1);
    total = lastPage(firstHtml);
    start = total;
  }

  // ⚠️ NÃO paramos mais cedo ao achar uma página cujo dia mínimo já passou da janela
  // (ver `scrapePages` acima, mesmo achado/fix) — a listagem intercala leilões, não é
  // estritamente ordenada por data, então uma página "fora da janela" não garante que
  // as páginas seguintes (números menores) também estejam. Sempre varremos até `end`
  // (ou `page=1`); o filtro por `dayKey` dentro do loop decide o que entra.
  const end = Math.max(start - size + 1, 1);
  const byId = new Map<string, VinylLot>();
  for (let page = start; page >= end; page -= 1) {
    let html: string;
    try {
      html = await fetchPage(page);
    } catch {
      continue;
    }
    const lots = parseCards(html);
    if (!lots.length) continue;
    for (const lot of lots) {
      if (lot.dayKey < windowStart || lot.dayKey > windowEnd) continue;
      if (looksNonVinyl(lot.title)) continue;
      byId.set(lot.id, lot);
    }
  }

  const fresh = [...byId.values()];
  await fillArtists(fresh);
  let persisted = true;
  if (fresh.length) {
    try {
      await persistLots(fresh);
    } catch (error) {
      console.error("[leiloesbr] não foi possível persistir o bloco", error);
      persisted = false;
    }
  }

  const nextPage = end <= 1 ? null : end - 1;
  if (nextPage == null) {
    try {
      await pruneOutOfWindow(windowStart, windowEnd);
    } catch (error) {
      console.error("[leiloesbr] não foi possível limpar lotes fora da janela", error);
    }
  }
  return { total: fromPage == null ? total : start, nextPage, scraped: fresh.length, persisted };
}

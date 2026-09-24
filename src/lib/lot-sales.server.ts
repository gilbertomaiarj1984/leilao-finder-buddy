import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { deriveAlbum } from "./analytics";
import { type Condition, parseConditionFromText, scoreCondition } from "./grading";
import type { LotIdentRow } from "./lot-ident.server";
import {
  auctionFinished,
  decodeHtmlEntities,
  extractAlbumPart,
  extractArtist,
  isDiscBundle,
  isGenericArtist,
  looksNonVinylSale,
  matchExistingAlbum,
  normalizeForMatch,
  parsePrice,
  pickCanonical,
} from "./vinyl-parse";

/**
 * Histórico de vendas (`lot_sales`) — a casa de leilão é irrelevante para o Vinil Analytics,
 * mas guardamos casa/UF para referência. Cada linha é UMA venda de UM lote, capturada do
 * **catálogo da casa** DEPOIS do leilão (`catalogo.asp` traz o valor de venda por lote), sem
 * ir à `peca.asp` lote a lote. O estado (Disco/Capa) é o melhor que o texto do card permite
 * (título/descrição curta); quando não há sigla, fica indefinido. A **data da venda é a data
 * do LEILÃO** (âncora temporal do histórico), não a data da captura.
 */
export type LotSaleRow = {
  lot_id: string; // "${idLeilao}-${idPeca}"
  id_leilao: string;
  id_peca: string;
  artist: string;
  title: string;
  sold_price: number | null;
  sold_price_raw: string;
  sold_date: string | null; // data do leilão (yyyy-mm-dd)
  house: string;
  uf: string;
  media: string; // grau do disco (grading) ou ""
  sleeve: string; // grau da capa ou ""
  score: number | null; // Score Final (0–100)
  faixa: string; // rótulo da faixa ou ""
  insert_state: string; // "sim" | "nao" | ""
  source_url: string;
  // Sinais ricos do catálogo (mesma varredura): demanda, taxa e valor inicial.
  views: number | null; // nº de visualizações do lote (demanda)
  bids: number | null; // nº de lances (demanda)
  fee_pct: number | null; // comissão do leiloeiro em % (custo real = venda × (1 + taxa/100))
  initial_price: number | null; // valor inicial/contratado (p/ desconto/ágio vs. venda)
  orig_text: string; // descritivo COMPLETO do card do catálogo (texto original; NÃO reescrito
  // pela reidentificação por IA, que só ajusta title/artist)
  bundle: boolean; // lote/kit com vários discos (preço do CONJUNTO) — calculado na captura a
  // partir de `orig_text`, persistido para o Vinil Analytics filtrar sem reler `orig_text`.
  image: string | null; // thumbnail pequeno/comprimido (nosso storage) — NUNCA a URL crua do
  // catálogo. null = ainda não tentado; "" = tentado sem imagem-fonte disponível.
};

const PAGE = 1000;
// Colunas base (sempre presentes, incl. `bundle`/`image`) e a coluna `orig_text` — a mais pesada
// por linha —, pedida à parte (`withOrig`). A leitura/escrita toleram a ausência de `orig_text`
// (banco sem a migração da coluna ainda) — ver `isMissingColumn`.
const BASE_SALE_COLUMNS =
  "lot_id, id_leilao, id_peca, artist, title, sold_price, sold_price_raw, sold_date, house, uf, media, sleeve, score, faixa, insert_state, source_url, views, bids, fee_pct, initial_price, bundle, image";
const SALE_COLUMNS = `${BASE_SALE_COLUMNS}, orig_text`;

/** Erro do Postgres/PostgREST de coluna inexistente (antes de aplicar a migração `orig_text`). */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return (error.message ?? "").includes("orig_text");
}

// Cache curto do caso `{ withOrig: false }` SEM `ids` — a leitura da tabela INTEIRA (sem a
// coluna mais pesada). É o caminho batido por `getVinylSales` (Vinil Analytics, a cada
// abertura) e pela padronização de grafia dentro de `reidentifyAllSales` (até 15x por
// execução do cron). Invalidado a cada escrita (`upsertLotSales`). O caso `{ ids }` e o
// `withOrig: true` (só o backfill único de `bundle`) ficam de fora — não são o padrão
// recorrente que pesa no egress.
let noOrigCache: { at: number; rows: LotSaleRow[] } | null = null;
const NO_ORIG_TTL_MS = 30_000;

/**
 * Lê vendas de `lot_sales` (single-user; paginado). Best-effort. Tolera `orig_text` ausente
 * (banco sem a migração da coluna).
 *
 * - `ids`: busca só esse conjunto (já limitado pelo chamador, ex. até 500) — 1 requisição, sem
 *   paginação. Sem `ids`, lê a TABELA INTEIRA (usar com cuidado — é o padrão caro que o Fase 1
 *   corrigiu em `reidentifyAllSales`; prefira `ids` ou a RPC `getUnidentifiedLotSales` quando der).
 * - `withOrig` (padrão `true`): quando `false`, NÃO pede `orig_text` — a coluna mais pesada por
 *   linha — para quem só precisa de artista/título/preço (ex. padronização de grafia).
 */
export async function getAllLotSales(opts?: {
  withOrig?: boolean;
  ids?: string[];
}): Promise<LotSaleRow[]> {
  const ids = opts?.ids;
  if (ids && !ids.length) return [];
  let withOrig = opts?.withOrig ?? true;
  const wantedNoOrig = !ids && !withOrig;
  const rows: LotSaleRow[] = [];

  if (wantedNoOrig && noOrigCache && Date.now() - noOrigCache.at < NO_ORIG_TTL_MS) {
    return noOrigCache.rows;
  }

  if (ids) {
    for (;;) {
      const cols = withOrig ? SALE_COLUMNS : BASE_SALE_COLUMNS;
      const { data, error } = await supabaseAdmin.from("lot_sales").select(cols).in("lot_id", ids);
      if (error) {
        if (withOrig && isMissingColumn(error)) {
          withOrig = false;
          continue;
        }
        throw error;
      }
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      for (const r of batch)
        rows.push({ orig_text: "", bundle: false, ...r } as unknown as LotSaleRow);
      return rows;
    }
  }

  for (let from = 0; ; from += PAGE) {
    const cols = withOrig ? SALE_COLUMNS : BASE_SALE_COLUMNS;
    const { data, error } = await supabaseAdmin
      .from("lot_sales")
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) {
      if (withOrig && isMissingColumn(error)) {
        withOrig = false;
        from -= PAGE; // repete esta página sem `orig_text`
        continue;
      }
      throw error;
    }
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of batch)
      rows.push({ orig_text: "", bundle: false, ...r } as unknown as LotSaleRow);
    if (batch.length < PAGE) break;
  }
  if (wantedNoOrig) noOrigCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Anti-join no banco (RPC `get_unidentified_lot_sales`): só as vendas de `lot_sales` que AINDA
 * não têm linha em `lot_ident`, até `limit`. Substitui, em `reidentifyAllSales`, o padrão antigo
 * de baixar as duas tabelas INTEIRAS (com `orig_text`) a cada chamada só para achar o que falta
 * identificar — a causa raiz do egress do Supabase (ver docs/economia-fase-1-egress-e-cpu.md).
 * Requer a migration `20260914000000_reident_egress_fixes.sql`.
 */
export async function getUnidentifiedLotSales(limit: number): Promise<LotSaleRow[]> {
  const { data, error } = await supabaseAdmin.rpc("get_unidentified_lot_sales", {
    p_limit: limit,
  });
  if (error) throw error;
  const batch = (data ?? []) as unknown as Record<string, unknown>[];
  return batch.map((r) => ({ orig_text: "", bundle: false, ...r }) as unknown as LotSaleRow);
}

/**
 * Grava/atualiza vendas (upsert por `lot_id`). Só chamamos com linhas já vendidas.
 * `orig_text` é OPCIONAL na entrada: quando ausente (ex. regravação vinda de uma leitura magra,
 * sem essa coluna), a chave nem entra no payload do upsert — PostgREST só sobrescreve as colunas
 * presentes no corpo, então o valor já gravado no banco fica intacto (não é apagado por "").
 */
export async function upsertLotSales(
  rows: (Omit<LotSaleRow, "orig_text"> & { orig_text?: string })[],
): Promise<number> {
  if (!rows.length) return 0;
  const capturedAt = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, captured_at: capturedAt }));
  const { error } = await supabaseAdmin.from("lot_sales").upsert(payload, { onConflict: "lot_id" });
  if (error) {
    // Banco ainda sem a coluna `orig_text` (migração não aplicada): grava sem ela em vez de 500.
    if (isMissingColumn(error)) {
      const slim = payload.map(({ orig_text, ...base }) => base);
      const retry = await supabaseAdmin.from("lot_sales").upsert(slim, { onConflict: "lot_id" });
      if (retry.error) {
        console.error("[lot-sales] falha ao gravar vendas (sem orig_text)", retry.error);
        throw new Error(`Não foi possível gravar as vendas: ${retry.error.message}`);
      }
      noOrigCache = null;
      return payload.length;
    }
    console.error("[lot-sales] falha ao gravar vendas", error);
    throw new Error(`Não foi possível gravar as vendas: ${error.message}`);
  }
  noOrigCache = null;
  return payload.length;
}

/**
 * Backfill ÚNICO de `bundle` para vendas gravadas ANTES dessa coluna existir. Lê `orig_text`
 * (custo de egress concentrado numa chamada, não repetido) e regrava só as linhas cujo `bundle`
 * calculado agora diverge do gravado. Rode manualmente (uma vez) após aplicar a migration —
 * depois disso, `getVinylSales`/`reidentifyAllSales` nunca mais precisam ler `orig_text` em massa.
 */
export async function backfillBundleFlag(
  max = 1000,
): Promise<{ scanned: number; updated: number }> {
  const all = await getAllLotSales({ withOrig: true });
  const toFix = all
    .filter((s) => isDiscBundle(s.orig_text ?? "") !== s.bundle)
    .slice(0, Math.max(1, max));
  if (!toFix.length) return { scanned: all.length, updated: 0 };
  const rows = toFix.map((s) => ({ ...s, bundle: isDiscBundle(s.orig_text ?? "") }));
  const updated = await upsertLotSales(rows);
  return { scanned: all.length, updated };
}

type SeenAuctionRow = {
  id_leilao: string;
  entry_url: string | null;
  day_key: string;
  start_time: string;
  house: string;
  uf: string | null;
};

// Cache curto em memória: `readSeenAuctions` é chamada a cada iteração do laço `sales` do
// cron (até 40x/execução) e `seen_auctions` NUNCA é podada (só cresce). Sem invalidação
// explícita por escrita — quem grava ali é `recordAuctions` (`leiloesbr-auctions.server.ts`,
// módulo separado); tolerável, porque um leilão novo/atualizado aparecer com até
// `SEEN_TTL_MS` de atraso na captura de vendas não muda o resultado (a próxima chamada do
// laço, ou a próxima execução do cron, pega). Mesmo padrão de `lot-ai.server.ts` (ver
// docs/economia-fase-1-egress-e-cpu.md).
let seenCache: { at: number; rows: SeenAuctionRow[] } | null = null;
const SEEN_TTL_MS = 30_000;

/** Lê os leilões conhecidos (durável; nunca podado) com o que a captura precisa. */
async function readSeenAuctions(): Promise<SeenAuctionRow[]> {
  if (seenCache && Date.now() - seenCache.at < SEEN_TTL_MS) return seenCache.rows;
  const out: SeenAuctionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("seen_auctions")
      .select("id_leilao, entry_url, day_key, start_time, house, uf")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data as SeenAuctionRow[] | null) ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  seenCache = { at: Date.now(), rows: out };
  return out;
}

/** Identidade dos nossos lotes de VINIL (por id), para filtrar o catálogo e nomear a venda. */
export type VinylInfo = { title: string; artist: string };

// Sinal POSITIVO de vinil no texto do card (formato). NÃO usa "disco" solto (fraco: casa
// "Catavento Discos", "disco voador"…). Grau de Disco/Capa também conta como vinil.
const VINYL_FORMAT =
  /\b(?:lps?|vinil|vinyl|compacto|bolach[aã]o|long\s*play|33\s*rpm)\b|disco\s+de\s+vinil/i;

export function looksVinyl(text: string, cond: Condition): boolean {
  return Boolean(cond.media || cond.sleeve) || VINYL_FORMAT.test(text);
}

// Prefixo de formato no início do PECA ("Disco de vinil ...", "LP ...", "Disco ...").
const PECA_FORMAT_PREFIX =
  /^(?:disco de vinil|discos?|lps?|vinil|vinyl|compacto|bolach[aã]o)\b[\s:.\-–—]*/i;
// Sufixo de estado no fim do PECA ("... - Novo", "- Usado", "- Regular").
const PECA_STATE_SUFFIX =
  /\s*[-–—]\s*(?:novo|usado|semi-?novo|regular|[óo]timo|bom|ruim|conforme fotos)\.?\s*$/i;

/**
 * Melhor título p/ identidade a partir do lote do catálogo (#8). Casas cujo DESCRICAO traz
 * "Artista - Álbum" (Discos Esquecidos) → usa o descritivo. Casas em PROSA (Catavento,
 * santavelharia: "Disco de vinil: Título. Gravadora…") → usa o campo **PECA** (título curado,
 * ex.: "Disco Rock In ELMA CHIPS - Novo"), limpo de prefixo de formato e sufixo de estado.
 */
export function bestCatalogTitle(data: import("./leiloesbr-catalog.server").CatalogLot): string {
  const desc = catalogTitle(data.text);
  // Formato ESTRUTURADO (Discos Esquecidos): o DESCRICAO traz grau "CAPA/DISCO <sigla>" e vem
  // como "Artista - Álbum - CAPA …" — o descritivo (cortado no grau) é a melhor identidade.
  // Prosa (Catavento/santavelharia) NÃO tem grau → cai no PECA. (O separador " - " sozinho não
  // serve: a prosa tem "Disco de Vinil - LP".)
  const structured =
    /(?:capa|disco|m[íi]dia|vinil)\s+(?:M-|VG\+\+|VG\+|VG-|G\+|G-|F\/P|NM|EX|VG|G|M)\b/i.test(
      data.text,
    );
  if (structured) return desc;
  if (data.peca) {
    const p = data.peca
      .replace(PECA_FORMAT_PREFIX, "")
      .replace(PECA_STATE_SUFFIX, "")
      .replace(/\s+/g, " ")
      .trim();
    if (p) return p.slice(0, 160);
  }
  return desc;
}

/** Título conciso a partir do descritivo do catálogo (corta estado/venda/visitas e nº inicial). */
export function catalogTitle(text: string): string {
  return text
    .split(
      /\s(?:-\s*)?(?:capa|disco|m[íi]dia|vinil)\s+(?:M-|VG\+\+|VG\+|VG-|G\+|G-|F\/P|NM|EX|VG|G|M)\b/i,
    )[0]!
    .split(/valor\s+de\s+venda|\bvisita/i)[0]!
    .replace(/^\s*\d{1,4}\s+/, "") // nº do lote no começo ("140 GILBERTO GIL…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Monta as linhas de venda de um leilão a partir do catálogo — só de lotes de VINIL. O
 * `catalogo.asp` da casa lista TODAS as categorias (livros, DVDs, medalhas, miudezas…), então
 * filtramos: (1) lotes que conhecemos (`vinylById`, id do nosso vinil) → identidade LIMPA do
 * nosso lote; (2) lotes desconhecidos (leilões que já saíram da janela) que **parecem vinil**
 * pelo texto (grau Disco/Capa ou LP/vinil/compacto) → identidade do descritivo do catálogo. O
 * resto (jornal/medalha/fósforo/CD/DVD) é descartado. Catálogo entra só p/ valor + estado.
 */
function salesRowsFromCatalog(
  auction: { idLeilao: string; domain: string; dayKey: string; house: string; uf: string },
  catalog: Map<string, import("./leiloesbr-catalog.server").CatalogLot>,
  vinylById: Map<string, VinylInfo>,
): LotSaleRow[] {
  const rows: LotSaleRow[] = [];
  for (const [idPeca, data] of catalog) {
    if (!data.sold || !data.soldPrice) continue; // fail-closed: sem venda clara, não grava
    // Exclui OUTROS formatos (DVD, HQ, revista, livro, K7…) do histórico — mesmo se o texto
    // disser "disco" (um DVD também é "disco"). Aplica-se a conhecidos e desconhecidos.
    if (looksNonVinylSale(`${data.peca ?? ""} ${data.text}`)) continue;
    const lotId = `${auction.idLeilao}-${idPeca}`;
    const known = vinylById.get(lotId);
    const catCond = parseConditionFromText(data.text);
    if (!known && !looksVinyl(data.text, catCond)) continue; // desconhecido e não parece vinil → pula

    const title = known?.title || bestCatalogTitle(data);
    // Estado: prefere o grau do catálogo; cai no título.
    const cond =
      catCond.media || catCond.sleeve || catCond.insert ? catCond : parseConditionFromText(title);
    rows.push({
      lot_id: lotId,
      id_leilao: auction.idLeilao,
      id_peca: idPeca,
      artist: known?.artist || extractArtist(title),
      title,
      sold_price: parsePrice(data.soldPrice),
      sold_price_raw: data.soldPrice,
      sold_date: auction.dayKey || null,
      house: auction.house,
      uf: auction.uf,
      media: cond.media ?? "",
      sleeve: cond.sleeve ?? "",
      score: cond.score,
      faixa: cond.faixa?.label ?? "",
      insert_state: cond.insert ?? "",
      source_url: `${auction.domain}/peca.asp?ID=${idPeca}`,
      views: data.views ?? null,
      bids: data.bids ?? null,
      fee_pct: data.feePct ?? null,
      initial_price: data.initialPrice ?? null,
      // Texto original = descritivo completo do card (o mesmo que alimenta o estado). Preservado
      // mesmo depois que a reidentificação por IA reescreve `title`.
      orig_text: data.text ?? "",
      // Lote/kit com vários discos (preço do CONJUNTO) — calculado UMA vez aqui a partir do
      // texto original, para o Vinil Analytics filtrar sem reler `orig_text` depois.
      bundle: isDiscBundle(data.text ?? ""),
      // Preenchido best-effort logo abaixo (`captureFinishedSales`), a partir de `known.image`
      // — a captura do catálogo aqui não traz imagem, só o valor de venda + descritivo.
      image: null,
    });
  }
  return rows;
}

/**
 * Diagnóstico da captura de vendas: sonda o catálogo dos primeiros `limit` leilões TERMINADOS
 * (ignorando o checkpoint de capturados) e devolve sinais crus — quantos lotes o parser vê,
 * quantos reconhece como vendidos, se o HTML contém "Valor de venda"/"vendido"/"não vendido",
 * e uma amostra. NÃO grava nada nem marca como capturado. Serve para confirmar se `sales:0` é
 * legítimo ou se o parser precisa de ajuste para o formato daquela casa.
 */
export async function debugSales(
  limit = 3,
  num?: string,
): Promise<{ probed: number; auctions: unknown[] }> {
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const seen = await readSeenAuctions();
  const now = Date.now();
  const finished = seen
    // `num` sonda UM leilão específico (ignora o filtro de terminado); senão, os TERMINADOS.
    .filter((a) => (num ? a.id_leilao === num : auctionFinished(a.day_key, a.start_time, now)))
    .map((a) => ({ row: a, ref: parseAuctionRef(a.entry_url ?? "") }))
    .filter(
      (x): x is { row: SeenAuctionRow; ref: { domain: string; idLeilao: string } } =>
        x.ref !== null,
    )
    // Mais RECENTES primeiro (catálogo ainda vivo tem mais chance de trazer os lotes).
    .sort((a, b) => b.row.day_key.localeCompare(a.row.day_key))
    .slice(0, limit);

  const auctions: unknown[] = [];
  for (const { row, ref } of finished) {
    try {
      const map = await fetchCatalogData(ref.domain, ref.idLeilao);
      let sold = 0;
      let sample: unknown = null;
      for (const [idPeca, d] of map) {
        if (d.sold) {
          sold++;
          if (!sample)
            sample = { idPeca, lote: d.lote, soldPrice: d.soldPrice, text: d.text.slice(0, 140) };
        }
      }
      auctions.push({
        idLeilao: ref.idLeilao,
        house: row.house,
        domain: ref.domain,
        lotsParsed: map.size,
        soldParsed: sold,
        sample,
      });
    } catch (error) {
      auctions.push({
        idLeilao: ref.idLeilao,
        house: row.house,
        domain: ref.domain,
        error: (error as Error)?.message,
      });
    }
  }
  return { probed: auctions.length, auctions };
}

// Teto de linhas por RODADA (somado entre todos os leilões do batch) que passam pelo
// fallback de IA — mantém a rodada rápida/barata mesmo com muitos lotes sem sigla no catálogo.
const AI_CONDITION_CAP = 25;
// Teto por RODADA de vendas cujo ARTISTA é genérico/lixo e vão à IA de identificação
// (extrai "Artista - Álbum" corretos do texto do catálogo; grava também em `lot_ident`).
const AI_IDENT_CAP = 25;

/** Lado maior e qualidade do WEBP do thumbnail de venda — bem menor que as fotos da Coleção
 * (`COMPRESS_MAX_DIMENSION`/`COMPRESS_WEBP_QUALITY` em `collection.server.ts`), pois aqui é só
 * para AJUDAR a identificar visualmente no hover/detalhe do Vinil Analytics, não para exibir em
 * tamanho grande. */
const SALE_THUMB_MAX_DIMENSION = 200;
const SALE_THUMB_WEBP_QUALITY = 70;

/**
 * Baixa a imagem de origem (URL crua do CDN do catálogo, capturada enquanto o lote ainda estava
 * na listagem geral — `lots.image`/`VinylInfo.image`), redimensiona pequeno e recodifica em WEBP,
 * e sobe para o nosso storage em disco (mesmo volume das fotos da Coleção,
 * `collection-storage.server.ts`), em `sales/<lot_id>.webp` — path FIXO (não UUID: uma nova
 * chamada para o mesmo lote apenas sobrescreve, sem sobra de arquivo órfão). Best-effort: `null`
 * em qualquer falha (rede, imagem inválida) — o chamador decide se retenta depois.
 */
export async function captureSaleThumbnail(lotId: string, srcUrl: string): Promise<string | null> {
  if (!srcUrl) return null;
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length) return null;
    const sharp = (await import("sharp")).default;
    const out = await sharp(raw)
      .rotate()
      .resize({
        width: SALE_THUMB_MAX_DIMENSION,
        height: SALE_THUMB_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: SALE_THUMB_WEBP_QUALITY })
      .toBuffer();
    const { uploadCollectionFile } = await import("./collection-storage.server");
    const { publicUrl } = await uploadCollectionFile(`sales/${lotId}.webp`, out);
    return publicUrl;
  } catch (error) {
    console.error(`[lot-sales] falha ao gerar thumbnail de ${lotId}`, error);
    return null;
  }
}

// Regex de logo/banner do SITE (não do lote) — filtra fora da varredura de `<img>` do
// template antigo. Casas variam o nome ("logo.png", "banner1.jpg", "header-bg.jpg"…), então é
// heurística, não garantia — mas evitou os 3 falsos positivos vistos na prática (Padicaio).
const LOT_IMG_NOISE_RE = /logo|banner|icone|icon|header/i;
const LOT_IMG_EXT_RE = /\.(?:jpe?g|png|webp)(?:\?|$)/i;

/**
 * Busca a página do LOTE (`peca.asp`, o mesmo link salvo em `source_url`) e extrai a foto —
 * pra quando `lots.image` já não existe mais (lote saiu da janela/foi podado). Confirmado NA
 * PRÁTICA (não só por leitura da doc) que a foto sobrevive ao lote fechado/vendido, em duas
 * gerações de template — mesma dualidade que `fetchCatalogData` já trata pro catálogo:
 * - **Template NOVO** (JSON `loadData` embutido, ex.: dasantigasleiloes): campo `VPASTA` — não é
 *   exclusivo do lote "aberto" como a doc antiga sugeria (`docs/notas-desenvolvimento.md`,
 *   seção "Referência: JSON loadData do peca.asp" — atualizar depois de confirmado).
 * - **Template ANTIGO** (HTML server-side puro, sem JSON, ex.: Padicaio): primeiro `<img>` que
 *   pareça foto (extensão de imagem) e não pareça logo/banner do site.
 * Best-effort: `null` em qualquer falha (rede, sem imagem reconhecível). 1 requisição por LOTE —
 * bem mais caro que a captura em si (1 por leilão) — só usado quando `lots.image` já não existe.
 */
async function fetchLotPageImage(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const { publicFetch } = await import("./leiloesbr-auth.server");
    const html = await publicFetch(url, {});
    const vpasta = html.match(/"VPASTA"\s*:\s*"([^"]*)"/)?.[1];
    if (vpasta) return decodeHtmlEntities(vpasta.replace(/\\\//g, "/"));
    for (const m of html.matchAll(/<img[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const src = m[1] ?? "";
      if (LOT_IMG_EXT_RE.test(src) && !LOT_IMG_NOISE_RE.test(src)) return decodeHtmlEntities(src);
    }
    return null;
  } catch (error) {
    console.error(`[lot-sales] falha ao buscar a página do lote (${url})`, error);
    return null;
  }
}

/**
 * Backfill de thumbnail para vendas já gravadas em `lot_sales` ANTES (ou além do teto por
 * rodada) da captura ganhar essa etapa — cobre o HISTÓRICO, não só o fluxo novo. Duas fontes,
 * na ordem (mais barata primeiro): (1) `lots.image` — só funciona enquanto o lote ainda tiver
 * linha em `lots` (a janela é `WINDOW_DAYS` = 5 dias); (2) `fetchLotPageImage(source_url)` —
 * 1 requisição por LOTE à página do leiloeiro, fallback pro que `lots` já não tem mais. Só
 * quando NENHUMA das duas acha imagem é que a venda ganha o marcador `""` (tentado, sem fonte;
 * nunca mais reprocessado). Chunked como `compressimages`: chame em laço até `done=true`
 * (`step=salesthumbs`).
 */
// Pausa entre requisições à página do LOTE (fallback caro, site do leiloeiro) — nunca dispara
// vários de uma vez nem em sequência acelerada; `lots.image` (o caminho barato) não é pausado.
const LOT_PAGE_THROTTLE_MS = 350;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function backfillSaleThumbnails(max = 15): Promise<{
  scanned: number;
  updated: number;
  noSource: number;
  done: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from("lot_sales")
    .select("lot_id, source_url")
    .is("image", null)
    // Mais RECENTES primeiro: maior chance do lote ainda ter linha em `lots` (janela curta).
    .order("captured_at", { ascending: false })
    .limit(max);
  if (error) throw new Error(`Falha ao listar vendas sem thumbnail: ${error.message}`);
  const rows = (data ?? []) as { lot_id: string; source_url: string | null }[];
  if (!rows.length) return { scanned: 0, updated: 0, noSource: 0, done: true };
  const ids = rows.map((r) => r.lot_id);

  const { data: lotsData, error: lotsErr } = await supabaseAdmin
    .from("lots")
    .select("id, image")
    .in("id", ids);
  if (lotsErr) throw new Error(`Falha ao ler imagem dos lotes: ${lotsErr.message}`);
  const imgById = new Map<string, string>();
  for (const l of (lotsData ?? []) as { id: string; image: string | null }[]) {
    if (l.image) imgById.set(l.id, l.image);
  }

  let updated = 0;
  let noSource = 0;
  for (const row of rows) {
    let src = imgById.get(row.lot_id) ?? null;
    if (!src && row.source_url) {
      // Fallback caro (1 req à página do lote) — só quando `lots.image` já não existe mais.
      await sleep(LOT_PAGE_THROTTLE_MS);
      src = await fetchLotPageImage(row.source_url);
    }
    if (!src) {
      // Sem imagem em NENHUMA das duas fontes — marcador definitivo (`""`), não retenta.
      const { error: markErr } = await supabaseAdmin
        .from("lot_sales")
        .update({ image: "" })
        .eq("lot_id", row.lot_id);
      if (!markErr) noSource += 1;
      continue;
    }
    const url = await captureSaleThumbnail(row.lot_id, src);
    if (!url) continue; // falha transitória (rede/imagem) — retenta na próxima rodada
    const { error: upErr } = await supabaseAdmin
      .from("lot_sales")
      .update({ image: url })
      .eq("lot_id", row.lot_id);
    if (!upErr) updated += 1;
  }
  if (updated || noSource) noOrigCache = null;

  return { scanned: rows.length, updated, noSource, done: rows.length < max };
}

/**
 * ÚNICA VEZ (não faz parte do laço do cron): as vendas marcadas `""` (sem fonte) ANTES do
 * `fetchLotPageImage` existir foram julgadas sem checar a página do lote — resultado errado,
 * porque a foto sobrevive ao lote fechado (confirmado na prática, ver `fetchLotPageImage`).
 * Volta essas vendas pra `NULL` para `backfillSaleThumbnails` reavaliar com a lógica completa.
 * Rode uma vez (`step=resetnosourcethumbs`); depois disso o `""` volta a ser confiável e não
 * precisa mais desse reset.
 */
export async function resetNoSourceThumbnails(): Promise<{ reset: number }> {
  const { data, error } = await supabaseAdmin
    .from("lot_sales")
    .update({ image: null })
    .eq("image", "")
    .select("lot_id");
  if (error) throw new Error(`Falha ao resetar vendas sem fonte: ${error.message}`);
  const reset = (data ?? []).length;
  if (reset) noOrigCache = null;
  return { reset };
}

/**
 * Varredura pós-leilão: para os leilões JÁ CONHECIDOS (`seen_auctions`) que terminaram e
 * ainda não foram capturados, busca o catálogo UMA vez por leilão e grava as vendas em
 * `lot_sales`. Processa até `maxAuctions` por rodada (cursor em `app_state.sales_captured`),
 * então roda várias vezes até zerar o backlog (backfill retroativo + fluxo contínuo).
 * Retorna quantas vendas gravou, quantos leilões processou e se ainda há pendentes.
 *
 * **Fallback de IA**: das vendas que ficaram sem estado pelo regex mas TÊM texto descritivo,
 * até `AI_CONDITION_CAP` por rodada (somado entre os leilões do batch) passam por
 * `conditionAiSync` (só quando algum provedor está configurado — best-effort).
 *
 * **Thumbnail**: NÃO tentado aqui (o snapshot ao vivo que esta função usa nunca tem os lotes
 * que ela captura — ver comentário no corpo). Fica para o `backfillSaleThumbnails`, que roda
 * logo depois no cron e busca a imagem em `lots` (o banco), não no snapshot.
 */
export async function captureFinishedSales(maxAuctions = 8): Promise<{
  sales: number;
  auctions: number;
  remaining: number;
  done: boolean;
  aiUsed?: number;
  identUsed?: number;
}> {
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const { getSalesCaptured, markSalesCaptured } = await import("./app-state.server");
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  const { getAllLotIdent } = await import("./lot-ident.server");
  const { aiConfigured } = await import("./ai-eval.server");
  const aiOn = aiConfigured();

  const [seen, captured, snapshot, identRows] = await Promise.all([
    readSeenAuctions(),
    getSalesCaptured(),
    scrapeVinylLots(false),
    getAllLotIdent().catch(() => []),
  ]);
  const now = Date.now();

  // Identidade dos NOSSOS lotes de vinil (id → título/artista já parseados), com a qual nomeamos
  // a venda e priorizamos identidade LIMPA. Do snapshot da janela (título/artista) e, de forma
  // DURÁVEL, do `lot_ident` (álbum "Artista - Álbum") — cobre leilões que já saíram da janela e
  // casas cujo descritivo não vem no formato "Artista - Álbum" (ex.: Catavento).
  const vinylById = new Map<string, VinylInfo>();
  for (const r of identRows) {
    if (r.album) vinylById.set(r.id, { title: r.album, artist: extractArtist(r.album) });
  }
  for (const lot of snapshot.lots) vinylById.set(lot.id, { title: lot.title, artist: lot.artist });

  // Leilões terminados, com link de catálogo válido, ainda não capturados. Mais RECENTES
  // primeiro: o catálogo da casa só fica de pé por um tempo após o leilão (os antigos já
  // saíram do ar e devolvem página genérica sem lotes), então priorizamos os que ainda têm
  // catálogo vivo. Os antigos ainda são processados (e marcados) nas rodadas seguintes.
  const pending = seen
    .filter((a) => !captured.has(a.id_leilao))
    .filter((a) => auctionFinished(a.day_key, a.start_time, now))
    .map((a) => ({ row: a, ref: parseAuctionRef(a.entry_url ?? "") }))
    .filter(
      (x): x is { row: SeenAuctionRow; ref: { domain: string; idLeilao: string } } =>
        x.ref !== null,
    )
    .sort((a, b) => b.row.day_key.localeCompare(a.row.day_key));

  const batch = pending.slice(0, maxAuctions);
  let sales = 0;
  let aiUsed = 0;
  let identUsed = 0;
  const doneIds: string[] = [];
  for (const { row, ref } of batch) {
    try {
      const catalog = await fetchCatalogData(ref.domain, ref.idLeilao);
      const rows = salesRowsFromCatalog(
        {
          idLeilao: ref.idLeilao,
          domain: ref.domain,
          dayKey: row.day_key,
          house: row.house,
          uf: row.uf ?? "",
        },
        catalog,
        vinylById,
      );

      // Reident por IA: vendas cujo ARTISTA ficou genérico/lixo ("Colecionismo", "Duplo",
      // "Various Artists", "Ao Vivo"…) — a IA extrai "Artista - Álbum" corretos do texto do
      // catálogo. O resultado é gravado em `lot_ident` (durável, reaproveitado nas próximas
      // rodadas) e aplicado à venda agora. Teto por rodada, best-effort.
      // EXCLUI lotes CONFIRMADOS (`isDiscBundle`): o valor vendido é do CONJUNTO, então
      // atribuí-lo a um único artista/álbum que a IA "garimpe" no texto poluiria a média —
      // esses ficam com artista "Lote" e seguem ocultos do Analytics (`buildAnalytics`).
      if (aiOn && identUsed < AI_IDENT_CAP && rows.length) {
        const budget = AI_IDENT_CAP - identUsed;
        const candidates = rows
          .filter((r) => isGenericArtist(r.artist) && !isDiscBundle(r.title))
          .map((r) => ({ row: r, text: catalog.get(r.id_peca)?.text ?? "" }))
          .filter((c) => c.text.trim())
          .slice(0, budget);
        if (candidates.length) {
          const { identLotsSyncRows, resolveAiProvider } = await import("./ai-eval.server");
          const { upsertLotIdent } = await import("./lot-ident.server");
          const provider = await resolveAiProvider();
          const { rows: identOut } = await identLotsSyncRows(
            candidates.map((c) => ({
              id: c.row.lot_id,
              title: c.text,
              price: "",
              house: row.house,
              image: null,
            })),
            false,
            provider,
          );
          const withAlbum = identOut.filter((r) => r.album);
          if (withAlbum.length) await upsertLotIdent(withAlbum);
          const byId = new Map(withAlbum.map((r) => [r.id, r.album!]));
          for (const { row: saleRow } of candidates) {
            const album = byId.get(saleRow.lot_id);
            if (!album) continue;
            saleRow.title = album;
            saleRow.artist = extractArtist(album);
            identUsed += 1;
          }
        }
      }

      // Fallback de IA: só as vendas SEM estado pelo regex mas com texto pra IA ler, até
      // esgotar o teto da RODADA (soma entre os leilões deste batch).
      if (aiOn && aiUsed < AI_CONDITION_CAP && rows.length) {
        const budget = AI_CONDITION_CAP - aiUsed;
        const candidates = rows
          .filter((r) => !r.media && !r.sleeve && !r.insert_state)
          .map((r) => ({ row: r, text: catalog.get(r.id_peca)?.text ?? "" }))
          .filter((c) => c.text.trim())
          .slice(0, budget);
        if (candidates.length) {
          const { conditionAiSync, resolveAiProvider } = await import("./ai-eval.server");
          const provider = await resolveAiProvider();
          const { rows: aiRows } = await conditionAiSync(
            candidates.map((c) => ({ id: c.row.lot_id, text: c.text })),
            provider,
          );
          const byId = new Map(aiRows.map((r) => [r.id, r]));
          for (const { row: saleRow } of candidates) {
            const ai = byId.get(saleRow.lot_id);
            if (!ai) continue;
            const { media, sleeve, score, faixa } = scoreCondition(ai.media, ai.sleeve);
            if (media || sleeve) {
              saleRow.media = media ?? "";
              saleRow.sleeve = sleeve ?? "";
              saleRow.score = score;
              saleRow.faixa = faixa?.label ?? "";
              aiUsed += 1;
            }
            if (ai.insert !== null) saleRow.insert_state = ai.insert;
          }
        }
      }

      // Thumbnail: NÃO tentado aqui. `vinylById` vem da listagem geral AO VIVO
      // (`scrapeVinylLots`), que já não traz mais o lote assim que o leilão fica "ao vivo" —
      // exatamente os lotes que esta função captura (JÁ TERMINADOS) nunca estão nela. Fica
      // `image: null` e é resolvido pelo `backfillSaleThumbnails` (busca a imagem em `lots`, o
      // banco — não o snapshot ao vivo), que roda logo em seguida no mesmo cron e prioriza as
      // vendas mais recentes (`ORDER BY captured_at DESC`) — pega estas assim que capturadas.
      if (rows.length) sales += await upsertLotSales(rows);
      // Catálogo lido com sucesso → leilão capturado (não revisita), mesmo com 0 vendas
      // reconhecidas (leilão terminado tem catálogo estável).
      doneIds.push(ref.idLeilao);
    } catch (error) {
      console.error(`[lot-sales] falha ao capturar vendas do leilão ${ref.idLeilao}`, error);
      // Não marca como capturado → tenta de novo numa próxima rodada.
    }
  }
  if (doneIds.length) await markSalesCaptured(doneIds);

  const remaining = Math.max(0, pending.length - doneIds.length);
  return {
    sales,
    auctions: doneIds.length,
    remaining,
    done: remaining === 0,
    aiUsed,
    identUsed,
  };
}

// Teto de vendas por RODADA que passam pela IA de identificação (mantém a rodada barata/rápida;
// o laço do cron/UI chama de novo até `done`).
const REIDENT_CAP = 25;

/**
 * Reidentifica TODO o histórico de vendas (`lot_sales`) pela IA, ajustando **artista** e **nome
 * do álbum** e PADRONIZANDO a grafia dos nomes.
 *
 * 1) **IA (título + descrição → "Artista - Álbum")**: para as vendas que ainda NÃO foram
 *    identificadas (sem linha em `lot_ident`, o checkpoint durável) e têm texto, manda o título
 *    da venda (que embute a descrição capturada do catálogo) à IA com o provedor **padrão**
 *    (o selecionado no topo do site — Gemini, quando escolhido). Grava o resultado em
 *    `lot_ident` (durável, reaproveitado por Discogs/UI) — inclusive uma linha "tentado" com
 *    álbum nulo quando a IA não identifica, para não reprocessar à toa. Teto `max` por rodada.
 * 2) **Padronização (evita registros duplicados)**: reescreve artista/título de TODAS as vendas
 *    a partir da identificação (quando houver) e **canoniza a grafia do artista** entre
 *    variações que só diferem por acento/caixa/pontuação (mesmo `normalizeForMatch` → melhor
 *    grafia via `pickCanonical`). Corrige os casos em que "Jorge Ben" vs "Jorge ben " geravam
 *    dois registros. Só regrava as linhas que de fato mudam (idempotente).
 *
 * Sem provedor de IA configurado, o passo (1) é no-op e só a padronização (2) roda. Chame em
 * laço até `done` para cobrir todo o backlog de identificação.
 *
 * **Egress (Fase 1)**: no modo GLOBAL, o alvo da IA vem de uma RPC de anti-join no banco
 * (`getUnidentifiedLotSales`) em vez de baixar `lot_sales`+`lot_ident` inteiras a cada chamada —
 * essa era a causa raiz do consumo excessivo de rede/CPU nos free tiers usados antes da
 * migração pra VPS (ver docs/economia-fase-1-egress-e-cpu.md). A padronização (2) ainda lê o
 * histórico inteiro (precisa
 * comparar grafias de TODAS as vendas), mas sem `orig_text` — a coluna mais pesada por linha, que
 * essa etapa não usa.
 */
export async function reidentifyAllSales(
  max = REIDENT_CAP,
  opts?: { lotIds?: string[] },
): Promise<{
  identified: number;
  applied: number;
  processed: number;
  remaining: number;
  done: boolean;
}> {
  const { getAllLotIdent, upsertLotIdent } = await import("./lot-ident.server");
  const { aiConfigured, identLotsSync, resolveAiProvider, titleHash } =
    await import("./ai-eval.server");

  const identRows = await getAllLotIdent().catch(() => []);
  const albumById = new Map<string, string>();
  for (const r of identRows) if (r.album) albumById.set(r.id, r.album);

  // Texto que a IA lê: prefere o descritivo ORIGINAL do catálogo (`orig_text`) — mais fiel que o
  // `title`, que a reidentificação pode já ter reescrito. Cai no título quando não há.
  const aiInput = (s: LotSaleRow): string => (s.orig_text?.trim() || s.title || "").trim();
  const cap = Math.max(1, max);
  const scope = opts?.lotIds?.length ? new Set(opts.lotIds) : null;

  let identified = 0;
  let processed = 0;
  let moreAiPending = false;
  let scopedSales: LotSaleRow[] | null = null;

  if (scope) {
    // POR GRUPO: conjunto já bounded pelo chamador (≤500 ids) — busca SÓ esses, com `orig_text`
    // (a IA precisa do texto). RETENTA os ainda não identificados com sucesso (álbum nulo/sem
    // linha); não rebaixa uma identificação a nulo numa retentativa que a IA não resolveu.
    scopedSales = await getAllLotSales({ ids: [...scope] });
    const needAi = scopedSales.filter(
      (s) => !albumById.has(s.lot_id) && aiInput(s) && !isDiscBundle(aiInput(s)),
    );
    const batch = needAi.slice(0, cap);
    processed = batch.length;
    moreAiPending = needAi.length > batch.length;
    if (aiConfigured() && batch.length) {
      const provider = await resolveAiProvider();
      const results = await identLotsSync(
        batch.map((s) => ({
          id: s.lot_id,
          title: aiInput(s),
          price: "",
          house: s.house,
          image: null,
        })),
        false,
        provider,
      );
      const byId = new Map(results.map((r) => [r.id, r]));
      const identNew = batch
        .map((s) => {
          const r = byId.get(s.lot_id);
          return {
            id: s.lot_id,
            title_hash: titleHash(s.title),
            album: r?.album ?? null,
            year: r?.year ?? null,
            confidence: r?.confidence ?? null,
            source: "title" as const,
            model: null,
          };
        })
        .filter((row) => row.album != null);
      if (identNew.length) await upsertLotIdent(identNew);
      for (const r of identNew) {
        if (r.album) {
          albumById.set(r.id, r.album);
          identified += 1;
        }
      }
    }
  } else {
    // GLOBAL: pede ao banco só as vendas SEM linha em `lot_ident` (anti-join), numa JANELA maior
    // que `cap` — cobre os lotes que a janela vai marcar como "tentado" sem gastar IA neles
    // (sem texto, ou `isDiscBundle`: o valor vendido é do CONJUNTO, então "achar" um artista/álbum
    // ali reescreveria a venda com o preço do lote inteiro — ficam com artista "Lote" e seguem
    // ocultos em `buildAnalytics`). Sem marcar esses como tentados, eles voltariam a ocupar a
    // janela em TODA chamada seguinte e o laço nunca chegaria a `done`.
    const windowSize = Math.max(cap * 4, 200);
    const probe = await getUnidentifiedLotSales(windowSize + 1);
    moreAiPending = probe.length > windowSize;
    const window = probe.slice(0, windowSize);

    const skipMarks: LotIdentRow[] = [];
    const candidates: LotSaleRow[] = [];
    for (const s of window) {
      const text = aiInput(s);
      if (!text || isDiscBundle(text)) {
        skipMarks.push({
          id: s.lot_id,
          title_hash: titleHash(s.title),
          album: null,
          year: null,
          confidence: null,
          source: "title",
          model: null,
        });
        continue;
      }
      candidates.push(s);
    }
    const batch = candidates.slice(0, cap);
    processed = batch.length + skipMarks.length;
    moreAiPending = moreAiPending || candidates.length > batch.length;

    let identNew: LotIdentRow[] = skipMarks;
    if (aiConfigured() && batch.length) {
      const provider = await resolveAiProvider();
      const results = await identLotsSync(
        batch.map((s) => ({
          id: s.lot_id,
          title: aiInput(s),
          price: "",
          house: s.house,
          image: null,
        })),
        false,
        provider,
      );
      const byId = new Map(results.map((r) => [r.id, r]));
      // GLOBAL grava lot_ident para TODOS os processados (álbum nulo → marca "já tentado", não
      // reprocessa).
      identNew = identNew.concat(
        batch.map((s) => {
          const r = byId.get(s.lot_id);
          return {
            id: s.lot_id,
            title_hash: titleHash(s.title),
            album: r?.album ?? null,
            year: r?.year ?? null,
            confidence: r?.confidence ?? null,
            source: "title" as const,
            model: null,
          };
        }),
      );
    }
    if (identNew.length) await upsertLotIdent(identNew);
    for (const r of identNew) {
      if (r.album) {
        albumById.set(r.id, r.album);
        identified += 1;
      }
    }
  }

  // 2) Padronização: artista-alvo de cada venda (da identificação quando houver, senão o atual).
  // GLOBAL lê o histórico inteiro, mas SEM `orig_text` — essa etapa só usa artista/título.
  const sales = scope ? scopedSales! : await getAllLotSales({ withOrig: false });
  const targetArtist = (s: LotSaleRow): string => {
    const album = albumById.get(s.lot_id);
    return (album ? extractArtist(album) : s.artist)?.trim() || "";
  };
  // Mapa canônico por chave normalizada (junta variações de grafia do mesmo artista).
  const variantsByKey = new Map<string, string[]>();
  for (const s of sales) {
    const a = targetArtist(s);
    const key = normalizeForMatch(a);
    if (!a || !key) continue;
    const list = variantsByKey.get(key) ?? [];
    list.push(a);
    variantsByKey.set(key, list);
  }
  const canonicalArtist = (a: string): string => {
    const variants = variantsByKey.get(normalizeForMatch(a));
    return variants?.length ? pickCanonical(variants) : a;
  };

  // Universo de álbuns JÁ CONHECIDOS por artista (chave = artista CANÔNICO normalizado): base
  // para a IA agregar ao bucket de álbum que já existe em vez de criar um quase-duplicado por
  // pequena diferença de grafia/edição. O artista é sempre a chave principal — só entram álbuns
  // do MESMO artista canônico; o álbum vem em segundo lugar, dentro desse universo.
  const albumsByArtist = new Map<string, string[]>();
  for (const s of sales) {
    const artistCanon = canonicalArtist(targetArtist(s) || s.artist);
    const artistKey = normalizeForMatch(artistCanon);
    if (!artistKey) continue;
    const guess = deriveAlbum(s.title, artistCanon);
    if (!guess || guess === "(álbum não identificado)") continue;
    const list = albumsByArtist.get(artistKey) ?? [];
    list.push(guess);
    albumsByArtist.set(artistKey, list);
  }

  // Regrava só as vendas que mudam (título/artista canonizados). SEM `orig_text` na leitura
  // GLOBAL (slim) — omite a chave do payload em vez de mandar "" (que apagaria o texto original
  // já gravado; ver `upsertLotSales`).
  const changed: (Omit<LotSaleRow, "orig_text"> & { orig_text?: string })[] = [];
  for (const s of sales) {
    const album = albumById.get(s.lot_id);
    const rawArtist = (album ? extractArtist(album) : s.artist)?.trim() || s.artist;
    const newArtist = canonicalArtist(rawArtist);
    // Álbum recém-identificado pela IA: verifica o mais provável já existente NO UNIVERSO deste
    // artista (canônico) e agrega a ele, em vez de gravar a grafia nova da IA como se fosse um
    // álbum diferente. Sem identificação nova (venda já resolvida em rodada anterior), mantém o
    // título como está.
    let newTitle = s.title;
    if (album) {
      const albumPart = extractAlbumPart(album) || album;
      const existingAlbums = albumsByArtist.get(normalizeForMatch(newArtist)) ?? [];
      const finalAlbum = matchExistingAlbum(albumPart, existingAlbums) ?? albumPart;
      newTitle = `${newArtist} - ${finalAlbum}`;
    }
    if (newArtist !== s.artist || newTitle !== s.title) {
      const { orig_text: _origText, ...base } = s;
      changed.push(
        scope
          ? { ...s, artist: newArtist, title: newTitle }
          : { ...base, artist: newArtist, title: newTitle },
      );
    }
  }
  const applied = changed.length ? await upsertLotSales(changed) : 0;

  const remaining = moreAiPending ? 1 : 0;
  return { identified, applied, processed, remaining, done: remaining === 0 };
}

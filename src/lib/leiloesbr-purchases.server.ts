import { authFetch, BASE_URL } from "./leiloesbr-auth.server";
import { parseAuctionRef } from "./leiloesbr-catalog.server";
import { looksNonVinyl } from "./vinyl-parse";

/**
 * Um lote ARREMATADO pelo usuário, lido da página "Minhas compras"
 * (conta_site.asp?l=6). Espelha o parser de "Meus lances" (l=4) — mesma
 * estrutura de card `.oc-item` da plataforma LeilõesBR. Alimenta a coleção:
 * cada lote de vinil arrematado vira um item de `collection_items`.
 *
 * ⚠️ A estrutura exata do HTML de `l=6` não é testável daqui (sem rede aos
 * sites). Por isso o parser é DEFENSIVO (mesmos fallbacks do l=4). Se algum
 * campo vier vazio na prévia, ajustar os regexes com 1 card real do HTML.
 */
export type WonLot = {
  id: string; // `${idLeilao}-${idPeca}` — mesma chave da varredura geral (lots.id)
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string;
  title: string;
  wonPrice: string; // valor pago/arrematado ("R$ 70,00")
  wonDate: string; // dd/mm/yyyy
  url: string; // link do lote (abre_catalogo.asp) no leiloeiro
  image: string | null;
  house: string;
  uf: string;
  domain: string | null; // domínio da casa, extraído do link (parseAuctionRef)
};

const looksAnonymous = (html: string) => !html.includes("data-watch") && !html.includes("data-fav");

const decode = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function parsePurchaseChunk(chunk: string): WonLot | null {
  const flat = chunk.replace(/\s+/g, " ");
  const grab = (re: RegExp) => decode(flat.match(re)?.[1] ?? "");

  // idPeca,email,idLeilao,base — no botão de vigia (ou favorito) do card. O HTML CRU do
  // ASP mistura aspas simples e duplas nos atributos (o "Copy outerHTML" do navegador
  // normaliza p/ duplas, mascarando isso), então todos os regexes aqui aceitam ['"].
  const data = (
    flat.match(/data-watch=['"]([^'"]+)['"]/)?.[1] ??
    flat.match(/data-fav=['"]([^'"]+)['"]/)?.[1] ??
    ""
  ).split(",");
  const idPeca = data[0]?.trim() || flat.match(/peca\.asp\?ID=(\d+)/i)?.[1] || "";
  if (!idPeca) return null;

  const idLeilao = data[2]?.trim() || flat.match(/leilao\.asp\?Num=(\d+)/i)?.[1] || "";

  // Título: SÓ o texto do <a> dentro de `.product-title` (removido o "Lote: N" e as tags).
  // NÃO usar um regex frouxo tipo `product-title.*?<a...title=...` — ele atravessava até o
  // link de "Histórico de lances" (tooltip) e virava o "título" de todos os lotes.
  const anchorInner = flat.match(/product-title[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
  const title = decode(
    anchorInner.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, " ").replace(/<[^>]+>/g, " "),
  );

  const url = (
    grab(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"][^'"]*stretched-link/i) || BASE_URL
  ).trim();
  const ref = parseAuctionRef(url);

  return {
    id: `${idLeilao}-${idPeca}`,
    idPeca,
    idLeilao,
    base: data[3]?.trim() ?? "0",
    // nº do lote: do title="Lote-N" (stretched-link) ou do <b> dentro do span "Lote:".
    lote: grab(/title=['"]Lote-?([^'"]*)['"]/i) || grab(/Lote:\s*<b[^>]*>([^<]+)<\/b>/i),
    title,
    url,
    // valor pago: a classe do <b> tem outras palavras além de pb-1 ("pb-1 font-size-1-0").
    wonPrice: grab(/<b[^>]*\bpb-1\b[^>]*>([^<]+)</i),
    // data do arremate = data do leilão ("Leilão <b>N</b> - dd/mm/yyyy"); cai p/ a 1ª data.
    wonDate:
      grab(/Leil[aã]o\s*<b>\d+<\/b>\s*-\s*(\d{2}\/\d{2}\/\d{4})/i) ||
      flat.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ||
      "",
    image: grab(/<img[^>]*\ssrc=['"]([^'"]+)['"]/i) || null,
    // casa: texto do link em `.ellipsis-overflow` (l=6 não traz o "- UF"/pesq-uf).
    house: grab(/ellipsis-overflow[^>]*>(?:\s*<a[^>]*>)?\s*([^<]+?)\s*</i),
    uf: grab(/class=['"]pesq-uf['"]>([^<]+)</i),
    domain: ref?.domain ?? null,
  };
}

/**
 * Lê uma aba (`t`) de "Minhas compras" página a página, acrescentando ao `out` os lotes
 * NOVOS (dedup por `idPeca` via `seen`). Para na 1ª página sem lote novo (fim da lista ou
 * repetição da última quando `pag` passa do fim). Retorna quantas páginas com card leu e se
 * viu uma página logada (tem `data-watch`/`data-fav`).
 */
async function readTab(
  t: 0 | 1,
  seen: Set<string>,
  out: WonLot[],
): Promise<{ pagesWithCards: number; loggedIn: boolean }> {
  let pagesWithCards = 0;
  let loggedIn = false;
  // Teto alto de segurança (o loop para sozinho na 1ª página sem lotes novos); dá folga
  // para a lista de compras crescer com o tempo (mais páginas).
  for (let page = 1; page <= 50; page++) {
    const html = await authFetch(
      `${BASE_URL}/conta_site.asp?l=6&t=${t}&s=0&b=0&id=0&p=&order=0&pag=${page}`,
      {},
      page === 1 ? looksAnonymous : undefined,
    );
    if (html.includes("data-watch") || html.includes("data-fav")) loggedIn = true;

    let added = 0;
    const chunks = html.split('<div class="oc-item').slice(1);
    if (chunks.length) pagesWithCards += 1;
    for (const chunk of chunks) {
      const won = parsePurchaseChunk(chunk);
      if (!won || seen.has(won.idPeca)) continue;
      seen.add(won.idPeca);
      out.push(won);
      added++;
    }
    if (added === 0) break;
  }
  return { pagesWithCards, loggedIn };
}

/**
 * Lê todos os lotes arrematados da conta (conta_site.asp?l=6), **mesclando as abas
 * `t=1` e `t=0`** (dedup por `idPeca`). O navegador do usuário mostra `t=1`, mas na sessão
 * do SERVIDOR foi o `t=0` que devolveu as compras reais no 1º teste — então lemos as duas
 * para não depender de qual o servidor popula. Best-effort.
 */
export async function listPurchasesFromSite(): Promise<WonLot[]> {
  const seen = new Set<string>();
  const out: WonLot[] = [];
  await readTab(1, seen, out);
  await readTab(0, seen, out);
  return out;
}

/** Só os lotes que parecem vinil (descarta CD/DVD/K7 pelo título). */
export async function listVinylPurchases(): Promise<WonLot[]> {
  const all = await listPurchasesFromSite();
  return all.filter((w) => !looksNonVinyl(w.title));
}

/**
 * Diagnóstico da varredura (não persiste). Retorna, por aba, quantas páginas com card,
 * se viu página logada, e o total de lotes lidos + uma amostra de títulos — para saber, sem
 * acesso ao site daqui, se o problema é login, aba (`t`) ou parsing.
 */
export async function debugPurchases(): Promise<{
  loggedIn: boolean;
  tabs: { t: number; pagesWithCards: number; loggedIn: boolean }[];
  total: number;
  vinyl: number;
  sampleTitles: string[];
}> {
  const tabs: { t: number; pagesWithCards: number; loggedIn: boolean }[] = [];
  const seen = new Set<string>();
  const out: WonLot[] = [];
  for (const t of [1, 0] as const) {
    const r = await readTab(t, seen, out);
    tabs.push({ t, ...r });
  }
  const vinyl = out.filter((w) => !looksNonVinyl(w.title));
  return {
    loggedIn: tabs.some((x) => x.loggedIn),
    tabs,
    total: out.length,
    vinyl: vinyl.length,
    sampleTitles: out.slice(0, 8).map((w) => w.title || "(título vazio)"),
  };
}

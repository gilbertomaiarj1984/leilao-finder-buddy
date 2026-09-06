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

  // idPeca,email,idLeilao,base — no botão de vigia (ou favorito) do card.
  const data = (
    flat.match(/data-watch="([^"]+)"/)?.[1] ??
    flat.match(/data-fav="([^"]+)"/)?.[1] ??
    ""
  ).split(",");
  const idPeca = data[0]?.trim() || flat.match(/peca\.asp\?ID=(\d+)/i)?.[1] || "";
  if (!idPeca) return null;

  const idLeilao = data[2]?.trim() || flat.match(/leilao\.asp\?Num=(\d+)/i)?.[1] || "";
  const dateMatch = flat.match(/(\d{2}\/\d{2}\/\d{4})/);
  const url = grab(/<a href="([^"]+)"[^>]*class="stretched-link"/) || BASE_URL;
  const ref = parseAuctionRef(url);

  return {
    id: `${idLeilao}-${idPeca}`,
    idPeca,
    idLeilao,
    base: data[3]?.trim() ?? "0",
    lote: grab(/title="Lote-?([^"]*)"/),
    title: grab(/product-title.*?<a [^>]*title='([^']+)'/) || grab(/<\/span><br>\s*([^<]+)/),
    wonPrice: grab(/<b class="pb-1"[^>]*>([^<]+)</),
    wonDate: dateMatch?.[1] ?? "",
    url,
    image: grab(/<img[^>]*src="([^"]+)"/) || null,
    house: grab(/ellipsis-overflow">(?:<a[^>]*>)?([^<]+?)\s*-\s*<span class="pesq-uf"/),
    uf: grab(/class="pesq-uf">([^<]+)</),
    domain: ref?.domain ?? null,
  };
}

/**
 * Lê todos os lotes arrematados da conta (conta_site.asp?l=6). t=0 (peças),
 * s=0 (leilões), b=0 (base LeilõesBR). Best-effort: para na 1ª página vazia.
 */
export async function listPurchasesFromSite(): Promise<WonLot[]> {
  const seen = new Set<string>();
  const out: WonLot[] = [];

  for (let page = 1; page <= 20; page++) {
    const html = await authFetch(
      `${BASE_URL}/conta_site.asp?l=6&t=0&s=0&b=0&id=0&p=&order=0&pag=${page}`,
      {},
      page === 1 ? looksAnonymous : undefined,
    );

    let added = 0;
    for (const chunk of html.split('<div class="oc-item').slice(1)) {
      const won = parsePurchaseChunk(chunk);
      if (!won || seen.has(won.idPeca)) continue;
      seen.add(won.idPeca);
      out.push(won);
      added++;
    }

    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }

  return out;
}

/** Só os lotes que parecem vinil (descarta CD/DVD/K7 pelo título). */
export async function listVinylPurchases(): Promise<WonLot[]> {
  const all = await listPurchasesFromSite();
  return all.filter((w) => !looksNonVinyl(w.title));
}

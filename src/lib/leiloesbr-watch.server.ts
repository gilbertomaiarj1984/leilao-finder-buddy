import { authFetch, BASE_URL, loginEmail } from "./leiloesbr-auth.server";
import { extractArtist } from "./vinyl-parse";

export type WatchTarget = { idPeca: string; idLeilao: string; base: string };

/** Toggles the watch flag on the LeilõesBR account. Returns the resulting state. */
export async function toggleWatchOnSite(target: WatchTarget, desired: boolean): Promise<boolean> {
  const body = new URLSearchParams({
    idpeca: target.idPeca,
    idcliente: loginEmail(),
    idleilao: target.idLeilao,
    base: target.base || "0",
  }).toString();

  const run = async () => {
    const text = (
      await authFetch(`${BASE_URL}/portal/assets/modulos/vigia-favorita/vigiar_peca.asp`, {
        method: "POST",
        body,
        referer: `${BASE_URL}/busca_andamento.asp`,
      })
    ).trim();
    // The endpoint is a toggle: "+" means now watched, "-" means removed.
    if (text !== "+" && text !== "-") {
      throw new Error("O LeilõesBR não confirmou a vigia deste lote.");
    }
    return text === "+";
  };

  let state = await run();
  if (state !== desired) state = await run();
  if (state !== desired) {
    throw new Error("Não foi possível sincronizar a vigia com o LeilõesBR.");
  }
  return state;
}

export type WatchedLot = {
  id: string;
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string;
  title: string;
  url: string;
  image: string | null;
  price: string;
  date: string; // dd/mm/yyyy
  time: string;
  house: string;
  houseUrl: string;
  uf: string;
  artist: string;
  watched: true;
};

const looksAnonymous = (html: string) => !html.includes("data-watch");
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

function parseWatchedChunk(chunk: string): WatchedLot | null {
  const data = (chunk.match(/data-watch="([^"]+)"/)?.[1] ?? "").split(",");
  const idPeca = data[0]?.trim();
  if (!idPeca) return null;
  if (!/class="[^"]*\bwatch\b[^"]*\bativo\b[^"]*"/.test(chunk)) return null;

  const flat = chunk.replace(/\s+/g, " ");
  const grab = (re: RegExp) => decode(flat.match(re)?.[1] ?? "");
  const title = grab(/<\/span><br>\s*([^<]+)/);
  const dateTime = flat.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*([\dh:]+)/);

  return {
    id: `${data[2]?.trim() ?? ""}-${idPeca}`,
    idPeca,
    idLeilao: data[2]?.trim() ?? "",
    base: data[3]?.trim() ?? "0",
    lote: grab(/title="Lote-?([^"]*)"/),
    title,
    url: grab(/<a href="([^"]+)"[^>]*class="stretched-link"/) || BASE_URL,
    image: grab(/<img[^>]*src="([^"]+)"/) || null,
    price: grab(/<b class="pb-1">([^<]+)</),
    date: dateTime?.[1] ?? "",
    time: dateTime?.[2] ?? "",
    house: grab(/ellipsis-overflow"><a href="[^"]*">([^<]+?)\s*-\s*</),
    houseUrl: grab(/ellipsis-overflow"><a href="([^"]+)"/),
    uf: grab(/class="pesq-uf">([^<]+)</),
    artist: extractArtist(title),
    watched: true,
  };
}

/** Reads every watched lot straight from the account page (conta_site.asp?l=8). */
export async function listWatchedFromSite(): Promise<WatchedLot[]> {
  const seen = new Set<string>();
  const out: WatchedLot[] = [];

  for (let page = 1; page <= 20; page++) {
    const html = await authFetch(
      `${BASE_URL}/conta_site.asp?l=8&t=0&s=0&b=0&id=0&p=&order=0&pag=${page}`,
      {},
      page === 1 ? looksAnonymous : undefined,
    );

    let added = 0;
    for (const chunk of html.split('<div class="oc-item').slice(1)) {
      const lot = parseWatchedChunk(chunk);
      if (!lot || seen.has(lot.idPeca)) continue;
      seen.add(lot.idPeca);
      out.push(lot);
      added++;
    }

    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }

  return out;
}

import { parse } from "node-html-parser";

import { authFetch, BASE_URL, loginEmail } from "./leiloesbr-auth.server";
import { extractArtist, type VinylLot } from "./vinyl-parse";

export type WatchTarget = { idPeca: string; idLeilao: string; base: string };

/** Toggles the watch flag on the LeilõesBR account. Returns the resulting state. */
export async function toggleWatchOnSite(target: WatchTarget, desired: boolean): Promise<boolean> {
  const body = new URLSearchParams({
    idpeca: target.idPeca,
    idcliente: loginEmail(),
    idleilao: target.idLeilao,
    base: target.base || "0",
  }).toString();

  const run = async () =>
    (
      await authFetch(
        `${BASE_URL}/portal/assets/modulos/vigia-favorita/vigiar_peca.asp`,
        { method: "POST", body, referer: `${BASE_URL}/busca_andamento.asp` },
      )
    ).trim();

  let result = await run();
  // The endpoint is a toggle: "+" means it is now watched, "-" means removed.
  if (result !== "+" && result !== "-") {
    throw new Error("O LeilõesBR não confirmou a vigia deste lote.");
  }
  let state = result === "+";
  if (state !== desired) {
    result = await run();
    if (result !== "+" && result !== "-") {
      throw new Error("O LeilõesBR não confirmou a vigia deste lote.");
    }
    state = result === "+";
  }
  if (state !== desired) {
    throw new Error("Não foi possível sincronizar a vigia com o LeilõesBR.");
  }
  return state;
}

export type WatchedLot = Pick<
  VinylLot,
  "id" | "idPeca" | "idLeilao" | "base" | "title" | "url" | "image" | "price" | "artist"
> & { lote: string; watched: true };

const looksAnonymous = (html: string) => !html.includes("data-watch");

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
    const root = parse(html);
    const cards = root.querySelectorAll(".product");
    let added = 0;

    for (const card of cards) {
      const watch = card.querySelector("[data-watch]");
      const data = (watch?.getAttribute("data-watch") ?? "").split(",");
      const idPeca = data[0]?.trim();
      if (!idPeca || seen.has(idPeca)) continue;

      const anchor = card.querySelector(".product-title a") ?? card.querySelector("a.stretched-link");
      const rawTitle = (anchor?.text ?? "").replace(/\s+/g, " ").trim();
      const title = rawTitle.replace(/^Lote:?\s*\d+\s*/i, "").trim();

      seen.add(idPeca);
      added++;
      out.push({
        id: `${data[2]?.trim() ?? ""}-${idPeca}`,
        idPeca,
        idLeilao: data[2]?.trim() ?? "",
        base: data[3]?.trim() ?? "0",
        lote: (card.querySelector("a.stretched-link")?.getAttribute("title") ?? "").replace(/^Lote-?/i, ""),
        title: title || rawTitle,
        url: (card.querySelector("a.stretched-link")?.getAttribute("href") ?? BASE_URL).trim(),
        image: card.querySelector("img")?.getAttribute("src") ?? null,
        price: (card.querySelector(".product-price b")?.text ?? "").trim(),
        artist: extractArtist(title),
        watched: true,
      });
    }

    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }

  return out;
}

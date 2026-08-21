import { parse, type HTMLElement } from "node-html-parser";

import { authFetch, BASE_URL } from "./leiloesbr-auth.server";
import {
  extractArtist,
  isVinylTitle,
  parseInfoLine,
  upcomingDayKeys,
  type VinylLot,
} from "./vinyl-parse";

const VINYL_CATEGORY = "|446973636F2064652076696E696C|";
const PER_PAGE = 126;
const MAX_PAGES = 45;
const CACHE_TTL_MS = 15 * 60 * 1000;

type CacheEntry = { at: number; days: string[]; lots: VinylLot[] };
let cache: CacheEntry | null = null;

export function invalidateLotsCache(): void {
  cache = null;
}

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

// Logged-in listings render the watch button; its absence means the session died.
const looksAnonymous = (html: string) =>
  html.includes("mostbidded") && !html.includes("data-watch");

async function fetchPage(page: number): Promise<string> {
  return await authFetch(listUrl(page), {}, looksAnonymous);
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
  const title = (titleAnchor?.getAttribute("title") ?? card.querySelector("h3")?.text ?? "").trim();
  if (!title) return null;

  const infoNodes = card.querySelectorAll(".mostbidded__info");
  const info = parseInfoLine(infoNodes[0]?.text ?? "");
  if (!info) return null;

  const houseAnchor = infoNodes[infoNodes.length - 1]?.querySelector("a");
  const idMatch = href.match(/\|(\d+)\|(\d+)/);

  const watchAnchor = card.querySelector("[data-watch]");
  const watchData = (watchAnchor?.getAttribute("data-watch") ?? "").split(",");

  return {
    id: idMatch ? `${idMatch[1]}-${idMatch[2]}` : href,
    idPeca: watchData[0]?.trim() ?? idMatch?.[2] ?? "",
    idLeilao: watchData[2]?.trim() ?? idMatch?.[1] ?? "",
    base: watchData[3]?.trim() ?? "0",
    watched: (watchAnchor?.getAttribute("class") ?? "").split(/\s+/).includes("ativo"),
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

/**
 * The category listing sorted by "próximos leilões" (op=3) is ordered by date
 * descending, so the closest auction days live on the LAST pages. We walk
 * backwards from the last page until every lot on a page is beyond the window.
 */
export async function scrapeVinylLots(): Promise<{ days: string[]; lots: VinylLot[] }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { days: cache.days, lots: cache.lots };
  }

  const days = upcomingDayKeys(3);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;

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
      if (lot.dayKey < windowStart || lot.dayKey > windowEnd) continue;
      if (!isVinylTitle(lot.title)) continue;
      byId.set(lot.id, lot);
    }

    // Pages are date-descending: once the whole page sits after the window we stop.
    const minDay = lots.reduce((min, lot) => (lot.dayKey < min ? lot.dayKey : min), "9999-99-99");
    if (minDay > windowEnd) break;
  }

  const lots = [...byId.values()].sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      a.house.localeCompare(b.house, "pt-BR") ||
      a.title.localeCompare(b.title, "pt-BR"),
  );

  cache = { at: Date.now(), days, lots };
  return { days, lots };
}

import { parse, type HTMLElement } from "node-html-parser";

import { publicFetch, BASE_URL } from "./leiloesbr-auth.server";
import {
  extractArtist,
  isVinylTitle,
  parseInfoLine,
  upcomingDayKeys,
  type VinylLot,
} from "./vinyl-parse";

const VINYL_CATEGORY = "|446973636F2064652076696E696C|";
const PER_PAGE = 126;
const WINDOW_DAYS = 10; // quantos dias de leilões trazer (hoje + próximos)
const MAX_PAGES = 150; // teto de páginas por varredura (janela maior = mais páginas)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h: a lista muda pouco; atualização manual quando preciso

// Cache/merge em memória: GARANTE a lista mesmo que o banco esteja indisponível
// (ex.: migração ainda não aplicada). O banco é usado como camada durável quando
// disponível — a UI nunca fica vazia por causa do banco.
let memCache: { at: number; days: string[]; lots: VinylLot[] } | null = null;

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
  const title = (titleAnchor?.getAttribute("title") ?? card.querySelector("h3")?.text ?? "").trim();
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

  // Número do lote exibido: tenta o atributo title="Lote-XXX" e, senão, o texto do título.
  const lote = (
    raw.match(/title="Lote-?\s*([^"]+)"/i)?.[1] ??
    title.match(/\blote\s*n?[ºo°]?\s*[:.\-]?\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
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
 * Percorre as páginas (op=3, decrescentes por data — os dias mais próximos ficam
 * nas ÚLTIMAS páginas) coletando lotes de vinil que passem em `keep`, parando
 * assim que uma página inteira já está além de `stopDay`.
 */
async function scrapePages(
  keep: (lot: VinylLot) => boolean,
  stopDay: string,
): Promise<VinylLot[]> {
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
      if (!isVinylTitle(lot.title)) continue;
      if (keep(lot)) byId.set(lot.id, lot);
    }
    const minDay = lots.reduce((min, lot) => (lot.dayKey < min ? lot.dayKey : min), "9999-99-99");
    if (minDay > stopDay) break;
  }
  return [...byId.values()];
}

/** Faz upsert dos lotes no banco e registra os leilões vistos (best-effort). */
async function persistLots(fresh: VinylLot[]): Promise<void> {
  if (!fresh.length) return;
  try {
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
    await supabaseAdmin.from("lots").upsert(rows, { onConflict: "id" });
  } catch (error) {
    console.error("[leiloesbr] não foi possível salvar os lotes", error);
  }
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
 * Retorna os lotes da janela. A fonte GARANTIDA é o cache/merge em memória; o
 * banco é camada durável quando disponível (não quebra se a tabela não existir).
 * Varre o site quando está "stale" ou em `force`, mescla tudo por id (sem apagar)
 * e faz upsert best-effort — o "atualizar" acrescenta diferenças.
 */
export async function scrapeVinylLots(force = false): Promise<{ days: string[]; lots: VinylLot[] }> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;

  const stale =
    force ||
    !memCache ||
    memCache.days[0] !== windowStart ||
    Date.now() - memCache.at >= CACHE_TTL_MS;

  let fresh: VinylLot[] = [];
  if (stale) {
    try {
      fresh = await scrapePages(
        (lot) => lot.dayKey >= windowStart && lot.dayKey <= windowEnd,
        windowEnd,
      );
    } catch (error) {
      console.error("[leiloesbr] varredura falhou; usando o que já temos", error);
    }
    await fillArtists(fresh);
  }

  const lots = await mergeSources(windowStart, windowEnd, fresh);
  memCache = { at: stale ? Date.now() : memCache?.at ?? Date.now(), days, lots };

  if (fresh.length) {
    try {
      await persistLots(fresh);
      await pruneOutOfWindow(windowStart, windowEnd);
    } catch (error) {
      console.error("[leiloesbr] não foi possível persistir os lotes", error);
    }
  }
  return { days, lots };
}

/** Re-varre apenas UM dia, mescla (não apaga os demais) e faz upsert best-effort. */
export async function refreshVinylDay(day: string): Promise<{ days: string[]; lots: VinylLot[] }> {
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;
  if (!days.includes(day)) return await scrapeVinylLots(true);

  let fresh: VinylLot[] = [];
  try {
    fresh = await scrapePages((lot) => lot.dayKey === day, day);
  } catch (error) {
    console.error("[leiloesbr] varredura do dia falhou", error);
  }
  await fillArtists(fresh);

  const lots = await mergeSources(windowStart, windowEnd, fresh);
  memCache = { at: memCache?.at ?? Date.now(), days, lots };

  if (fresh.length) {
    try {
      await persistLots(fresh);
    } catch (error) {
      console.error("[leiloesbr] não foi possível persistir os lotes do dia", error);
    }
  }
  return { days, lots };
}



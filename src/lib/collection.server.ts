import { fmtMoney, parseAiAlbum, toLotMarket } from "@/components/vinyl/ai-score-utils";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { extractArtist, normalizeForMatch, titleCase } from "@/lib/vinyl-parse";

import type { WonLot } from "./leiloesbr-purchases.server";
import type { LotMarketRow } from "./lot-market.server";

/**
 * Um disco da coleção do usuário, como a UI consome (camelCase; espelha as colunas
 * de `collection_items`). Populado à mão e pela varredura de "Minhas compras" (l=6).
 */
export type CollectionItem = {
  id: string;
  lotId: string | null;
  source: string; // 'auction' | 'manual'
  artist: string;
  album: string;
  title: string;
  year: number | null;
  image: string | null;
  house: string;
  uf: string;
  wonPrice: string;
  wonDate: string | null; // yyyy-mm-dd
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  tags: string[];
  marketLow: string | null;
  marketHigh: string | null;
  sourceUrl: string;
  position: number;
};

const COLS =
  "id, lot_id, source, artist, album, title, year, image, house, uf, won_price, won_date, condition_media, condition_sleeve, notes, tags, market_low, market_high, source_url, position";
const PAGE = 1000;

type DbRow = {
  id: string;
  lot_id: string | null;
  source: string | null;
  artist: string | null;
  album: string | null;
  title: string | null;
  year: number | null;
  image: string | null;
  house: string | null;
  uf: string | null;
  won_price: string | null;
  won_date: string | null;
  condition_media: string | null;
  condition_sleeve: string | null;
  notes: string | null;
  tags: string[] | null;
  market_low: string | null;
  market_high: string | null;
  source_url: string | null;
  position: number;
};

function toItem(r: DbRow): CollectionItem {
  return {
    id: r.id,
    lotId: r.lot_id,
    source: r.source ?? "manual",
    artist: r.artist ?? "",
    album: r.album ?? "",
    title: r.title ?? "",
    year: r.year,
    image: r.image,
    house: r.house ?? "",
    uf: r.uf ?? "",
    wonPrice: r.won_price ?? "",
    wonDate: r.won_date,
    conditionMedia: r.condition_media ?? "",
    conditionSleeve: r.condition_sleeve ?? "",
    notes: r.notes ?? "",
    tags: r.tags ?? [],
    marketLow: r.market_low,
    marketHigh: r.market_high,
    sourceUrl: r.source_url ?? "",
    position: r.position,
  };
}

/** Lê a coleção inteira, ordenada por artista e depois posição (single-user). */
export async function getAllCollection(): Promise<CollectionItem[]> {
  const rows: CollectionItem[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("collection_items")
      .select(COLS)
      .order("artist", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as DbRow[];
    for (const r of batch) rows.push(toItem(r));
    if (batch.length < PAGE) break;
  }
  return rows;
}

/**
 * dd/mm/yyyy (site) -> yyyy-mm-dd (coluna `date`), ou null quando não casa OU é uma data
 * inválida. A página de compras traz datas vazias como "00/00/0000" — que viravam
 * "0000-00-00" e faziam o Postgres recusar o insert inteiro ("date/time field value out of
 * range"). Aqui validamos o intervalo e conferimos que a data existe de fato (rejeita 31/02).
 */
function brDateToIso(value: string): string | null {
  const m = (value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!day || !month || !year || month > 12 || day > 31 || year < 1900) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) {
    return null;
  }
  return iso;
}

/** Tira pontuacao solta nas pontas (ex.: ": Fulano", "Fulano -"). */
function trimEdges(s: string): string {
  return s
    .replace(/^[\s:;,–—/|-]+/, "")
    .replace(/[\s:;,–—/|-]+$/, "")
    .trim();
}

/**
 * Extrai {artista, álbum} do título de compra das casas. Cobre os formatos vistos no `l=6`:
 * "LP: ARTISTA - ÁLBUM", "LP de Fulano - Álbum" e o rotulado "LP: Artista: X / Album: Y".
 * Remove o prefixo de formato ("LP"/"Disco"/"Compacto" + conector/`:`), os rótulos
 * "Artista:"/"Album:" e a pontuação nas pontas — sem isso o artista saía como ": Fulano" ou
 * ": Artista: Fulano".
 */
function parsePurchaseTitle(rawTitle: string): { artist: string; album: string } {
  let t = rawTitle
    .replace(
      /^\s*(lps?|discos?|vinil|vinis|compactos?|bolach[aã]o|long\s*play)\b\s*(de|do|da|dos|das)?\s*[:–—-]?\s*/i,
      "",
    )
    .trim();

  // Rotulado: "Artista: X / Album: Y" (ou "- Álbum:").
  const labeled = t.match(
    /artista\s*[:-]\s*(.+?)\s*(?:[/|]|\s[-–—]\s)\s*(?:[aá]lbum|album)\s*[:-]\s*(.+)$/i,
  );
  if (labeled) return { artist: trimEdges(labeled[1]!), album: trimEdges(labeled[2]!) };

  // Rótulo "Artista:" solto no começo.
  t = t.replace(/^\s*artista\s*[:-]\s*/i, "").trim();

  // "ARTISTA - ÁLBUM".
  const parts = t.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0]!.trim()) {
    return { artist: trimEdges(parts[0]!), album: trimEdges(parts.slice(1).join(" - ")) };
  }
  return { artist: trimEdges(t), album: "" };
}

/** Um vinil arrematado que a varredura NÃO inseriu porque parece duplicar um já existente
 * (mesmo artista+álbum). Volta para a UI confirmar "adicionar mesmo assim" ou "ignorar".
 * Campos em camelCase, prontos para reinserção via `addPendingWonLot`. */
export type PendingWonLot = {
  lotId: string;
  artist: string;
  album: string;
  title: string;
  year: number | null;
  image: string | null;
  house: string;
  uf: string;
  wonPrice: string;
  wonDate: string | null; // já em ISO (yyyy-mm-dd)
  marketLow: string | null;
  marketHigh: string | null;
  sourceUrl: string;
  existing: string; // rótulo do disco já na coleção que casou (p/ mostrar)
};

type EnrichMaps = {
  albumById: Map<string, string | null>;
  yearById: Map<string, number | null>;
  marketById: Map<string, LotMarketRow>;
};

/** Deriva os campos de um vinil arrematado (identificação IA > título "Artista - Álbum"). */
function deriveCandidate(w: WonLot, maps: EnrichMaps): Omit<PendingWonLot, "existing"> {
  // Prioridade: (1) identificação da IA; senão (2) o próprio título de compra.
  const identified = maps.albumById.get(w.id) ?? null;
  const idParsed = parseAiAlbum(identified);
  let artist: string;
  let album: string;
  if (identified && idParsed.artist) {
    artist = titleCase(idParsed.artist);
    album = idParsed.album ?? "";
  } else {
    const t = parsePurchaseTitle(w.title);
    artist = t.artist ? titleCase(t.artist) : extractArtist(w.title) || w.title;
    album = t.album;
  }

  const mktRow = maps.marketById.get(w.id);
  let marketLow: string | null = null;
  let marketHigh: string | null = null;
  let marketYear: number | null = null;
  if (mktRow) {
    const m = toLotMarket(mktRow);
    const low = m.priceLowBr ?? m.lowestPrice;
    const high = m.priceHighBr ?? m.suggestedPrice;
    marketLow = low != null ? fmtMoney(low, m.currency) : null;
    marketHigh = high != null ? fmtMoney(high, m.currency) : null;
    marketYear = m.year;
  }
  const titleYear = w.title.match(/\b(19|20)\d{2}\b/)?.[0];
  const year =
    idParsed.year ??
    (titleYear ? Number(titleYear) : null) ??
    maps.yearById.get(w.id) ??
    marketYear ??
    null;

  return {
    lotId: w.id,
    artist,
    album,
    title: w.title,
    year,
    image: w.image,
    house: w.house,
    uf: w.uf,
    wonPrice: w.wonPrice,
    wonDate: brDateToIso(w.wonDate),
    marketLow,
    marketHigh,
    sourceUrl: w.url,
  };
}

/** Candidato (camelCase) -> linha de insert (snake_case). */
function candidateToRow(
  c: Omit<PendingWonLot, "existing">,
  position: number,
): TablesInsert<"collection_items"> {
  return {
    lot_id: c.lotId,
    source: "auction",
    artist: c.artist,
    album: c.album,
    title: c.title,
    year: c.year,
    image: c.image,
    house: c.house,
    uf: c.uf,
    won_price: c.wonPrice,
    won_date: c.wonDate,
    market_low: c.marketLow,
    market_high: c.marketHigh,
    source_url: c.sourceUrl,
    position,
    tags: [],
  };
}

/** Chave de duplicidade: artista+álbum normalizado. Vazia quando não há álbum (aí nunca
 * tratamos como duplicado — não dá para afirmar que dois "LP de Fulano" sejam o mesmo). */
function albumKey(artist: string, album: string): string {
  return album.trim() ? normalizeForMatch(`${artist} ${album}`) : "";
}

/**
 * Varre "Minhas compras" (l=6), filtra vinil e ACRESCENTA à coleção os lotes ainda
 * ausentes (de-dup por `lot_id`) — nunca sobrescreve o que o usuário editou. Semeia
 * artista/álbum/ano e a faixa Discogs reaproveitando a identificação JÁ gravada
 * (lot_ai/lot_ident) e o mercado (lot_market); sem chamadas novas de IA/Discogs.
 *
 * **Duplicados por álbum** (mesmo artista+álbum de um disco já na coleção, mas outro lote)
 * NÃO entram sozinhos — voltam em `duplicates` para o usuário confirmar (pode ser uma 2ª
 * cópia proposital). `added` = inseridos automaticamente; `scanned` = vinis lidos.
 */
export async function importWonLots(): Promise<{
  added: number;
  scanned: number;
  duplicates: PendingWonLot[];
}> {
  const { listVinylPurchases } = await import("./leiloesbr-purchases.server");
  const won = await listVinylPurchases();
  if (!won.length) return { added: 0, scanned: 0, duplicates: [] };

  // Identificação/mercado já existentes (best-effort — pode não haver linha p/ o lote).
  const [aiRows, identRows, marketRows, existing] = await Promise.all([
    import("./lot-ai.server").then((m) => m.getAllLotAi()).catch(() => []),
    import("./lot-ident.server").then((m) => m.getAllLotIdent()).catch(() => []),
    import("./lot-market.server").then((m) => m.getAllLotMarket()).catch(() => []),
    getAllCollection(),
  ]);

  const albumById = new Map<string, string | null>();
  for (const r of identRows) albumById.set(r.id, r.album);
  for (const r of aiRows) if (r.album) albumById.set(r.id, r.album); // avaliação completa vence
  const yearById = new Map<string, number | null>();
  for (const r of identRows) if (r.year != null) yearById.set(r.id, r.year);
  const marketById = new Map(marketRows.map((r) => [r.id, r]));
  const maps: EnrichMaps = { albumById, yearById, marketById };

  const have = new Set(existing.filter((i) => i.lotId).map((i) => i.lotId as string));
  // Álbuns já na coleção (e os já vistos nesta varredura) → detecção de duplicado.
  const seenAlbum = new Map<string, string>();
  for (const i of existing) {
    const k = albumKey(i.artist, i.album);
    if (k && !seenAlbum.has(k)) seenAlbum.set(k, `${i.artist} — ${i.album}`);
  }
  let pos = existing.reduce((max, i) => Math.max(max, i.position), 0);

  const payload: TablesInsert<"collection_items">[] = [];
  const duplicates: PendingWonLot[] = [];
  for (const w of won) {
    if (have.has(w.id)) continue; // mesma peça já na coleção → re-scan não duplica
    have.add(w.id);

    const cand = deriveCandidate(w, maps);
    const k = albumKey(cand.artist, cand.album);
    const dupOf = k ? seenAlbum.get(k) : undefined;
    if (dupOf) {
      duplicates.push({ ...cand, existing: dupOf });
      continue;
    }
    if (k) seenAlbum.set(k, `${cand.artist} — ${cand.album}`);
    pos += 1;
    payload.push(candidateToRow(cand, pos));
  }

  if (payload.length) {
    const { error } = await supabaseAdmin.from("collection_items").insert(payload);
    if (error) {
      console.error("[collection] falha ao importar compras", error);
      throw new Error(`Não foi possível atualizar a coleção: ${error.message}`);
    }
  }
  return { added: payload.length, scanned: won.length, duplicates };
}

/** Insere um duplicado confirmado pelo usuário ("adicionar mesmo assim"). */
export async function addPendingWonLot(cand: PendingWonLot): Promise<CollectionItem> {
  const existing = await getAllCollection();
  const position = existing.reduce((max, i) => Math.max(max, i.position), 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("collection_items")
    .insert(candidateToRow(cand, position))
    .select(COLS)
    .single();
  if (error) {
    console.error("[collection] falha ao adicionar duplicado", error);
    throw new Error(`Não foi possível adicionar o disco: ${error.message}`);
  }
  return toItem(data as DbRow);
}

/** Campos editáveis de um disco (usado por add e update). */
export type CollectionInput = {
  artist?: string;
  album?: string;
  title?: string;
  year?: number | null;
  image?: string | null;
  house?: string;
  uf?: string;
  wonPrice?: string;
  wonDate?: string | null;
  conditionMedia?: string;
  conditionSleeve?: string;
  notes?: string;
  tags?: string[];
};

/** Adiciona um disco manualmente (no fim da lista). */
export async function addCollectionItem(input: CollectionInput): Promise<CollectionItem> {
  const artist = (input.artist ?? "").trim();
  const album = (input.album ?? "").trim();
  if (!artist && !album) throw new Error("Informe ao menos o artista ou o álbum.");
  const existing = await getAllCollection();
  const position = existing.reduce((max, i) => Math.max(max, i.position), 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("collection_items")
    .insert({
      lot_id: null,
      source: "manual",
      artist,
      album,
      title: (input.title ?? "").trim(),
      year: input.year ?? null,
      image: input.image ?? null,
      house: (input.house ?? "").trim(),
      uf: (input.uf ?? "").trim(),
      won_price: (input.wonPrice ?? "").trim(),
      won_date: input.wonDate ?? null,
      condition_media: (input.conditionMedia ?? "").trim(),
      condition_sleeve: (input.conditionSleeve ?? "").trim(),
      notes: (input.notes ?? "").trim(),
      tags: input.tags ?? [],
      position,
    })
    .select(COLS)
    .single();
  if (error) {
    console.error("[collection] falha ao adicionar", error);
    throw new Error(`Não foi possível adicionar o disco: ${error.message}`);
  }
  return toItem(data as DbRow);
}

/** Atualiza campos de um disco (patch parcial dos campos editáveis). */
export async function updateCollectionItem(
  input: CollectionInput & { id: string },
): Promise<CollectionItem> {
  const patch: TablesUpdate<"collection_items"> = {};
  if (typeof input.artist === "string") patch.artist = input.artist.trim();
  if (typeof input.album === "string") patch.album = input.album.trim();
  if (typeof input.title === "string") patch.title = input.title.trim();
  if (input.year !== undefined) patch.year = input.year;
  if (input.image !== undefined) patch.image = input.image;
  if (typeof input.house === "string") patch.house = input.house.trim();
  if (typeof input.uf === "string") patch.uf = input.uf.trim();
  if (typeof input.wonPrice === "string") patch.won_price = input.wonPrice.trim();
  if (input.wonDate !== undefined) patch.won_date = input.wonDate;
  if (typeof input.conditionMedia === "string") patch.condition_media = input.conditionMedia.trim();
  if (typeof input.conditionSleeve === "string")
    patch.condition_sleeve = input.conditionSleeve.trim();
  if (typeof input.notes === "string") patch.notes = input.notes.trim();
  if (Array.isArray(input.tags)) patch.tags = input.tags;

  const { data, error } = await supabaseAdmin
    .from("collection_items")
    .update(patch)
    .eq("id", input.id)
    .select(COLS)
    .single();
  if (error) {
    console.error("[collection] falha ao atualizar", error);
    throw new Error(`Não foi possível atualizar o disco: ${error.message}`);
  }
  return toItem(data as DbRow);
}

/** Remove um disco da coleção. */
export async function deleteCollectionItem(id: string): Promise<{ ok: true }> {
  const { error } = await supabaseAdmin.from("collection_items").delete().eq("id", id);
  if (error) {
    console.error("[collection] falha ao remover", error);
    throw new Error(`Não foi possível remover o disco: ${error.message}`);
  }
  return { ok: true };
}

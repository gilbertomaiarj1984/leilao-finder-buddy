import { fmtMoney, parseAiAlbum, toLotMarket } from "@/components/vinyl/ai-score-utils";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { extractArtist, titleCase } from "@/lib/vinyl-parse";

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

/** dd/mm/yyyy (site) -> yyyy-mm-dd (coluna `date`), ou null se não casar. */
function brDateToIso(value: string): string | null {
  const m = (value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Varre "Minhas compras" (l=6), filtra vinil e ACRESCENTA à coleção os lotes ainda
 * ausentes (de-dup por `lot_id`) — nunca sobrescreve o que o usuário editou. Semeia
 * artista/álbum/ano e a faixa Discogs reaproveitando a identificação JÁ gravada
 * (lot_ai/lot_ident) e o mercado (lot_market); sem chamadas novas de IA/Discogs.
 * Retorna quantos discos entraram.
 */
export async function importWonLots(): Promise<{ added: number; scanned: number }> {
  const { listVinylPurchases } = await import("./leiloesbr-purchases.server");
  const won = await listVinylPurchases();
  if (!won.length) return { added: 0, scanned: 0 };

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

  const have = new Set(existing.filter((i) => i.lotId).map((i) => i.lotId as string));
  let pos = existing.reduce((max, i) => Math.max(max, i.position), 0);

  const payload: TablesInsert<"collection_items">[] = [];
  for (const w of won) {
    if (have.has(w.id)) continue;
    have.add(w.id);

    const identified = albumById.get(w.id) ?? null;
    const parsed = parseAiAlbum(identified);
    const artist = parsed.artist ? titleCase(parsed.artist) : extractArtist(w.title);
    const album = parsed.album ?? "";
    const year = parsed.year ?? yearById.get(w.id) ?? null;

    // Faixa Discogs BR (texto) do snapshot atual, quando o lote já foi consultado.
    const mktRow = marketById.get(w.id);
    let marketLow: string | null = null;
    let marketHigh: string | null = null;
    if (mktRow) {
      const m = toLotMarket(mktRow);
      const low = m.priceLowBr ?? m.lowestPrice;
      const high = m.priceHighBr ?? m.suggestedPrice;
      marketLow = low != null ? fmtMoney(low, m.currency) : null;
      marketHigh = high != null ? fmtMoney(high, m.currency) : null;
    }

    pos += 1;
    payload.push({
      lot_id: w.id,
      source: "auction",
      artist,
      album,
      title: w.title,
      year: year ?? (mktRow ? toLotMarket(mktRow).year : null),
      image: w.image,
      house: w.house,
      uf: w.uf,
      won_price: w.wonPrice,
      won_date: brDateToIso(w.wonDate),
      market_low: marketLow,
      market_high: marketHigh,
      source_url: w.url,
      position: pos,
      tags: [],
    });
  }
  if (!payload.length) return { added: 0, scanned: won.length };

  const { error } = await supabaseAdmin.from("collection_items").insert(payload);
  if (error) {
    console.error("[collection] falha ao importar compras", error);
    throw new Error(`Não foi possível atualizar a coleção: ${error.message}`);
  }
  return { added: payload.length, scanned: won.length };
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

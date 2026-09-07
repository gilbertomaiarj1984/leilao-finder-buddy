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

/** Normaliza um rótulo de campo ("Álbum", "Artista(s)") p/ comparar (sem acento/`(s)`/plural). */
function normLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(s\)/g, "")
    .replace(/s$/, "")
    .trim();
}

/** Limpa o valor de um campo: tira crases/colchetes/aspas. */
function cleanValue(v: string): string {
  return v
    .replace(/[`[\]"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 1º item de um valor que pode ser lista ("A, B" -> "A"). */
function firstItem(v: string): string {
  return cleanValue(v)
    .split(/\s*[,;/]\s*/)[0]!
    .trim();
}

const isLabeledSeg = (seg: string) => /^[^:]{1,25}:\s/.test(seg);

type ParsedTitle = {
  artist: string;
  album: string;
  year: number | null;
  notes: string;
  tags: string[];
};

/**
 * Extrai artista/álbum/ano (+notas e estilo→tags) do título de compra das casas. Cobre:
 * - **rotulado por campos** `Álbum: X | Código: Y | Artista(s): [`Z`] | Ano: N | Estilo(s): [..]`
 *   (Abreu/Vinil 11) — o artista fica em `Artista(s):`, e o estado/observações após `//`;
 * - `LP: Artista: X / Album: Y`;
 * - `LP: ARTISTA - ÁLBUM` / `LP de Fulano - Álbum`;
 * - título simples (vira artista).
 * `titleCase` é aplicado depois, em `deriveCandidate`.
 */
function parsePurchaseTitle(rawTitle: string): ParsedTitle {
  // Notas = texto após o 1º "//" (estado da mídia/capa).
  const halves = rawTitle.split(/\s*\/\/\s*/);
  const notes = halves.slice(1).join(" · ").trim();
  // Tira o prefixo de formato ("LP:", "LP de", "Disco:").
  const head = halves[0]!
    .replace(
      /^\s*(lps?|discos?|vinil|vinis|compactos?|bolach[aã]o|long\s*play)\b\s*(de|do|da|dos|das)?\s*[:–—-]?\s*/i,
      "",
    )
    .trim();

  // Campos rotulados separados por " | " ou " / ".
  const segments = head.split(/\s*\|\s*|\s+\/\s+/);
  const fields = new Map<string, string>();
  for (const seg of segments) {
    const m = seg.match(/^\s*([^:]{1,20}):\s*(.+)$/);
    if (m) fields.set(normLabel(m[1]!), m[2]!.trim());
  }
  const artista = fields.get("artista") ?? "";
  let album = fields.get("album") ?? "";
  // Álbum sem rótulo no 1º segmento (ex.: "Divina Luz | Artista(s): ...").
  if (artista && !album && segments[0] && !isLabeledSeg(segments[0])) album = segments[0];

  if (artista || fields.get("album")) {
    const anoRaw = fields.get("ano");
    const estilo = fields.get("estilo");
    return {
      artist: artista ? firstItem(artista) : "",
      album: cleanValue(album),
      year: anoRaw ? Number((cleanValue(anoRaw).match(/\d{4}/) ?? [])[0]) || null : null,
      notes,
      tags: estilo
        ? cleanValue(estilo)
            .split(/\s*[,;/]\s*/)
            .filter(Boolean)
        : [],
    };
  }

  // Fallback: "ARTISTA - ÁLBUM" (tirando um rótulo "Artista:" solto no começo).
  const t = head.replace(/^\s*artista\s*[:-]\s*/i, "").trim();
  const parts = t.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0]!.trim()) {
    return {
      artist: trimEdges(parts[0]!),
      album: trimEdges(parts.slice(1).join(" - ")),
      year: null,
      notes,
      tags: [],
    };
  }
  return { artist: trimEdges(t), album: "", year: null, notes, tags: [] };
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
  notes: string;
  tags: string[];
  existing: string; // rótulo do disco já na coleção que casou (p/ mostrar)
};

type EnrichMaps = {
  albumById: Map<string, string | null>;
  yearById: Map<string, number | null>;
  marketById: Map<string, LotMarketRow>;
};

/** De onde veio o artista de um candidato (diagnóstico da varredura). */
export type ArtistSource = "stored" | "title" | "none";

/**
 * Deriva os campos de um vinil arrematado, na ordem de prioridade (tudo GRÁTIS):
 * (1) identificação JÁ gravada (`lot_ai`/`lot_ident`, casada por id); (2) título rotulado
 * ("Artista(s): …" / "ARTISTA - ÁLBUM"). Ano/notas/tags vêm do título quando presentes.
 * Devolve também de onde veio o artista, p/ o diagnóstico da varredura.
 */
function deriveCandidate(
  w: WonLot,
  maps: EnrichMaps,
): { cand: Omit<PendingWonLot, "existing">; source: ArtistSource } {
  const identified = maps.albumById.get(w.id) ?? null;
  const idParsed = parseAiAlbum(identified);
  const parsedTitle = parsePurchaseTitle(w.title);

  let artist: string;
  let album: string;
  let source: ArtistSource;
  if (identified && idParsed.artist) {
    artist = titleCase(idParsed.artist);
    album = idParsed.album ?? "";
    source = "stored";
  } else if (parsedTitle.artist) {
    artist = titleCase(parsedTitle.artist);
    album = parsedTitle.album;
    source = "title";
  } else {
    const heur = extractArtist(w.title);
    artist = heur; // "" quando não identifica → cai em "não classificados" (IA opcional depois)
    album = parsedTitle.album;
    source = heur ? "title" : "none";
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
  const year = idParsed.year ?? parsedTitle.year ?? maps.yearById.get(w.id) ?? marketYear ?? null;

  return {
    cand: {
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
      notes: parsedTitle.notes,
      tags: parsedTitle.tags,
    },
    source,
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
    notes: c.notes,
    tags: c.tags,
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
export type ScanSources = { stored: number; title: number; none: number };

export async function importWonLots(): Promise<{
  added: number;
  scanned: number;
  duplicates: PendingWonLot[];
  sources: ScanSources;
}> {
  const emptySources: ScanSources = { stored: 0, title: 0, none: 0 };
  const { listVinylPurchases } = await import("./leiloesbr-purchases.server");
  const won = await listVinylPurchases();
  if (!won.length) return { added: 0, scanned: 0, duplicates: [], sources: emptySources };

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
  const sources: ScanSources = { stored: 0, title: 0, none: 0 };
  for (const w of won) {
    if (have.has(w.id)) continue; // mesma peça já na coleção → re-scan não duplica
    have.add(w.id);

    const { cand, source } = deriveCandidate(w, maps);
    sources[source] += 1;
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
  return { added: payload.length, scanned: won.length, duplicates, sources };
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

/**
 * ALTERNATIVA por IA (opt-in): identifica pela CAPA os discos que ficaram SEM artista após o
 * rastreio do título (o título rotulado/heurístico é rastreado ANTES; a IA é o último recurso,
 * gasta créditos). Reaproveita `identLotsSync` — a MESMA identificação dos lotes de leilão.
 * Processa até `max` por chamada e devolve `{ identified, remaining }` p/ o cliente repetir em
 * laço. Só grava quando a IA retorna artista. Requer `ANTHROPIC_API_KEY`.
 */
export async function identifyMissing(
  max = 12,
): Promise<{ identified: number; remaining: number }> {
  const { aiConfigured, identLotsSync } = await import("./ai-eval.server");
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (ANTHROPIC_API_KEY ausente no servidor).");
  }
  const all = await getAllCollection();
  const missing = all.filter((i) => !i.artist.trim() && i.image && /^https?:\/\//i.test(i.image));
  if (!missing.length) return { identified: 0, remaining: 0 };

  const batch = missing.slice(0, max);
  const results = await identLotsSync(
    batch.map((i) => ({ id: i.id, title: i.title, price: "", house: i.house, image: i.image })),
  );

  let identified = 0;
  for (const r of results) {
    const parsed = parseAiAlbum(r.album);
    const artist = parsed.artist ? titleCase(parsed.artist) : "";
    if (!artist) continue;
    const item = batch.find((i) => i.id === r.id);
    const patch: TablesUpdate<"collection_items"> = { artist };
    if (item && !item.album && parsed.album) patch.album = parsed.album;
    if (r.year != null && item && item.year == null) patch.year = r.year;
    const { error } = await supabaseAdmin.from("collection_items").update(patch).eq("id", r.id);
    if (error) {
      console.error("[collection] falha ao gravar identificação da IA", error);
      continue;
    }
    identified += 1;
  }
  return { identified, remaining: Math.max(0, missing.length - batch.length) };
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

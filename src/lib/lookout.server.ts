import { db } from "@/lib/db-client.server";

/**
 * "Ficar de olho" (tabela `lookout_items`): discos que o usuário quer muito e quer reconhecer
 * quando reaparecerem em leilões futuros. Snapshot do lote de origem — sem FK para `lots`
 * (o `pruneOutOfWindow` apaga lotes antigos; o marcador sobrevive). Casamento em
 * `lookout-match.ts`; página `/olho`; aviso externo em `lookout-matches.server.ts`.
 *
 * Tipos definidos localmente (mesma forma de `LookoutItem` em `lookout-match`) para o módulo do
 * SERVIDOR não depender de um módulo client-safe — ver a lição no `docs/notas-desenvolvimento.md`.
 */
export type LookoutRow = {
  id: string;
  lotId: string;
  artist: string;
  album: string;
  year: number | null;
  title: string;
  house: string;
  image: string | null;
  url: string;
  dayKey: string;
  maxPrice: number | null;
  note: string;
  status: "active" | "acquired" | "dismissed";
};

type DbRow = {
  id: string;
  lot_id: string;
  artist: string | null;
  album: string | null;
  year: number | null;
  title: string | null;
  house: string | null;
  image: string | null;
  url: string | null;
  day_key: string | null;
  max_price: string | number | null;
  note: string | null;
  status: string | null;
};

const COLS =
  "id, lot_id, artist, album, year, title, house, image, url, day_key, max_price, note, status";

function toStatus(v: string | null): LookoutRow["status"] {
  return v === "acquired" || v === "dismissed" ? v : "active";
}

/** `numeric` do Postgres chega como string (postgres.js) — normaliza para number|null. */
function toPrice(v: string | number | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toRow(r: DbRow): LookoutRow {
  return {
    id: r.id,
    lotId: r.lot_id,
    artist: r.artist ?? "",
    album: r.album ?? "",
    year: r.year,
    title: r.title ?? "",
    house: r.house ?? "",
    image: r.image,
    url: r.url ?? "",
    dayKey: r.day_key ?? "",
    maxPrice: toPrice(r.max_price),
    note: r.note ?? "",
    status: toStatus(r.status),
  };
}

/** Todos os itens (single-user; poucas linhas), mais recentes primeiro. */
export async function getAllLookout(): Promise<LookoutRow[]> {
  const { data, error } = await db
    .from("lookout_items")
    .select(COLS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DbRow[]).map(toRow);
}

type AddLookoutInput = {
  lotId: string;
  artist: string;
  album: string;
  year: number | null;
  title: string;
  house: string;
  image: string | null;
  url: string;
  dayKey: string;
};

/**
 * Marca o lote como "de olho" (snapshot). Idempotente por `lot_id`: se já existe, só reativa
 * (um item `dismissed`/`acquired` volta a `active`) sem sobrescrever teto/nota do usuário.
 */
export async function addLookoutFromLot(input: AddLookoutInput): Promise<LookoutRow> {
  const existing = await db
    .from("lookout_items")
    .select(COLS)
    .eq("lot_id", input.lotId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const row = existing.data as DbRow;
    if (toStatus(row.status) === "active") return toRow(row);
    const { data, error } = await db
      .from("lookout_items")
      .update({ status: "active" })
      .eq("id", row.id)
      .select(COLS)
      .single();
    if (error) throw new Error(`Não foi possível reativar o item: ${error.message}`);
    return toRow(data as DbRow);
  }
  const { data, error } = await db
    .from("lookout_items")
    .insert({
      lot_id: input.lotId,
      artist: input.artist.trim(),
      album: input.album.trim(),
      year: input.year,
      title: input.title,
      house: input.house,
      image: input.image,
      url: input.url,
      day_key: input.dayKey,
      status: "active",
    })
    .select(COLS)
    .single();
  if (error) {
    console.error("[lookout] falha ao adicionar", error);
    throw new Error(`Não foi possível ficar de olho: ${error.message}`);
  }
  return toRow(data as DbRow);
}

type UpdateLookoutInput = {
  id: string;
  artist?: string;
  album?: string;
  year?: number | null;
  maxPrice?: number | null;
  note?: string;
  status?: LookoutRow["status"];
};

/** Atualiza identidade (artista/álbum/ano), teto, nota ou status de um item. */
export async function updateLookoutItem(input: UpdateLookoutInput): Promise<LookoutRow> {
  const patch: Record<string, unknown> = {};
  if (typeof input.artist === "string") patch["artist"] = input.artist.trim();
  if (typeof input.album === "string") patch["album"] = input.album.trim();
  if (input.year !== undefined) patch["year"] = input.year;
  if (input.maxPrice !== undefined) patch["max_price"] = input.maxPrice;
  if (typeof input.note === "string") patch["note"] = input.note.trim();
  if (input.status) patch["status"] = input.status;
  const { data, error } = await db
    .from("lookout_items")
    .update(patch)
    .eq("id", input.id)
    .select(COLS)
    .single();
  if (error) {
    console.error("[lookout] falha ao atualizar", error);
    throw new Error(`Não foi possível atualizar o item: ${error.message}`);
  }
  return toRow(data as DbRow);
}

/** Remove um item (desmarca o "ficar de olho"). */
export async function deleteLookoutItem(id: string): Promise<{ ok: true }> {
  const { error } = await db.from("lookout_items").delete().eq("id", id);
  if (error) {
    console.error("[lookout] falha ao remover", error);
    throw new Error(`Não foi possível remover o item: ${error.message}`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Estado auxiliar em `app_state` (um registro por chave, read-modify-write)
// ---------------------------------------------------------------------------

const LINKS_KEY = "lookout_links";
const SEEN_KEY = "lookout_seen";
const NOTIFIED_KEY = "lookout_notified";
/** Teto de entradas das listas de dedupe (as mais recentes ficam) — o registro não cresce sem fim. */
const MAX_IDS = 2000;

async function readValue(key: string): Promise<unknown> {
  const { data, error } = await db.from("app_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function writeValue(key: string, value: unknown): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    console.error(`[lookout] não foi possível gravar ${key}`, error);
    throw new Error(`Não foi possível gravar o estado do "de olho": ${error.message}`);
  }
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Vínculos por lote: itemId (confirmado) | false (descartado). Best-effort: {} em erro. */
export async function getLookoutLinks(): Promise<Record<string, string | false>> {
  try {
    const value = await readValue(LINKS_KEY);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string | false> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === false || typeof v === "string") out[k] = v;
    }
    return out;
  } catch (error) {
    console.error("[lookout] não foi possível ler os vínculos (usando vazio)", error);
    return {};
  }
}

/** Aplica UMA mudança: `null` apaga (volta ao automático); string confirma; false descarta. */
export async function setLookoutLink(lotId: string, value: string | false | null): Promise<void> {
  const links = await getLookoutLinks();
  if (value === null) delete links[lotId];
  else links[lotId] = value;
  await writeValue(LINKS_KEY, links);
}

/** Chaves (`lotId|itemId`) de matches que o usuário já viu na página `/olho`. */
export async function getLookoutSeen(): Promise<string[]> {
  try {
    return asStringList(await readValue(SEEN_KEY));
  } catch (error) {
    console.error("[lookout] não foi possível ler os matches vistos (usando vazio)", error);
    return [];
  }
}

/** Marca como vistos (acrescenta, sem duplicar). */
export async function markLookoutSeen(keys: string[]): Promise<void> {
  const next = [...new Set([...(await getLookoutSeen()), ...keys])].slice(-MAX_IDS);
  await writeValue(SEEN_KEY, next);
}

/** Chaves (`lotId|itemId`) já avisadas por push externo (dedupe do cron). */
export async function getLookoutNotified(): Promise<string[]> {
  return asStringList(await readValue(NOTIFIED_KEY));
}

/** Registra avisos enviados (acrescenta, sem duplicar). */
export async function addLookoutNotified(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const next = [...new Set([...(await getLookoutNotified()), ...keys])].slice(-MAX_IDS);
  await writeValue(NOTIFIED_KEY, next);
}

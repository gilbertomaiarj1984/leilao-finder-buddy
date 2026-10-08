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
/** Álbum juntado a um item (snapshot do lote de origem dele). Espelha `LookoutMerged`. */
export type LookoutMergedRow = {
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
  merged: LookoutMergedRow[];
  /** Palavras/frases extras do usuário para o casamento (ex.: "1971"). */
  terms: string[];
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
  merged: unknown;
  terms: unknown;
};

const COLS =
  "id, lot_id, artist, album, year, title, house, image, url, day_key, max_price, note, status, merged, terms";

/** Lista de frases limpa: strings não vazias, sem repetição, até 20. */
function cleanTerms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== "string") continue;
    const clean = t.trim().replace(/\s+/g, " ").slice(0, 80);
    if (clean && !out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out.slice(0, 20);
}

function toMerged(v: unknown): LookoutMergedRow[] {
  if (!Array.isArray(v)) return [];
  const out: LookoutMergedRow[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (typeof m["lotId"] !== "string" || !m["lotId"]) continue;
    const s = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
    const year = Number(m["year"]);
    out.push({
      lotId: m["lotId"],
      artist: s("artist"),
      album: s("album"),
      year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
      title: s("title"),
      house: s("house"),
      image: typeof m["image"] === "string" && m["image"] ? (m["image"] as string) : null,
      url: s("url"),
      dayKey: s("dayKey"),
    });
  }
  return out;
}

/** Chave de identidade "artista + álbum" (sem acento/pontuação/caixa) para impedir duplicatas. */
function lookoutArtistKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lookoutIdentityKey(artist: string, album: string): string {
  const a = lookoutArtistKey(artist);
  const b = lookoutArtistKey(album);
  return a && b ? `${a}|${b}` : "";
}

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
    merged: toMerged(r.merged),
    terms: cleanTerms(r.terms),
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
  // Sem repetição: o mesmo lote (de origem de um item ou de um álbum juntado) OU o mesmo
  // artista+álbum já cadastrado reaproveita o item existente (reativando-o, se preciso).
  const all = await getAllLookout();
  const key = lookoutIdentityKey(input.artist, input.album);
  const found =
    all.find((i) => i.lotId === input.lotId || i.merged.some((m) => m.lotId === input.lotId)) ??
    (key
      ? all.find(
          (i) =>
            lookoutIdentityKey(i.artist, i.album) === key ||
            i.merged.some((m) => lookoutIdentityKey(m.artist, m.album) === key),
        )
      : undefined);
  if (found) {
    if (found.status === "active") return found;
    const { data, error } = await db
      .from("lookout_items")
      .update({ status: "active" })
      .eq("id", found.id)
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

/**
 * Cria um item "de olho" SEM lote de origem (lista colada / digitada). `lot_id` sintético
 * (`manual-<uuid>`) — nunca casa com lote real. Sem repetição: mesmo artista+álbum já cadastrado
 * (inclusive juntado) reaproveita o item (reativando-o).
 */
export async function addLookoutManual(input: {
  artist: string;
  album: string;
  year: number | null;
}): Promise<{ item: LookoutRow; created: boolean }> {
  const all = await getAllLookout();
  const key = lookoutIdentityKey(input.artist, input.album);
  const found = key
    ? all.find(
        (i) =>
          lookoutIdentityKey(i.artist, i.album) === key ||
          i.merged.some((m) => lookoutIdentityKey(m.artist, m.album) === key),
      )
    : undefined;
  if (found) {
    if (found.status === "active") return { item: found, created: false };
    const { data, error } = await db
      .from("lookout_items")
      .update({ status: "active" })
      .eq("id", found.id)
      .select(COLS)
      .single();
    if (error) throw new Error(`Não foi possível reativar o item: ${error.message}`);
    return { item: toRow(data as DbRow), created: false };
  }
  const { data, error } = await db
    .from("lookout_items")
    .insert({
      lot_id: `manual-${crypto.randomUUID()}`,
      artist: input.artist.trim(),
      album: input.album.trim(),
      year: input.year,
      status: "active",
    })
    .select(COLS)
    .single();
  if (error) throw new Error(`Não foi possível ficar de olho: ${error.message}`);
  return { item: toRow(data as DbRow), created: true };
}

type UpdateLookoutInput = {
  id: string;
  artist?: string;
  album?: string;
  year?: number | null;
  maxPrice?: number | null;
  note?: string;
  status?: LookoutRow["status"];
  terms?: string[];
  image?: string | null;
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
  if (input.terms) patch["terms"] = cleanTerms(input.terms);
  if (input.image !== undefined) patch["image"] = input.image;
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

/** Snapshot de um item como álbum juntado (o principal vira "merged" do destino). */
function asMerged(r: LookoutRow): LookoutMergedRow {
  return {
    lotId: r.lotId,
    artist: r.artist,
    album: r.album,
    year: r.year,
    title: r.title,
    house: r.house,
    image: r.image,
    url: r.url,
    dayKey: r.dayKey,
  };
}

/**
 * Junta o item `sourceId` ao `targetId` (mesmo disco com outro nome/edição): o destino passa a
 * casar também com a identidade do álbum absorvido (e com os que ele já tinha juntado) e o
 * absorvido deixa de existir como item. Teto/nota do destino prevalecem (o do absorvido só
 * preenche se o destino estiver vazio).
 */
export async function mergeLookoutItems(targetId: string, sourceId: string): Promise<LookoutRow> {
  if (targetId === sourceId) throw new Error("Escolha dois discos diferentes para juntar");
  const all = await getAllLookout();
  const target = all.find((i) => i.id === targetId);
  const source = all.find((i) => i.id === sourceId);
  if (!target || !source) throw new Error("Disco não encontrado");
  const known = new Set([target.lotId, ...target.merged.map((m) => m.lotId)]);
  const merged = [...target.merged];
  for (const m of [asMerged(source), ...source.merged]) {
    if (known.has(m.lotId)) continue;
    known.add(m.lotId);
    merged.push(m);
  }
  const patch: Record<string, unknown> = {
    merged,
    terms: cleanTerms([...target.terms, ...source.terms]),
  };
  if (target.maxPrice == null && source.maxPrice != null) patch["max_price"] = source.maxPrice;
  if (!target.note && source.note) patch["note"] = source.note;
  const { data, error } = await db
    .from("lookout_items")
    .update(patch)
    .eq("id", target.id)
    .select(COLS)
    .single();
  if (error) {
    console.error("[lookout] falha ao juntar", error);
    throw new Error(`Não foi possível juntar os discos: ${error.message}`);
  }
  await deleteLookoutItem(source.id);
  return toRow(data as DbRow);
}

/** Insere um lote (snapshot) como álbum juntado a um item existente — resposta "inserir no existente". */
export async function attachLookoutLot(
  itemId: string,
  part: LookoutMergedRow,
): Promise<LookoutRow> {
  const all = await getAllLookout();
  const item = all.find((i) => i.id === itemId);
  if (!item) throw new Error("Disco não encontrado");
  const known = new Set([item.lotId, ...item.merged.map((m) => m.lotId)]);
  const patch: Record<string, unknown> = { status: "active" };
  if (!known.has(part.lotId)) patch["merged"] = [...item.merged, part];
  const { data, error } = await db
    .from("lookout_items")
    .update(patch)
    .eq("id", itemId)
    .select(COLS)
    .single();
  if (error) throw new Error(`Não foi possível inserir no disco existente: ${error.message}`);
  return toRow(data as DbRow);
}

/** Desfaz a junção de UM álbum: ele volta a ser um item próprio (ativo). */
export async function unmergeLookoutItem(itemId: string, lotId: string): Promise<void> {
  const all = await getAllLookout();
  const item = all.find((i) => i.id === itemId);
  const part = item?.merged.find((m) => m.lotId === lotId);
  if (!item || !part) return;
  const { error } = await db.from("lookout_items").insert({
    lot_id: part.lotId,
    artist: part.artist,
    album: part.album,
    year: part.year,
    title: part.title,
    house: part.house,
    image: part.image,
    url: part.url,
    day_key: part.dayKey,
    status: "active",
  });
  if (error) throw new Error(`Não foi possível separar o álbum: ${error.message}`);
  const { error: upError } = await db
    .from("lookout_items")
    .update({ merged: item.merged.filter((m) => m.lotId !== lotId) })
    .eq("id", item.id);
  if (upError) throw new Error(`Não foi possível separar o álbum: ${upError.message}`);
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
const ARTIST_GROUPS_KEY = "lookout_artist_groups";
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

/** Descarta/confirma VÁRIOS lotes de uma vez (uma só gravação) — "Descartar todas" das pendentes. */
export async function setLookoutLinks(lotIds: string[], value: string | false): Promise<void> {
  if (!lotIds.length) return;
  const links = await getLookoutLinks();
  for (const id of lotIds) links[id] = value;
  await writeValue(LINKS_KEY, links);
}

type ArtistGroups = Record<string, { to: string; label: string }>;

/** Artistas juntados na página (chave normalizada → nome que permanece). Best-effort: {}. */
export async function getLookoutArtistGroups(): Promise<ArtistGroups> {
  try {
    const value = await readValue(ARTIST_GROUPS_KEY);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: ArtistGroups = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const g = v as { to?: unknown; label?: unknown } | null;
      if (g && typeof g.to === "string" && g.to && typeof g.label === "string") {
        out[k] = { to: g.to, label: g.label };
      }
    }
    return out;
  } catch (error) {
    console.error("[lookout] não foi possível ler os artistas juntados (usando vazio)", error);
    return {};
  }
}

/** Junta o artista `from` ao `to` (o nome de `to` permanece); `to` null desfaz a junção de `from`. */
export async function setLookoutArtistGroup(from: string, to: string | null): Promise<void> {
  const key = lookoutArtistKey(from);
  if (!key) return;
  const groups = await getLookoutArtistGroups();
  if (to === null) delete groups[key];
  else {
    const target = to.trim();
    if (!target || lookoutArtistKey(target) === key) return;
    groups[key] = { to: target, label: from.trim() };
  }
  await writeValue(ARTIST_GROUPS_KEY, groups);
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

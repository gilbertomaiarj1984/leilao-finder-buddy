import { parseAiAlbum } from "@/components/vinyl/ai-score-utils";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  collectionPathFromUrl,
  getCollectionPublicUrl,
  removeCollectionFile,
  uploadCollectionFile,
} from "@/lib/collection-storage.server";
import {
  COMPILATION_LABEL,
  isCompilation,
  isDiscBundle,
  isVariousArtists,
  LOTE_LABEL,
  normalizeForMatch,
  titleCase,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";

import type { AiProvider } from "./ai-provider";

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
  description: string;
  tags: string[];
  marketLow: string | null;
  marketHigh: string | null;
  sourceUrl: string;
  position: number;
};

const COLS =
  "id, lot_id, source, artist, album, title, year, image, house, uf, won_price, won_date, condition_media, condition_sleeve, notes, description, tags, market_low, market_high, source_url, position";
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
  description: string | null;
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
    description: r.description ?? "",
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
 * Reduz o artista à sua CATEGORIA canônica quando cabe: conjuntos de discos → "Lote";
 * coletâneas (título de coletânea sem artista confiável, ou artista "Vários Artistas") →
 * "Coletâneas". Caso contrário devolve o artista como veio. Assim discos de vários artistas
 * caem todos no mesmo grupo em vez de espalharem por "não classificados".
 */
function canonicalArtist(artist: string, title: string): string {
  if (isDiscBundle(title)) return LOTE_LABEL;
  if (artist && isVariousArtists(artist)) return COMPILATION_LABEL;
  if (!artist.trim() && isCompilation(title)) return COMPILATION_LABEL;
  return artist;
}

/** Chave de duplicidade: artista+álbum normalizado. Vazia quando não há álbum (aí nunca
 * tratamos como duplicado — não dá para afirmar que dois "LP de Fulano" sejam o mesmo). */
function albumKey(artist: string, album: string): string {
  return album.trim() ? normalizeForMatch(`${artist} ${album}`) : "";
}

/** Resultado de uma passada de re-identificação (o cliente repete em laço pelo `nextOffset`). */
export type ReidentifyResult = {
  identified: number; // discos cujo artista/álbum a passada gravou
  processed: number; // discos examinados nesta passada
  nextOffset: number;
  total: number;
  done: boolean;
  // Provedor de IA que atendeu esta passada e se houve failover (troca por falta de créditos).
  served: AiProvider | null;
  switched: boolean;
  // Quantos discos a IA NÃO conseguiu processar (vazio/erro) e o motivo — a UI distingue
  // "a IA falhou" de "nada para atualizar".
  failed: number;
  error: string | null;
  // Motivo de cada provedor pulado/que falhou até o que atendeu (ver `runText`).
  attemptErrors: Partial<Record<AiProvider, string>>;
};

/** Um disco "ainda não identificado": sem artista, ou caído no balde de não classificados. */
function needsIdentification(item: CollectionItem): boolean {
  const a = item.artist.trim();
  return !a || a === UNCLASSIFIED_LABEL;
}

/**
 * Une as tags atuais com as sugeridas pela IA: ACRESCENTA as novas (dedupe sem caixa) e nunca
 * remove as que o usuário já tinha — a remoção é sempre manual (padrão das tags dos lotes).
 * Devolve `null` quando nada muda (para não gravar à toa).
 */
function mergeTags(existing: string[], incoming: string[] | null | undefined): string[] | null {
  if (!incoming || !incoming.length) return null;
  const out = [...existing];
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  for (const t of incoming) {
    const v = t.trim();
    if (v && !seen.has(v.toLowerCase())) {
      out.push(v);
      seen.add(v.toLowerCase());
    }
  }
  return out.length === existing.length ? null : out;
}

/**
 * Re-identifica a coleção **por TEXTO** com a IA (a capa engana o modelo — mistura artistas
 * parecidos), definindo artista/álbum/ano e agrupando coletâneas em "Coletâneas" e conjuntos
 * em "Lote". Só sobrescreve quando há um valor melhor (nunca apaga uma identificação existente
 * com um resultado vazio). Requer `ANTHROPIC_API_KEY`.
 *
 * O cursor `nextOffset` percorre a lista COMPLETA ordenada por `id` (ordem estável), e o cliente
 * repete em laço até `done`. Dois alcances:
 * - `onlyUnidentified` (padrão): gasta IA só nos discos que ainda precisam de identificação
 *   (sem artista / não classificados), pulando os já identificados sem custo. É o uso ROTINEIRO
 *   e barato — cada rodada da varredura de compras acrescenta poucos discos novos.
 * - `onlyUnidentified=false`: passa por TODOS os discos para RE-NORMALIZAR a base (corrige
 *   identificações antigas imprecisas — ex.: Alceu Valença/Alcione espalhados). Gasta IA em toda
 *   a coleção; use com parcimônia.
 *
 * Como o cursor anda sobre a lista completa e estável (não sobre o subconjunto filtrado), itens
 * que saem do filtro ao serem identificados não deslocam o cursor — nada é pulado entre rodadas.
 * Conjuntos/coletâneas continuam classificados pelo título SEM gastar IA.
 */
export async function reidentifyCollection(
  provider: AiProvider,
  offset = 0,
  max = 12,
  onlyUnidentified = true,
): Promise<ReidentifyResult> {
  const { aiConfigured, identCollectionSync } = await import("./ai-eval.server");
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const all = await getAllCollection();
  const work = all
    .filter((i) => i.title.trim() || i.artist.trim() || i.album.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
  const total = work.length;

  // Avança o cursor sobre a lista completa coletando até `max` discos que precisam de IA
  // (todos, quando `onlyUnidentified=false`), pulando os já identificados sem gastar nada.
  const batch: CollectionItem[] = [];
  let scan = Math.min(Math.max(offset, 0), total);
  while (scan < total && batch.length < max) {
    const item = work[scan]!;
    scan += 1;
    if (onlyUnidentified && !needsIdentification(item)) continue;
    batch.push(item);
  }
  if (!batch.length) {
    return {
      identified: 0,
      processed: 0,
      nextOffset: total,
      total,
      done: true,
      served: null,
      switched: false,
      failed: 0,
      error: null,
      attemptErrors: {},
    };
  }

  // Classificação GRÁTIS pelo título: conjuntos → "Lote". O resto (inclusive coletâneas, que
  // ainda podem ganhar álbum/ano da IA) vai à passada por texto.
  const patches = new Map<string, TablesUpdate<"collection_items">>();
  const aiNeeded: CollectionItem[] = [];
  for (const item of batch) {
    if (isDiscBundle(item.title)) {
      if (item.artist !== LOTE_LABEL) patches.set(item.id, { artist: LOTE_LABEL });
    } else {
      aiNeeded.push(item);
    }
  }

  // IA por TEXTO: identifica (artista/álbum/ano) e gera o descritivo do disco.
  const {
    rows: results,
    served,
    switched,
    failed,
    error: aiError,
    attemptErrors,
  } = await identCollectionSync(
    aiNeeded.map((i) => ({
      id: i.id,
      title: i.title.trim() || [i.artist, i.album].filter(Boolean).join(" - "),
      artist: i.artist,
      album: i.album,
      year: i.year,
    })),
    provider,
  );
  const resById = new Map(results.map((r) => [r.id, r]));

  for (const item of aiNeeded) {
    const r = resById.get(item.id);
    const parsed = r ? parseAiAlbum(r.album) : { artist: "", album: null, year: null };
    let artist = parsed.artist ? titleCase(parsed.artist) : "";
    const album = parsed.album ?? "";
    const year = r?.year ?? null;

    artist = canonicalArtist(artist, item.title);
    const patch: TablesUpdate<"collection_items"> = {};
    // Descritivo: só preenche quando está vazio (não sobrescreve edição do usuário).
    if (r?.description && !item.description.trim()) patch.description = r.description;
    // Tags: acrescenta as da IA sem remover as do usuário.
    const mergedTags = mergeTags(item.tags, r?.tags);
    if (mergedTags) patch.tags = mergedTags;
    if (artist) {
      if (artist !== item.artist) patch.artist = artist;
      if (album && album !== item.album) patch.album = album;
      if (year != null && year !== item.year) patch.year = year;
    }
    // IA não identificou artista e não é coletânea → preserva o artista atual (só grava a descrição).
    if (Object.keys(patch).length) patches.set(item.id, patch);
  }

  let identified = 0;
  for (const [id, patch] of patches) {
    const { error } = await supabaseAdmin.from("collection_items").update(patch).eq("id", id);
    if (error) {
      console.error("[collection] falha ao gravar re-identificação", error);
      continue;
    }
    identified += 1;
  }

  return {
    identified,
    processed: batch.length,
    nextOffset: scan,
    total,
    done: scan >= total,
    served,
    switched,
    failed,
    error: aiError,
    attemptErrors,
  };
}

/**
 * Reprocessa UM disco pela IA (por texto) sob demanda — o "reprocessar" do card. Diferente da
 * passada em massa (`reidentifyCollection`, que só preenche/melhora), este **SOBRESCREVE** o que a
 * IA identificar: artista/álbum/ano e o descritivo. Nunca apaga com resultado vazio (se a IA não
 * devolver um campo, o valor atual é mantido). Conjuntos → "Lote" pelo título sem gastar IA.
 * Requer `ANTHROPIC_API_KEY`. Retorna `{updated}` (false quando não havia nada a mudar).
 */
export async function reidentifyCollectionItem(
  id: string,
  provider: AiProvider,
): Promise<{
  updated: boolean;
  served: AiProvider | null;
  switched: boolean;
  // Motivo quando a IA NÃO retornou nada (vazio/erro) — a UI distingue de "nada a mudar".
  error: string | null;
  attemptErrors: Partial<Record<AiProvider, string>>;
}> {
  const { aiConfigured, identCollectionSync } = await import("./ai-eval.server");
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const item = (await getAllCollection()).find((i) => i.id === id);
  if (!item) throw new Error("Disco não encontrado na coleção.");

  // Conjuntos ("lote com N discos") → categoria "Lote" pelo título, sem gastar IA.
  if (isDiscBundle(item.title)) {
    if (item.artist === LOTE_LABEL)
      return { updated: false, served: null, switched: false, error: null, attemptErrors: {} };
    const { error } = await supabaseAdmin
      .from("collection_items")
      .update({ artist: LOTE_LABEL })
      .eq("id", id);
    if (error) throw new Error(`Não foi possível gravar: ${error.message}`);
    return { updated: true, served: null, switched: false, error: null, attemptErrors: {} };
  }

  const {
    rows: [r],
    served,
    switched,
    error: aiError,
    attemptErrors,
  } = await identCollectionSync(
    [
      {
        id: item.id,
        title: item.title.trim() || [item.artist, item.album].filter(Boolean).join(" - "),
        artist: item.artist,
        album: item.album,
        year: item.year,
      },
    ],
    provider,
  );
  const parsed = r ? parseAiAlbum(r.album) : { artist: "", album: null, year: null };
  const artist = canonicalArtist(parsed.artist ? titleCase(parsed.artist) : "", item.title);
  const album = parsed.album ?? "";
  const year = r?.year ?? null;

  // SOBRESCREVE cada campo que a IA devolveu; nunca zera com vazio.
  const patch: TablesUpdate<"collection_items"> = {};
  if (artist && artist !== item.artist) patch.artist = artist;
  if (album && album !== item.album) patch.album = album;
  if (year != null && year !== item.year) patch.year = year;
  if (r?.description && r.description !== item.description) patch.description = r.description;
  // Tags: acrescenta as da IA sem remover as do usuário (remoção é manual).
  const mergedTags = mergeTags(item.tags, r?.tags);
  if (mergedTags) patch.tags = mergedTags;

  if (!Object.keys(patch).length)
    return { updated: false, served, switched, error: aiError, attemptErrors };
  const { error } = await supabaseAdmin.from("collection_items").update(patch).eq("id", id);
  if (error) throw new Error(`Não foi possível gravar: ${error.message}`);
  return { updated: true, served, switched, error: null, attemptErrors };
}

/**
 * Identifica pela IA (por TEXTO, mesmo prompt/modelo de `reidentifyCollectionItem`) um disco
 * que AINDA NÃO existe na coleção — usado pelo diálogo "Enviar para a coleção" em `/compras`
 * para pré-preencher artista/álbum/ano/descritivo/tags a partir só do título da compra, antes
 * de o usuário confirmar o envio. Não persiste nada (o chamador decide o que gravar).
 */
export async function identifyDraftFromTitle(
  input: { title: string; artist?: string; album?: string; year?: number | null },
  provider: AiProvider,
): Promise<{
  artist: string;
  album: string;
  year: number | null;
  description: string;
  tags: string[];
  served: AiProvider | null;
  switched: boolean;
  error: string | null;
  attemptErrors: Partial<Record<AiProvider, string>>;
}> {
  const { aiConfigured, identCollectionSync } = await import("./ai-eval.server");
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const title = input.title.trim();
  const {
    rows: [r],
    served,
    switched,
    error,
    attemptErrors,
  } = await identCollectionSync(
    [
      {
        id: "draft",
        title: title || [input.artist, input.album].filter(Boolean).join(" - "),
        artist: input.artist,
        album: input.album,
        year: input.year ?? null,
      },
    ],
    provider,
  );
  const parsed = r ? parseAiAlbum(r.album) : { artist: "", album: null, year: null };
  const artist = canonicalArtist(
    parsed.artist ? titleCase(parsed.artist) : (input.artist ?? ""),
    title,
  );
  return {
    artist,
    album: parsed.album ?? input.album ?? "",
    year: r?.year ?? input.year ?? null,
    description: r?.description ?? "",
    tags: r?.tags ?? [],
    served,
    switched,
    error,
    attemptErrors,
  };
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
  description?: string;
  tags?: string[];
  // Presente só quando o disco vem de "Enviar para a coleção" (`/compras`) — vincula à peça
  // arrematada (`lot_id`), igual à antiga varredura direta.
  lotId?: string;
};

/**
 * Adiciona um disco à coleção — manualmente, ou a partir do botão "Enviar para a coleção" de
 * uma compra (`lotId` presente, `source: "auction"`). Recusa reenviar a mesma peça duas vezes.
 */
export async function addCollectionItem(input: CollectionInput): Promise<CollectionItem> {
  const artist = (input.artist ?? "").trim();
  const album = (input.album ?? "").trim();
  if (!artist && !album) throw new Error("Informe ao menos o artista ou o álbum.");
  const existing = await getAllCollection();
  if (input.lotId && existing.some((i) => i.lotId === input.lotId)) {
    throw new Error("Esta compra já está na coleção.");
  }
  const position = existing.reduce((max, i) => Math.max(max, i.position), 0) + 1;
  const { data, error } = await supabaseAdmin
    .from("collection_items")
    .insert({
      lot_id: input.lotId ?? null,
      source: input.lotId ? "auction" : "manual",
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
      description: (input.description ?? "").trim(),
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

/**
 * Importa vários discos de uma vez a partir do texto colado (JSON gerado por IA, ou o fallback
 * `Artista - Álbum (Ano)` por linha — ver `parseCollectionBulkText`). ACRESCENTA como `manual`,
 * **pulando** os que já existem na coleção por artista+álbum normalizado (`albumKey`) — mesmo
 * critério da varredura de compras. De-dup também dentro do próprio lote. Não usa IA/rede.
 * Retorna `{recognized, added, skipped}`.
 */
export async function importCollectionText(
  text: string,
): Promise<{ recognized: number; added: number; skipped: number }> {
  const { parseCollectionBulkText } = await import("./collection-bulk");
  const { items, error } = parseCollectionBulkText(text);
  if (error) throw new Error(error);
  if (!items.length) return { recognized: 0, added: 0, skipped: 0 };

  const existing = await getAllCollection();
  const seen = new Set<string>();
  for (const i of existing) {
    const k = albumKey(i.artist, i.album);
    if (k) seen.add(k);
  }
  let pos = existing.reduce((max, i) => Math.max(max, i.position), 0);

  const payload: TablesInsert<"collection_items">[] = [];
  let skipped = 0;
  for (const d of items) {
    const artist = canonicalArtist(d.artist ? titleCase(d.artist) : "", d.title);
    const album = d.album.trim();
    const k = albumKey(artist, album);
    if (k && seen.has(k)) {
      skipped += 1;
      continue;
    }
    if (k) seen.add(k);
    pos += 1;
    payload.push({
      lot_id: null,
      source: "manual",
      artist,
      album,
      title: d.title,
      year: d.year,
      image: null,
      house: d.house,
      uf: d.uf,
      won_price: d.wonPrice,
      won_date: d.wonDate,
      condition_media: d.conditionMedia,
      condition_sleeve: d.conditionSleeve,
      notes: d.notes,
      tags: d.tags,
      position: pos,
    });
  }

  if (payload.length) {
    const { error: insertError } = await supabaseAdmin.from("collection_items").insert(payload);
    if (insertError) {
      console.error("[collection] falha ao importar em massa", insertError);
      throw new Error(`Não foi possível importar os discos: ${insertError.message}`);
    }
  }
  return { recognized: items.length, added: payload.length, skipped };
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
  if (typeof input.description === "string") patch.description = input.description.trim();
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

/** Teto do upload (imagem já decodificada, antes de comprimir). Fotos de capa não passam disso. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Lado maior após redimensionar e qualidade do WEBP de saída — ver `compressCollectionImage`. */
const COMPRESS_MAX_DIMENSION = 1600;
const COMPRESS_WEBP_QUALITY = 82;

/**
 * Redimensiona (lado maior ≤ 1600px, sem ampliar) e recodifica em WEBP q82. Reduz bastante o
 * egress do Storage, que é cobrado por byte servido — usado tanto no upload novo quanto no
 * backfill (`scripts/compress-collection-images.ts`) das fotos já existentes.
 */
export async function compressCollectionImage(
  bytes: Buffer,
): Promise<{ bytes: Buffer; contentType: string; ext: string }> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(bytes)
    .rotate()
    .resize({
      width: COMPRESS_MAX_DIMENSION,
      height: COMPRESS_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: COMPRESS_WEBP_QUALITY })
    .toBuffer();
  return { bytes: out, contentType: "image/webp", ext: "webp" };
}

/**
 * Faz upload de uma foto (data URL base64) ao Storage e devolve a URL pública para gravar em
 * `image`. Passa pelo servidor com `service_role` (o bucket é público só para leitura). Valida
 * tipo (imagem) e tamanho, comprime (redimensiona + recodifica em WEBP) antes de armazenar.
 * Usado pela edição/inserção manual de um disco.
 */
export async function uploadCollectionImage(dataUrl: string): Promise<{ url: string }> {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl ?? "");
  if (!m) throw new Error("Imagem inválida (envie um arquivo de imagem).");
  const contentType = m[1]!.toLowerCase();
  const ext = IMAGE_EXT[contentType];
  if (!ext) throw new Error("Formato não suportado. Use JPG, PNG, WEBP, GIF ou AVIF.");
  const rawBytes = Buffer.from(m[2]!, "base64");
  if (!rawBytes.length) throw new Error("Imagem vazia.");
  if (rawBytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Imagem muito grande (máx. ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`);
  }
  const compressed = await compressCollectionImage(rawBytes);
  const filePath = `${crypto.randomUUID()}.${compressed.ext}`;
  try {
    const { publicUrl } = await uploadCollectionFile(filePath, compressed.bytes);
    return { url: publicUrl };
  } catch (error) {
    console.error("[collection] falha no upload da imagem", error);
    throw new Error(
      `Não foi possível enviar a imagem: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Backfill (v0.57.0): fotos da coleção enviadas antes da compressão automática existir, ainda
 * em resolução cheia no bucket. Compartilhado pelo cron (`step=compressimages`, chunked) e pelo
 * script standalone `scripts/compress-collection-images.ts` (roda tudo de uma vez, fora do
 * ambiente do servidor). Idempotente: a saída da compressão é sempre `.webp`, então só as que
 * ainda não são `.webp` entram na lista — rodar de novo nunca recomprime o que já foi convertido.
 */
export async function listUncompressedCollectionImages(
  limit: number,
): Promise<{ id: string; image: string }[]> {
  const prefix = getCollectionPublicUrl("");
  const { data, error } = await supabaseAdmin
    .from<{ id: string; image: string | null }>("collection_items")
    .select("id, image")
    .not("image", "is", null)
    .like("image", `${prefix}%`)
    .not("image", "ilike", "%.webp")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Falha ao listar fotos da coleção: ${error.message}`);
  return (data ?? []).filter((r): r is { id: string; image: string } => !!r.image);
}

/** Recomprime UMA foto já enviada: baixa, comprime, sobe em novo path, atualiza `image` e remove o blob antigo. */
export async function backfillCompressCollectionImage(row: {
  id: string;
  image: string;
}): Promise<{ originalBytes: number; compressedBytes: number }> {
  const oldPath = collectionPathFromUrl(row.image);

  const res = await fetch(row.image);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const rawBytes = Buffer.from(await res.arrayBuffer());

  const compressed = await compressCollectionImage(rawBytes);
  const newPath = `${crypto.randomUUID()}.${compressed.ext}`;
  const { publicUrl: newPublicUrl } = await uploadCollectionFile(newPath, compressed.bytes);

  const { error: dbErr } = await supabaseAdmin
    .from("collection_items")
    .update({ image: newPublicUrl })
    .eq("id", row.id);
  if (dbErr) throw new Error(`update DB: ${dbErr.message}`);

  if (oldPath) await removeCollectionFile(oldPath);

  return { originalBytes: rawBytes.length, compressedBytes: compressed.bytes.length };
}

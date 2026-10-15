import { db } from "@/lib/db-client.server";
import { normalizeTracklist, type Track } from "@/lib/tracklist";

/**
 * Avaliação da IA de UM lote, como fica no banco (`lot_ai`) e como a UI consome.
 * `id` casa com `lots.id` ("${idLeilao}-${idPeca}"). Os campos de julgamento podem ser
 * null quando a IA não avaliou / não soube dizer.
 */
export type LotAiRow = {
  id: string;
  title_hash: string;
  score: number | null;
  rarity: string | null;
  deal: string | null;
  album: string | null;
  reason: string | null;
  tags: string[];
  model: string | null;
  /** Preço (R$) usado na avaliação — ver `ai-reprice.ts`. null = avaliação antiga/sem preço. */
  eval_price: number | null;
  /** Tracklist do álbum com a fama de cada faixa (ver `tracklist.ts`); null = não informada. */
  tracklist: Track[] | null;
};

/**
 * Linha enviada ao NAVEGADOR: igual à do banco, mas SEM as faixas (jsonb pesado, ~1 KB por disco ×
 * centenas de lotes). `hasTracklist` só diz se existe; a lista vem sob demanda (`getLotTracklist`).
 */
type LotAiClient = Omit<LotAiRow, "tracklist"> & { hasTracklist: boolean };

/** `numeric` do Postgres chega como string (postgres.js) — normaliza para number|null. */
function toPrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Cache curto em memória: `getAllLotAiLean`/`getAllLotAiClient` são chamadas a cada iteração dos laços do cron
// (`aieval`/`market`) e a cada abertura de página que mostra a nota da IA — sempre a
// tabela INTEIRA. Invalidado a cada escrita (`upsertLotAi`/`updateLotTags`), então nunca
// devolve algo mais velho que a última gravação deste processo. Reduz consultas ao
// Postgres (ver docs/arquivo/economia-fase-1-egress-e-cpu.md).
const ALL_TTL_MS = 30_000;

// Variante SEM a tracklist (jsonb com todas as faixas de cada disco): o cron e as rotinas que só
// precisam de id/hash/nota/álbum não devem puxá-la a cada leitura. `tracklist` vem sempre `null`.
let leanCache: { at: number; rows: LotAiRow[] } | null = null;

let clientCache: { at: number; rows: LotAiClient[] } | null = null;

/** Descarta os caches de leitura (escritas feitas fora deste módulo, ex.: retroativo). */
export function invalidateLotAiCache(): void {
  leanCache = null;
  clientCache = null;
}

/** Tira as faixas de uma linha e a marca com `hasTracklist` (o que o navegador recebe). */
export function toClientRow(r: LotAiRow): LotAiClient {
  const { tracklist, ...rest } = r;
  return { ...rest, hasTracklist: Boolean(tracklist?.length) };
}

/**
 * Avaliações para o NAVEGADOR (`getLotAi`): sem a tracklist, só com o indicador `hasTracklist`
 * (calculado no Postgres, sem trafegar o jsonb). A lista de faixas vem por `getLotTracklist`.
 */
export async function getAllLotAiClient(): Promise<LotAiClient[]> {
  if (clientCache && Date.now() - clientCache.at < ALL_TTL_MS) return clientCache.rows;
  const { data, error } = await db
    .from<LotAiRow & { has_tracklist: boolean }>("lot_ai")
    .select(
      "id, title_hash, score, rarity, deal, album, reason, tags, model, eval_price, " +
        "(CASE WHEN jsonb_typeof(tracklist) = 'array' THEN jsonb_array_length(tracklist) > 0 ELSE false END) AS has_tracklist",
    );
  if (error) throw error;
  const rows: LotAiClient[] = (data ?? []).map((r) => ({
    id: r.id,
    title_hash: r.title_hash,
    score: r.score,
    rarity: r.rarity,
    deal: r.deal,
    album: r.album,
    reason: r.reason,
    tags: toTags(r.tags),
    model: r.model,
    eval_price: toPrice(r.eval_price),
    hasTracklist: r.has_tracklist === true,
  }));
  clientCache = { at: Date.now(), rows };
  return rows;
}

/** Tracklist (faixas + fama) de UM lote; `null` = sem avaliação ou sem faixas. */
export async function getLotTracklist(id: string): Promise<Track[] | null> {
  const { data, error } = await db
    .from<{ tracklist: unknown }>("lot_ai")
    .select("tracklist")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const list = normalizeTracklist(data?.tracklist);
  return list?.length ? list : null;
}

/**
 * Todas as avaliações sem a coluna `tracklist` (sempre `null` no resultado). Use quando só
 * importam id, hash, nota, álbum e preço de avaliação — seleção do `aieval`, resumo diário, De olho.
 */
export async function getAllLotAiLean(): Promise<LotAiRow[]> {
  if (leanCache && Date.now() - leanCache.at < ALL_TTL_MS) return leanCache.rows;
  const { data, error } = await db
    .from<LotAiRow>("lot_ai")
    .select("id, title_hash, score, rarity, deal, album, reason, tags, model, eval_price");
  if (error) throw error;
  const rows: LotAiRow[] = (data ?? []).map((r) => ({
    id: r.id,
    title_hash: r.title_hash,
    score: r.score,
    rarity: r.rarity,
    deal: r.deal,
    album: r.album,
    reason: r.reason,
    tags: toTags(r.tags),
    model: r.model,
    eval_price: toPrice(r.eval_price),
    tracklist: null,
  }));
  leanCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Atualiza SÓ as tags de um lote (edição manual pelo usuário na UI). Normaliza: apara,
 * remove vazias/duplicadas (case-insensitive) e limita a 20. Requer que o lote já tenha
 * uma linha em `lot_ai` (só há tags onde a IA avaliou). Devolve as tags gravadas.
 */
export async function updateLotTags(id: string, tags: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const t of tags) {
    const v = String(t ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    clean.push(v);
    if (clean.length >= 20) break;
  }
  const { data, error } = await db
    .from("lot_ai")
    .update({ tags: clean })
    .eq("id", id)
    .select("tags");
  if (error) {
    console.error("[lot-ai] falha ao atualizar tags", error);
    throw new Error(`Não foi possível salvar as tags: ${error.message}`);
  }
  // Sem linha afetada = lote ainda não avaliado pela IA (não há onde guardar as tags).
  if (!data || data.length === 0) {
    throw new Error("Este lote ainda não foi avaliado pela IA — não há como salvar tags nele.");
  }
  invalidateLotAiCache();
  // Devolve o que REALMENTE ficou gravado (jsonb), não o array computado.
  return toTags(data[0]?.tags);
}

/** Grava/atualiza avaliações (upsert por `id`, igual ao merge da tabela `lots`). */
export async function upsertLotAi(rows: LotAiRow[]): Promise<number> {
  if (!rows.length) return 0;
  const evaluatedAt = new Date().toISOString();
  const payload = rows.map((r) => ({
    id: r.id,
    title_hash: r.title_hash,
    score: r.score,
    rarity: r.rarity,
    deal: r.deal,
    album: r.album,
    reason: r.reason,
    tags: r.tags,
    model: r.model,
    eval_price: r.eval_price,
    // Reavaliar não apaga a tracklist (vem do Discogs, preenchida por step=tracklist).
    ...(r.tracklist ? { tracklist: r.tracklist } : {}),
    evaluated_at: evaluatedAt,
  }));
  const { error } = await db.from("lot_ai").upsert(payload, { onConflict: "id" });
  if (error) {
    // Ver lot-orphan-guard.server.ts: `lot_ai` tem FK ON DELETE CASCADE pra `lots(id)`; um lote
    // podado/excluído entre a seleção do batch e este upsert vira linha órfã que quebra o
    // upsert inteiro e derruba o resto do cron.
    if (error.code === "23503") {
      // Vigiado/lance fora da varredura geral (casa parceira, ou além da janela): cria a linha
      // em `lots` a partir da conta em vez de perder a nota (senão "volta ao estado anterior").
      const { resolveLotIdsWithAccount } = await import("./lot-orphan-guard.server");
      const validIds = await resolveLotIdsWithAccount(payload.map((r) => r.id));
      const filtered = payload.filter((r) => validIds.has(r.id));
      const dropped = payload.length - filtered.length;
      if (dropped > 0) {
        console.warn(
          `[lot-ai] ${dropped} avaliação(ões) órfã(s) ignorada(s) (lote não existe mais em lots)`,
        );
      }
      if (!filtered.length) return 0;
      const { error: retryError } = await db.from("lot_ai").upsert(filtered, { onConflict: "id" });
      if (retryError) {
        console.error("[lot-ai] falha ao gravar avaliações", retryError);
        throw new Error(`Não foi possível gravar as avaliações: ${retryError.message}`);
      }
      invalidateLotAiCache();
      return filtered.length;
    }
    console.error("[lot-ai] falha ao gravar avaliações", error);
    throw new Error(`Não foi possível gravar as avaliações: ${error.message}`);
  }
  invalidateLotAiCache();
  return payload.length;
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  reason: string | null;
  tags: string[];
  model: string | null;
};

const PAGE = 1000;

function toTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Lê todas as avaliações (single-user; poucas centenas de linhas). Best-effort. */
export async function getAllLotAi(): Promise<LotAiRow[]> {
  const rows: LotAiRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lot_ai")
      .select("id, title_hash, score, rarity, deal, reason, tags, model")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    for (const r of batch) {
      rows.push({
        id: r.id,
        title_hash: r.title_hash,
        score: r.score,
        rarity: r.rarity,
        deal: r.deal,
        reason: r.reason,
        tags: toTags(r.tags),
        model: r.model,
      });
    }
    if (batch.length < PAGE) break;
  }
  return rows;
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
    reason: r.reason,
    tags: r.tags,
    model: r.model,
    evaluated_at: evaluatedAt,
  }));
  const { error } = await supabaseAdmin.from("lot_ai").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("[lot-ai] falha ao gravar avaliações", error);
    throw new Error(`Não foi possível gravar as avaliações: ${error.message}`);
  }
  return payload.length;
}

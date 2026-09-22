// Exclusão manual e definitiva de lotes (`excluded_lots`) — ver
// docs/notas-desenvolvimento.md. DELETE físico em `lots` (cascade limpa
// lot_ai/lot_ident/lot_market/lot_condition) + registro que impede o cron de
// reinserir o mesmo id e alimenta a heurística de "possível lixo" na listagem.
import { extractKeywords } from "./lot-exclusion";

type ExcludedLotRow = { id: string; title: string; keywords: string[] };

/** Ids já excluídos, para o filtro do cron (`persistLots`). Best-effort: nunca lança. */
export async function getExcludedLotIds(): Promise<Set<string>> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("excluded_lots").select("id");
    if (error) throw error;
    return new Set((data ?? []).map((r) => (r as { id: string }).id));
  } catch (error) {
    console.error("[lot-exclusion] não foi possível ler excluded_lots", error);
    return new Set();
  }
}

/** Todos os lotes excluídos (título + keywords), para o cálculo de "possível lixo". */
export async function getAllExcludedLots(): Promise<ExcludedLotRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("excluded_lots").select("id, title, keywords");
  if (error) throw error;
  return (data ?? []) as ExcludedLotRow[];
}

/**
 * Exclui um lote: busca o snapshot (title/house/artist), grava em `excluded_lots` com as
 * keywords extraídas, e apaga de `lots` (cascade cuida de lot_ai/lot_ident/lot_market/
 * lot_condition). Idempotente — excluir de novo o mesmo id apenas confirma o registro.
 * `{ ok: false }` quando o lote já não existe (nada a fazer).
 */
export async function excludeLot(
  lotId: string,
  opts: { reason?: string; excludedBy?: string } = {},
): Promise<{ ok: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: lot, error: fetchError } = await supabaseAdmin
    .from("lots")
    .select("id, title, house, artist")
    .eq("id", lotId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!lot) return { ok: false };

  const l = lot as { id: string; title: string; house: string; artist: string };
  const keywords = extractKeywords(l.title, l.artist);

  const { error: insertError } = await supabaseAdmin.from("excluded_lots").upsert(
    [
      {
        id: l.id,
        title: l.title,
        house: l.house,
        artist: l.artist,
        reason: opts.reason ?? null,
        keywords,
        excluded_by: opts.excludedBy ?? "",
      },
    ],
    { onConflict: "id" },
  );
  if (insertError) throw insertError;

  const { error: deleteError } = await supabaseAdmin.from("lots").delete().eq("id", lotId);
  if (deleteError) throw deleteError;
  return { ok: true };
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Identificação SIMPLIFICADA da IA de UM lote, como fica no banco (`lot_ident`) e como a
 * UI/Discogs consomem. Camada barata e independente da avaliação completa (`lot_ai`):
 * roda para TODOS os lotes, só para descobrir artista/álbum/ano. `id` casa com `lots.id`.
 */
export type LotIdentRow = {
  id: string;
  title_hash: string;
  album: string | null;
  year: number | null;
  confidence: string | null; // 'alta' | 'media' | 'baixa'
  source: string | null; // 'title' | 'image'
  model: string | null;
};

const PAGE = 1000;

// Cache curto em memória: `getAllLotIdent` é chamada a cada iteração dos laços do cron
// (`aiident`/`market`) — sempre a tabela INTEIRA. Invalidado a cada escrita
// (`upsertLotIdent`). Reduz consultas ao Postgres (ver
// docs/economia-fase-1-egress-e-cpu.md).
let allCache: { at: number; rows: LotIdentRow[] } | null = null;
const ALL_TTL_MS = 30_000;

/** Lê todas as identificações (single-user; poucas centenas de linhas). Best-effort. */
export async function getAllLotIdent(): Promise<LotIdentRow[]> {
  if (allCache && Date.now() - allCache.at < ALL_TTL_MS) return allCache.rows;
  const rows: LotIdentRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from<LotIdentRow>("lot_ident")
      .select("id, title_hash, album, year, confidence, source, model")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    for (const r of batch) {
      rows.push({
        id: r.id,
        title_hash: r.title_hash,
        album: r.album,
        year: r.year,
        confidence: r.confidence,
        source: r.source,
        model: r.model,
      });
    }
    if (batch.length < PAGE) break;
  }
  allCache = { at: Date.now(), rows };
  return rows;
}

/** Grava/atualiza identificações (upsert por `id`, igual às demais tabelas por lote). */
export async function upsertLotIdent(rows: LotIdentRow[]): Promise<number> {
  if (!rows.length) return 0;
  const evaluatedAt = new Date().toISOString();
  const payload = rows.map((r) => ({
    id: r.id,
    title_hash: r.title_hash,
    album: r.album,
    year: r.year,
    confidence: r.confidence,
    source: r.source,
    model: r.model,
    evaluated_at: evaluatedAt,
  }));
  const { error } = await supabaseAdmin.from("lot_ident").upsert(payload, { onConflict: "id" });
  if (error) {
    // `lot_ident` tem FK ON DELETE CASCADE pra `lots(id)`, mas quem chama aqui (ex.
    // `reidentifyAllSales`) trabalha em cima de `lot_sales` — histórico que NUNCA é apagado,
    // então pode trazer um `lot_id` de um lote já podado (`step=prune`) ou excluído
    // manualmente. Sem esse filtro, a violação de FK sobe como exceção e derruba o resto do
    // cron (chunk/enrich/market/sales/purchases/prune que ainda não rodaram na mesma
    // execução) por causa de UMA linha órfã pontual.
    if (error.code === "23503") {
      const { data: existing, error: existError } = await supabaseAdmin
        .from("lots")
        .select("id")
        .in(
          "id",
          payload.map((r) => r.id),
        );
      if (existError) {
        console.error("[lot-ident] falha ao gravar identificações", error);
        throw new Error(`Não foi possível gravar as identificações: ${error.message}`);
      }
      const validIds = new Set((existing ?? []).map((r) => (r as { id: string }).id));
      const filtered = payload.filter((r) => validIds.has(r.id));
      const dropped = payload.length - filtered.length;
      if (dropped > 0) {
        console.warn(
          `[lot-ident] ${dropped} identificação(ões) órfã(s) ignorada(s) (lote não existe mais em lots)`,
        );
      }
      if (!filtered.length) return 0;
      const { error: retryError } = await supabaseAdmin
        .from("lot_ident")
        .upsert(filtered, { onConflict: "id" });
      if (retryError) {
        console.error("[lot-ident] falha ao gravar identificações", retryError);
        throw new Error(`Não foi possível gravar as identificações: ${retryError.message}`);
      }
      allCache = null;
      return filtered.length;
    }
    console.error("[lot-ident] falha ao gravar identificações", error);
    throw new Error(`Não foi possível gravar as identificações: ${error.message}`);
  }
  allCache = null;
  return payload.length;
}

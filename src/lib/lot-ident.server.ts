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
// (`upsertLotIdent`). Reduz egress do Supabase / Active CPU da Vercel (ver
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
    console.error("[lot-ident] falha ao gravar identificações", error);
    throw new Error(`Não foi possível gravar as identificações: ${error.message}`);
  }
  allCache = null;
  return payload.length;
}

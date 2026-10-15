/**
 * Leitura do contexto (estado + mercado Discogs + UF) dos lotes que vão para a avaliação da IA.
 * Best-effort: qualquer falha devolve um mapa vazio e a avaliação segue sem contexto, como antes.
 */
import { buildLotContext, type LotContext } from "./ai-context";

const CHUNK = 500;

export async function loadLotContexts(ids: string[]): Promise<Map<string, LotContext>> {
  const out = new Map<string, LotContext>();
  if (!ids.length) return out;
  try {
    const { db } = await import("@/lib/db-client.server");
    type Row = Record<string, unknown> & { id: string };
    const read = async (table: string, cols: string): Promise<Map<string, Row>> => {
      const map = new Map<string, Row>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await db
          .from(table)
          .select(cols)
          .in("id", ids.slice(i, i + CHUNK));
        if (error) throw error;
        for (const r of (data ?? []) as unknown as Row[]) map.set(r.id, r);
      }
      return map;
    };
    const [conds, markets, lots] = await Promise.all([
      read("lot_condition", "id, media, sleeve, insert_state, score"),
      read("lot_market", "id, matched, year, num_for_sale, have, want, suggested_by_condition"),
      read("lots", "id, uf"),
    ]);
    for (const id of ids) {
      out.set(
        id,
        buildLotContext({
          condition: (conds.get(id) as never) ?? null,
          market: (markets.get(id) as never) ?? null,
          uf: (lots.get(id)?.["uf"] as string | undefined) ?? null,
        }),
      );
    }
  } catch (error) {
    console.error("[ai-context] falha ao ler o contexto dos lotes; seguindo sem ele", error);
    out.clear();
  }
  return out;
}

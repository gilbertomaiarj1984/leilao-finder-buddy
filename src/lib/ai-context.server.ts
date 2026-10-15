/**
 * Leitura do contexto (estado + mercado Discogs + UF) dos lotes que vão para a avaliação da IA.
 * Best-effort: qualquer falha devolve um mapa vazio e a avaliação segue sem contexto, como antes.
 */
import { buildLotContext, type LotContext } from "./ai-context";
import { DEFAULT_PANEL_CONFIG, type PanelConfig } from "./ai-panel-config";

const CHUNK = 150;

export async function loadLotContexts(
  ids: string[],
): Promise<{ byId: Map<string, LotContext>; cfg: PanelConfig; ok: boolean }> {
  const out = new Map<string, LotContext>();
  let cfg: PanelConfig = DEFAULT_PANEL_CONFIG;
  if (!ids.length) return { byId: out, cfg, ok: true };
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
    const { getAiPanelConfig } = await import("./app-state.server");
    cfg = await getAiPanelConfig();
    const [conds, markets, lots] = await Promise.all([
      read("lot_condition", "id, media, sleeve, insert_state, score, description"),
      read(
        "lot_market",
        "id, matched, year, release_title, num_for_sale, have, want, suggested_by_condition",
      ),
      read("lots", "id, uf, title, artist"),
    ]);
    const scoreById = new Map<string, number | null>();
    for (const id of ids) {
      const sc = conds.get(id)?.["score"];
      scoreById.set(id, typeof sc === "number" ? sc : null);
    }
    // Vendas passadas (Analytics): best-effort e silencioso — sem elas o bloco só não aparece.
    const { loadPastSales } = await import("./past-sales.server");
    const pastSales = await loadPastSales(ids, scoreById);
    // Perfil do colecionador (interesses + De olho + Coleção): só o RESULTADO do casamento por lote.
    const { loadProfileContext } = await import("./collector-profile.server");
    const { profileForLot } = await import("./collector-profile");
    const profileCtx = await loadProfileContext();
    const albumById = new Map<string, string | null>();
    if (profileCtx) {
      const [{ getAllLotIdent }, { getAllLotAiLean }] = await Promise.all([
        import("./lot-ident.server"),
        import("./lot-ai.server"),
      ]);
      for (const r of await getAllLotIdent()) if (r.album) albumById.set(r.id, r.album);
      for (const r of await getAllLotAiLean()) if (r.album) albumById.set(r.id, r.album);
    }
    for (const id of ids) {
      const lot = lots.get(id);
      const market = markets.get(id);
      const profile =
        profileCtx && lot
          ? profileForLot(profileCtx, {
              id,
              title: String(lot["title"] ?? ""),
              artist: String(lot["artist"] ?? ""),
              album: albumById.get(id) ?? null,
              marketTitle: (market?.["release_title"] as string | null | undefined) ?? null,
              marketYear: (market?.["year"] as number | null | undefined) ?? null,
            })
          : null;
      out.set(
        id,
        buildLotContext(
          {
            condition: (conds.get(id) as never) ?? null,
            market: (markets.get(id) as never) ?? null,
            uf: (lots.get(id)?.["uf"] as string | undefined) ?? null,
            pastSales: pastSales.get(id) ?? null,
            profile,
          },
          cfg,
        ),
      );
    }
  } catch (error) {
    console.error("[ai-context] falha ao ler o contexto dos lotes; seguindo sem ele", error);
    out.clear();
    return { byId: out, cfg, ok: false };
  }
  return { byId: out, cfg, ok: true };
}

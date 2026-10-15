/**
 * Vendas passadas dos lotes (ver `past-sales.ts`): lê o histórico (`lot_sales`), os apelidos do
 * Analytics e a identificação dos lotes, e devolve o resumo por lote. O índice do histórico é
 * montado uma vez e fica 30s em memória (a mesma ordem de grandeza dos outros caches de leitura);
 * editar o Analytics o descarta na hora (`invalidatePastSalesIndex`).
 */
import { buildAnalytics, makeSalePlacer } from "./analytics";
import { buildPastSalesIndex, lookupPastSales, lotAsSale, type PastSales } from "./past-sales";

const TTL_MS = 30_000;
const CHUNK = 150;

type Loaded = {
  at: number;
  index: ReturnType<typeof buildPastSalesIndex>;
  place: ReturnType<typeof makeSalePlacer>;
};
let cache: Loaded | null = null;

/** Descarta o índice (apelidos/exclusões do Analytics mudaram). */
export function invalidatePastSalesIndex(): void {
  cache = null;
}

async function loadIndex(): Promise<Loaded> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const { getAllLotSales } = await import("./lot-sales.server");
  const { getAnalyticsAliases } = await import("./app-state.server");
  const [rows, aliases] = await Promise.all([
    getAllLotSales({ withOrig: false }),
    getAnalyticsAliases(),
  ]);
  cache = {
    at: Date.now(),
    index: buildPastSalesIndex(buildAnalytics(rows, aliases)),
    place: makeSalePlacer(aliases),
  };
  return cache;
}

/**
 * Resumo das vendas passadas por lote (só os que têm). `scoreById` = nota de estado do lote, para
 * a mediana das vendas de estado parecido. Falha de leitura devolve mapa vazio (best-effort).
 */
export async function loadPastSales(
  ids: string[],
  scoreById: ReadonlyMap<string, number | null> = new Map(),
): Promise<Map<string, PastSales>> {
  const out = new Map<string, PastSales>();
  if (!ids.length) return out;
  try {
    const { db } = await import("@/lib/db-client.server");
    const { getAllLotIdent } = await import("./lot-ident.server");
    const { getAllLotAiLean } = await import("./lot-ai.server");
    const [{ index, place }, identRows, aiRows] = await Promise.all([
      loadIndex(),
      getAllLotIdent(),
      getAllLotAiLean(),
    ]);
    const identById = new Map(identRows.map((r) => [r.id, r.album]));
    const aiById = new Map(aiRows.map((r) => [r.id, r.album]));
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await db
        .from<{ id: string; title: string; artist: string }>("lots")
        .select("id, title, artist")
        .in("id", ids.slice(i, i + CHUNK));
      if (error) throw error;
      for (const lot of data ?? []) {
        const sale = lotAsSale(lot, identById.get(lot.id) || aiById.get(lot.id) || null);
        const found = lookupPastSales(index, place(sale), scoreById.get(lot.id) ?? null);
        if (found) out.set(lot.id, found);
      }
    }
  } catch (error) {
    console.error("[past-sales] falha ao ler as vendas passadas; seguindo sem elas", error);
    out.clear();
  }
  return out;
}

import { db } from "@/lib/db-client.server";
import { getAiPanelConfig } from "@/lib/app-state.server";
import { capAlertText, decideCapAlerts, type CapItem, type CapState } from "@/lib/bid-cap-alerts";
import type { WatchedLot } from "@/lib/leiloesbr-watch.server";
import { getAllLotCondition } from "@/lib/lot-condition.server";
import { getAllLotMarket } from "@/lib/lot-market.server";
import { lotEconomics, toLotMarket, withConditionAnchor } from "@/lib/lot-score";
import { sendPushToAll } from "@/lib/push.server";
import { brDateToDayKey, parsePrice, upcomingDayKeys } from "@/lib/vinyl-parse";

const STATE_KEY = "bid_cap_state";

async function readState(): Promise<Record<string, CapState>> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();
  if (error) throw error;
  const v = data?.value;
  const out: Record<string, CapState> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [id, s] of Object.entries(v as Record<string, unknown>))
      if (s === "below" || s === "above") out[id] = s;
  return out;
}

async function writeState(state: Record<string, CapState>): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: STATE_KEY, value: state, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Aviso de teto de lance: para cada lote VIGIADO de hoje em diante, calcula o teto de "barato"
 * (`lotEconomics.capCheap`, mesma conta do app: preço sugerido do Discogs na condição do disco +
 * frete, painel de IA) e avisa quando o valor atual cruza esse teto (`decideCapAlerts`). O valor
 * vem da página de vigiados da conta (ao vivo), não da varredura geral (defasa até 6 h). Sem
 * mercado casado não há teto e não há aviso. O estado só é gravado depois do push (se falhar, o
 * cruzamento é avisado na próxima rodada).
 */
export async function notifyBidCaps(
  watched: readonly WatchedLot[],
): Promise<{ checked: number; alerts: number }> {
  const today = upcomingDayKeys(1)[0]!;
  const open = watched.filter((w) => {
    const day = brDateToDayKey(w.date);
    return Boolean(day) && day! >= today && parsePrice(w.price) !== null;
  });
  const prev = await readState();
  if (!open.length) {
    if (Object.keys(prev).length) await writeState({});
    return { checked: 0, alerts: 0 };
  }
  const ids = open.map((w) => w.id);
  const [markets, conds, panel] = await Promise.all([
    getAllLotMarket(ids),
    getAllLotCondition(),
    getAiPanelConfig(),
  ]);
  const marketById = new Map(markets.map((r) => [r.id, r]));
  const condById = new Map(conds.map((r) => [r.id, r]));
  const items: CapItem[] = open.map((w) => {
    const row = marketById.get(w.id);
    const cond = condById.get(w.id);
    const anchored = row
      ? withConditionAnchor(toLotMarket(row), cond?.media || cond?.sleeve || null, w.uf, panel)
      : undefined;
    return {
      id: w.id,
      title: w.title,
      house: w.house,
      price: parsePrice(w.price)!,
      capCheap: lotEconomics(w.price, anchored).capCheap,
    };
  });
  const { alerts, next } = decideCapAlerts(items, prev);
  if (alerts.length) {
    const r = await sendPushToAll({ ...capAlertText(alerts), url: "/", tag: "bid-cap" });
    if (r.sent === 0) throw new Error("nenhum aparelho recebeu o aviso de teto de lance");
  }
  if (JSON.stringify(next) !== JSON.stringify(prev)) await writeState(next);
  return { checked: items.filter((i) => i.capCheap !== null).length, alerts: alerts.length };
}

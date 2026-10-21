import { db } from "@/lib/db-client.server";
import { listWatchedFromSite } from "@/lib/leiloesbr-watch.server";
import { pushReady, sendPushToAll } from "@/lib/push.server";
import {
  confirmNotified,
  normalizeNotified,
  pickStartingAuctions,
  reserveNotified,
  startingAlertText,
  type NotifiedMap,
} from "@/lib/watch-alerts";

const NOTIFIED_KEY = "watch_start_notified";

async function readNotified(): Promise<NotifiedMap> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", NOTIFIED_KEY)
    .maybeSingle();
  if (error) throw error;
  return normalizeNotified(data?.value);
}

async function writeNotified(map: NotifiedMap): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: NOTIFIED_KEY, value: map, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Aviso "o pregão de um lote vigiado vai começar" (ver `watch-alerts.ts`). RESERVA o pregão em
 * `app_state.watch_start_notified` ANTES do push e confirma depois: uma execução cancelada no
 * meio do envio não reavisa; se o push falha (nenhum aparelho recebeu), a reserva é desfeita e o
 * pregão volta a ser candidato na rodada seguinte.
 */
async function notifyStarting(
  watched: Awaited<ReturnType<typeof listWatchedFromSite>>,
  now: number,
): Promise<number> {
  const before = await readNotified();
  const starting = pickStartingAuctions(watched, now, before);
  if (!starting.length) return 0;
  await writeNotified(reserveNotified(before, starting, now));
  try {
    const r = await sendPushToAll({ ...startingAlertText(starting), url: "/", tag: "watch-start" });
    if (r.sent === 0) throw new Error("nenhum aparelho recebeu o aviso de pregão começando");
  } catch (error) {
    await writeNotified(before).catch(() => undefined);
    throw error;
  }
  const reserved = reserveNotified(before, starting, now);
  await writeNotified(
    confirmNotified(
      reserved,
      starting.map((a) => a.key),
      Date.now(),
    ),
  );
  return starting.length;
}

/**
 * Step `watchalert` do cron (`watch-alert.yml`, a cada 15 min): lê os vigiados UMA vez e roda os
 * dois avisos, cada um isolado do outro (um erro num não impede o outro; os erros sobem juntos no
 * fim para a run aparecer como falha): pregão começando e lote vigiado cruzando o teto de lance.
 * No-op sem VAPID_* ou sem aparelho inscrito.
 */
export async function runWatchAlerts(now: number = Date.now()): Promise<{
  enabled: boolean;
  watched: number;
  notified: number;
  capChecked: number;
  capAlerts: number;
}> {
  if (!(await pushReady()))
    return { enabled: false, watched: 0, notified: 0, capChecked: 0, capAlerts: 0 };
  const watched = await listWatchedFromSite();
  const errors: string[] = [];
  let notified = 0;
  let capChecked = 0;
  let capAlerts = 0;
  try {
    notified = await notifyStarting(watched, now);
  } catch (error) {
    errors.push((error as Error).message);
  }
  try {
    const { notifyBidCaps } = await import("./bid-cap-alerts.server");
    ({ checked: capChecked, alerts: capAlerts } = await notifyBidCaps(watched));
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return { enabled: true, watched: watched.length, notified, capChecked, capAlerts };
}

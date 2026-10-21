import { db } from "@/lib/db-client.server";
import { listWatchedFromSite } from "@/lib/leiloesbr-watch.server";
import { pushReady, sendPushToAll } from "@/lib/push.server";
import { pickStartingAuctions, startingAlertText } from "@/lib/watch-alerts";

const NOTIFIED_KEY = "watch_start_notified";
const MAX_KEYS = 300;

async function readNotified(): Promise<string[]> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", NOTIFIED_KEY)
    .maybeSingle();
  if (error) throw error;
  const v = data?.value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function writeNotified(keys: string[]): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: NOTIFIED_KEY, value: keys.slice(-MAX_KEYS), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Step `watchalert` do cron (`watch-alert.yml`, a cada 15 min): avisa por Web Push quando o pregão de
 * um lote que você VIGIA começa em até 30 min (um aviso por pregão, com os lotes). Dedupe em
 * `app_state.watch_start_notified` (`idLeilao|dia`), gravado SÓ depois do envio — se o push falhar,
 * o pregão volta a ser candidato na rodada seguinte. No-op sem VAPID_* ou sem aparelho inscrito.
 */
export async function notifyWatchedStarting(now: number = Date.now()): Promise<{
  enabled: boolean;
  watched: number;
  notified: number;
}> {
  if (!(await pushReady())) return { enabled: false, watched: 0, notified: 0 };
  const watched = await listWatchedFromSite();
  const done = await readNotified();
  const starting = pickStartingAuctions(watched, now, new Set(done));
  if (!starting.length) return { enabled: true, watched: watched.length, notified: 0 };
  const r = await sendPushToAll({ ...startingAlertText(starting), url: "/", tag: "watch-start" });
  if (r.sent === 0) throw new Error("nenhum aparelho recebeu o aviso de pregão começando");
  await writeNotified([...done, ...starting.map((a) => a.key)]);
  return { enabled: true, watched: watched.length, notified: starting.length };
}

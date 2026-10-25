import { formatCoveredLot, formatCoveredWhere } from "@/lib/lot-score";
import { newlyCoveredBids } from "@/lib/bid-transitions";
import { db } from "@/lib/db-client.server";
import { listMyBidsFromSite } from "@/lib/leiloesbr-bids.server";
import { pushReady, sendPushToAll } from "@/lib/push.server";

const SNAPSHOT_KEY = "bid_status_snapshot";

async function readSnapshot(): Promise<Map<string, string> | null> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", SNAPSHOT_KEY)
    .maybeSingle();
  if (error) throw error;
  const v = data?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return new Map(
    Object.entries(v as Record<string, unknown>).filter(([, s]) => typeof s === "string") as [
      string,
      string,
    ][],
  );
}

async function writeSnapshot(map: Map<string, string>): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: SNAPSHOT_KEY, value: Object.fromEntries(map), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Step `bidnotify` do cron: lê "Meus lances" na conta e manda um Web Push quando algum lote
 * ACABOU de virar "Coberto" (lance superado) desde a rodada anterior. Snapshot do último status
 * por lote em `app_state.bid_status_snapshot`, gravado SÓ depois do envio (se o push falhar, o
 * lote volta a ser candidato). A 1ª rodada só semeia o snapshot — sem avisar de lances que já
 * estavam cobertos. No-op sem push configurado/aparelho inscrito.
 */
export async function notifyOutbidBids(): Promise<{
  enabled: boolean;
  bids: number;
  notified: number;
  seeded: boolean;
}> {
  if (!(await pushReady())) return { enabled: false, bids: 0, notified: 0, seeded: false };
  const bids = await listMyBidsFromSite();
  const prev = await readSnapshot();
  if (!prev) {
    await writeSnapshot(new Map(bids.map((b) => [b.id, b.status])));
    return { enabled: true, bids: bids.length, notified: 0, seeded: true };
  }
  // Snapshot novo = só os lances de agora (lotes que saíram da conta deixam de ocupar espaço).
  const { newlyCovered } = newlyCoveredBids(bids, prev);
  const next = new Map(bids.map((b) => [b.id, b.status]));
  if (newlyCovered.length) {
    const r = await sendPushToAll({
      title:
        newlyCovered.length === 1 ? "Lance superado" : `${newlyCovered.length} lances superados`,
      // Por lote: nº/artista/álbum + dia, casa e leilão (o toque no aviso abre o app).
      body: newlyCovered
        .map((b) => `${formatCoveredLot(b, null)}\n${formatCoveredWhere(b)}`.trim())
        .join("\n\n"),
      url: "/",
      tag: "bids-outbid",
    });
    if (r.sent === 0) throw new Error("nenhum aparelho recebeu o aviso de lance superado");
  }
  await writeSnapshot(next);
  return { enabled: true, bids: bids.length, notified: newlyCovered.length, seeded: false };
}

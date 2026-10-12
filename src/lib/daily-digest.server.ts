import { formatAiAlbum } from "@/components/vinyl/ai-score-utils";
import { db } from "@/lib/db-client.server";
import { buildDigestEmail, type DigestEntry } from "@/lib/email-templates.server";
import { emailEnabled, sendEmail } from "@/lib/email.server";
import { readLotsRange } from "@/lib/leiloesbr-scrape.server";
import { getAllLotAi } from "@/lib/lot-ai.server";
import { getAllLotMarket } from "@/lib/lot-market.server";
import { shiftDayKey } from "@/lib/day-bar";
import { parsePrice, upcomingDayKeys } from "@/lib/vinyl-parse";

/** Quantos lotes entram no resumo e quantos dias à frente (a janela do app) ele olha. */
const DIGEST_SIZE = 30;
const DIGEST_DAYS = 5;
const SENT_KEY = "daily_digest_sent";

async function lastSentDay(): Promise<string | null> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", SENT_KEY)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.value === "string" ? data.value : null;
}

async function markSent(dayKey: string): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: SENT_KEY, value: dayKey, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Resumo diário por e-mail dos melhores lotes dos próximos dias: ordena pela nota da IA e deixa
 * de fora os marcados como "caro". No máximo UM por dia (`app_state.daily_digest_sent`, gravado
 * só depois do envio — se o envio falhar, a próxima chamada do dia tenta de novo). Sem Gmail
 * configurado ou sem nenhum lote avaliado é no-op.
 */
export async function sendDailyDigest(): Promise<{
  enabled: boolean;
  sent: boolean;
  count: number;
  reason?: string;
}> {
  if (!emailEnabled()) return { enabled: false, sent: false, count: 0 };
  const today = upcomingDayKeys(1)[0]!;
  if ((await lastSentDay()) === today) {
    return { enabled: true, sent: false, count: 0, reason: "já enviado hoje" };
  }

  const [lots, aiRows, marketRows] = await Promise.all([
    readLotsRange(today, shiftDayKey(today, DIGEST_DAYS - 1)),
    getAllLotAi(),
    getAllLotMarket().catch(() => []),
  ]);
  const aiById = new Map(aiRows.map((r) => [r.id, r]));
  const marketById = new Map(marketRows.map((r) => [r.id, r]));

  const ranked = lots
    .flatMap((lot) => {
      const ai = aiById.get(lot.id);
      if (!ai || ai.score == null || ai.deal === "caro") return [];
      return [{ lot, ai, score: ai.score }];
    })
    .sort(
      (a, b) =>
        b.score - a.score || (a.lot.dayKey + a.lot.time).localeCompare(b.lot.dayKey + b.lot.time),
    )
    .slice(0, DIGEST_SIZE);
  if (!ranked.length)
    return { enabled: true, sent: false, count: 0, reason: "sem lotes avaliados" };

  const entries: DigestEntry[] = ranked.map(({ lot, ai, score }) => {
    const market = marketById.get(lot.id);
    return {
      title: formatAiAlbum(ai.album, market?.year ?? null) || lot.title,
      house: lot.house,
      dayKey: lot.dayKey,
      time: lot.time,
      url: lot.url,
      price: parsePrice(lot.price),
      marketLow: market?.price_low_br ?? null,
      marketHigh: market?.price_high_br ?? null,
      aiScore: score,
      rarity: ai.rarity,
      deal: ai.deal,
      watched: lot.watched,
    };
  });
  const [, m, d] = today.split("-");
  const base = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
  await sendEmail(buildDigestEmail(entries, `${d}/${m}`, base || undefined));
  await markSent(today);
  return { enabled: true, sent: true, count: entries.length };
}

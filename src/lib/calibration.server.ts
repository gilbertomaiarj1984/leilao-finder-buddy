/**
 * Calibração da IA com as compras recebidas (ver `calibration.ts`): grava o «retrato» do lote no
 * momento da compra, junta a opinião do usuário depois que o disco chegou e monta a tabela do
 * painel. Tudo best-effort: falha de leitura nunca derruba a sincronização das compras.
 */
import { db } from "@/lib/db-client.server";

import {
  normalizeSnapshot,
  VERDICTS,
  type CalibrationRow,
  type CalibrationSnapshot,
  type Verdict,
} from "./calibration";
import { effectiveTextRules } from "./condition-text";
import { normalizeGrade, parseConditionFromText, scoreCondition } from "./grading";
import { marketDeal, toLotMarket, withConditionAnchor } from "./lot-score";

const CHUNK = 150;

type CalDbRow = {
  lot_id: string;
  snapshot: unknown;
  snapshot_at: string | null;
  real_media: string;
  real_sleeve: string;
  real_score: number | null;
  verdict: string;
  note: string;
};

const CAL_COLS =
  "lot_id, snapshot, snapshot_at, real_media, real_sleeve, real_score, verdict, note";

async function readCalibrationRows(lotIds: string[]): Promise<Map<string, CalDbRow>> {
  const out = new Map<string, CalDbRow>();
  for (let i = 0; i < lotIds.length; i += CHUNK) {
    const { data, error } = await db
      .from<CalDbRow>("purchase_calibration")
      .select(CAL_COLS)
      .in("lot_id", lotIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const r of data ?? []) out.set(r.lot_id, r);
  }
  return out;
}

/**
 * Grava o retrato (IA, estado lido, mercado, vendas passadas) dos lotes que ainda não têm um.
 * Só cria quando o lote ainda existe em `lots` (ele sai da janela 10 dias depois do leilão).
 * Devolve quantos retratos foram gravados.
 */
export async function snapshotPurchases(lotIds: string[]): Promise<number> {
  if (!lotIds.length) return 0;
  const have = await readCalibrationRows(lotIds);
  const todo = lotIds.filter((id) => !normalizeSnapshot(have.get(id)?.snapshot));
  if (!todo.length) return 0;

  const [{ getAllLotAiLean }, { getAllLotMarket }, { getAiPanelConfig }, { loadPastSales }] =
    await Promise.all([
      import("./lot-ai.server"),
      import("./lot-market.server"),
      import("./app-state.server"),
      import("./past-sales.server"),
    ]);
  const [aiRows, cfg] = await Promise.all([getAllLotAiLean(), getAiPanelConfig()]);
  const aiById = new Map(aiRows.map((r) => [r.id, r]));

  type LotRow = { id: string; price: string; uf: string };
  const lots = new Map<string, LotRow>();
  const conds = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < todo.length; i += CHUNK) {
    const part = todo.slice(i, i + CHUNK);
    const { data: l, error: e1 } = await db
      .from<LotRow>("lots")
      .select("id, price, uf")
      .in("id", part);
    if (e1) throw e1;
    for (const r of l ?? []) lots.set(r.id, r);
    const { data: c, error: e2 } = await db
      .from<Record<string, unknown> & { id: string }>("lot_condition")
      .select("id, media, sleeve, insert_state, score, source")
      .in("id", part);
    if (e2) throw e2;
    for (const r of c ?? []) conds.set(r.id, r);
  }
  const present = todo.filter((id) => lots.has(id));
  if (!present.length) return 0;
  const markets = new Map((await getAllLotMarket(present)).map((m) => [m.id, m]));
  const scoreById = new Map(
    present.map((id) => [id, (conds.get(id)?.["score"] as number | null | undefined) ?? null]),
  );
  const past = await loadPastSales(present, scoreById);

  const payload: { lot_id: string; snapshot: CalibrationSnapshot; snapshot_at: string }[] = [];
  const now = new Date().toISOString();
  for (const id of present) {
    const lot = lots.get(id)!;
    const ai = aiById.get(id);
    const c = conds.get(id);
    const m = markets.get(id);
    const media = normalizeGrade(String(c?.["media"] ?? ""));
    const sleeve = normalizeGrade(String(c?.["sleeve"] ?? ""));
    // Mesma convenção do app: com só um lado conhecido, o outro repete.
    const grade = scoreCondition(media, sleeve).media;
    const lotMarket = m ? withConditionAnchor(toLotMarket(m), grade, lot.uf, cfg) : undefined;
    const ps = past.get(id);
    if (!ai && !c && !m) continue; // nada que valha guardar
    payload.push({
      lot_id: id,
      snapshot_at: now,
      snapshot: {
        takenAt: now,
        price: lot.price,
        ai: ai
          ? {
              score: ai.score,
              rarity: ai.rarity,
              deal: ai.deal,
              album: ai.album,
              reason: ai.reason,
              evalPrice: ai.eval_price,
            }
          : null,
        cond: c
          ? {
              media: String(c["media"] ?? ""),
              sleeve: String(c["sleeve"] ?? ""),
              insert: String(c["insert_state"] ?? ""),
              score: (c["score"] as number | null) ?? null,
              source: String(c["source"] ?? ""),
            }
          : null,
        market: lotMarket
          ? {
              verdict: marketDeal(lot.price, lotMarket),
              anchorCondition: lotMarket.anchor?.condition ?? null,
              anchorPrice: lotMarket.anchor?.price ?? null,
              freight: lotMarket.freight ?? null,
            }
          : null,
        pastSales: ps ? { count: ps.count, median: ps.median } : null,
      },
    });
  }
  if (!payload.length) return 0;
  const { error } = await db.from("purchase_calibration").upsert(payload, { onConflict: "lot_id" });
  if (error) throw error;
  return payload.length;
}

/** Compras de pregões marcados como «recebido», com retrato, opinião e leitura atual do estado. */
export async function getCalibrationRows(): Promise<CalibrationRow[]> {
  const { getAllPurchases } = await import("./purchases.server");
  const { data: auctions, error } = await db
    .from<{ id_leilao: string; received_at: string | null }>("purchase_auctions")
    .select("id_leilao, received_at")
    .eq("status", "recebido");
  if (error) throw error;
  const received = new Map((auctions ?? []).map((a) => [a.id_leilao, a.received_at]));
  const purchases = (await getAllPurchases()).filter((p) => received.has(p.idLeilao));
  if (!purchases.length) return [];
  const ids = purchases.map((p) => p.lotId);

  // Retratos que faltam (o lote pode ainda estar na janela): tenta agora, sem travar a tela.
  await snapshotPurchases(ids).catch((e) =>
    console.error("[calibration] não foi possível tirar os retratos pendentes", e),
  );
  const [cal, { getAllLotSales }, { getAllCollection }, { getAiPanelConfig }] = await Promise.all([
    readCalibrationRows(ids),
    import("./lot-sales.server"),
    import("./collection.server"),
    import("./app-state.server"),
  ]);
  const [sales, collection, panel] = await Promise.all([
    getAllLotSales({ ids, withOrig: true }),
    getAllCollection(),
    getAiPanelConfig(),
  ]);
  const rules = effectiveTextRules(panel.rules, panel.disabledRules);
  const saleById = new Map(sales.map((s) => [s.lot_id, s]));
  const collByLot = new Map<string, (typeof collection)[number]>();
  for (const it of collection) {
    if (it.lotId) collByLot.set(it.lotId, it);
    if (it.originLotId && !collByLot.has(it.originLotId)) collByLot.set(it.originLotId, it);
  }

  return purchases.map((p): CalibrationRow => {
    const c = cal.get(p.lotId);
    const sale = saleById.get(p.lotId);
    const item = collByLot.get(p.lotId);
    // Leitura ATUAL: o descritivo da venda (texto do catálogo) lido com as regras de hoje.
    const read = parseConditionFromText(sale?.orig_text || sale?.title || p.title, rules);
    const verdict = (VERDICTS as readonly string[]).includes(c?.verdict ?? "")
      ? (c!.verdict as Verdict)
      : "";
    return {
      lotId: p.lotId,
      idLeilao: p.idLeilao,
      title: p.title,
      label: item ? [item.artist, item.album].filter(Boolean).join(" — ") || p.title : p.title,
      image: p.image ?? item?.image ?? null,
      house: p.house,
      wonPrice: p.wonPrice,
      wonDate: p.wonDate,
      receivedAt: received.get(p.idLeilao) ?? null,
      snapshot: normalizeSnapshot(c?.snapshot),
      read: { media: read.media ?? "", sleeve: read.sleeve ?? "" },
      real: {
        media: c?.real_media || normalizeGrade(item?.conditionMedia) || "",
        sleeve: c?.real_sleeve || normalizeGrade(item?.conditionSleeve) || "",
      },
      realScore: c?.real_score ?? null,
      verdict,
      note: c?.note ?? "",
    };
  });
}

type CalibrationInput = {
  lotId: string;
  realMedia: string;
  realSleeve: string;
  realScore: number | null;
  verdict: string;
  note: string;
};

/** Grava a opinião do usuário sobre uma compra recebida (não mexe no retrato). */
export async function saveCalibration(input: CalibrationInput): Promise<void> {
  const score =
    input.realScore != null && Number.isFinite(input.realScore)
      ? Math.max(0, Math.min(100, Math.round(input.realScore)))
      : null;
  const { error } = await db.from("purchase_calibration").upsert(
    {
      lot_id: input.lotId,
      real_media: normalizeGrade(input.realMedia) ?? "",
      real_sleeve: normalizeGrade(input.realSleeve) ?? "",
      real_score: score,
      verdict: (VERDICTS as readonly string[]).includes(input.verdict) ? input.verdict : "",
      note: input.note.trim().slice(0, 500),
    },
    { onConflict: "lot_id" },
  );
  if (error) throw new Error(`Não foi possível salvar a calibração: ${error.message}`);
}

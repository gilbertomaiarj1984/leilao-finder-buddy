import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { parseConditionFromText, scoreCondition } from "./grading";
import type { VinylLot } from "./vinyl-parse";

/**
 * Cache de estado de conservação (Disco/Capa) por lote, para os cards PRÉ-leilão. É
 * alimentado pelo **catálogo da casa** (o descritivo completo vem no tooltip do card),
 * reaproveitando a varredura por leilão — sem abrir a `peca.asp` lote a lote. `id` casa com
 * `lots.id`; `title_hash` re-avalia quando o título do lote muda. Espelha o padrão de
 * `lot_ident`/`lot_market`.
 */
export type LotConditionRow = {
  id: string;
  title_hash: string;
  media: string; // grau do disco ou ''
  sleeve: string; // grau da capa ou ''
  insert_state: string; // 'sim' | 'nao' | ''
  score: number | null;
  faixa: string;
  source: string; // 'catalog' | 'title' | 'ia' | 'indefinido'
  views: number | null; // VISITAS — demanda (visualizações) do lote pré-leilão
  bids: number | null; // QTDLANCE — demanda (lances) do lote pré-leilão
};

const PAGE = 1000;
const COND_COLUMNS =
  "id, title_hash, media, sleeve, insert_state, score, faixa, source, views, bids";

/** Hash estável e curto do título (djb2 → base36), igual ao de `ai-eval.server` (título muda ⇒ re-avalia). */
function titleHash(title: string): string {
  let h = 5381;
  const s = title ?? "";
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Lê todo o cache de estado (single-user; paginado). Best-effort. */
export async function getAllLotCondition(): Promise<LotConditionRow[]> {
  const rows: LotConditionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lot_condition")
      .select(COND_COLUMNS)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data as LotConditionRow[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/** Grava/atualiza o estado por lote (upsert por `id`). */
export async function upsertLotCondition(rows: LotConditionRow[]): Promise<number> {
  if (!rows.length) return 0;
  const evaluatedAt = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, evaluated_at: evaluatedAt }));
  const { error } = await supabaseAdmin.from("lot_condition").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("[lot-condition] falha ao gravar estado", error);
    throw new Error(`Não foi possível gravar o estado: ${error.message}`);
  }
  return payload.length;
}

/** Monta a linha de estado de um lote a partir do lote do catálogo (com fallback ao título). */
function conditionRow(
  lot: VinylLot,
  catalog?: import("./leiloesbr-catalog.server").CatalogLot,
): LotConditionRow {
  const fromCatalog = parseConditionFromText(catalog?.text ?? "");
  const hasCatalog = Boolean(fromCatalog.media || fromCatalog.sleeve || fromCatalog.insert);
  const cond = hasCatalog ? fromCatalog : parseConditionFromText(lot.title);
  const source = hasCatalog
    ? "catalog"
    : cond.media || cond.sleeve || cond.insert
      ? "title"
      : "indefinido";
  return {
    id: lot.id,
    title_hash: titleHash(lot.title),
    media: cond.media ?? "",
    sleeve: cond.sleeve ?? "",
    insert_state: cond.insert ?? "",
    score: cond.score,
    faixa: cond.faixa?.label ?? "",
    source,
    views: catalog?.views ?? null,
    bids: catalog?.bids ?? null,
  };
}

// Teto de lotes por rodada que passam pelo fallback de IA (quando o regex fica indefinido
// mas há texto) — mantém a rodada rápida/barata mesmo com muitos lotes sem sigla no catálogo.
const AI_CONDITION_CAP = 25;

/**
 * Enriquece o estado (Disco/Capa) dos lotes da janela buscando o **catálogo** de cada leilão
 * (1 req/leilão) e parseando o descritivo do card. Seleciona os lotes SEM linha em
 * `lot_condition` (ou com título mudado), agrupa por leilão e processa até `maxAuctions` por
 * rodada; grava linha para TODOS os lotes processados (mesmo `indefinido`, para não reprocessar
 * à toa). Roda várias vezes até esgotar. Reaproveita o catálogo já usado pelo nº do lote.
 *
 * **Fallback de IA**: dos lotes que ficaram `indefinido` pelo regex mas TÊM texto descritivo,
 * até `AI_CONDITION_CAP` por rodada passam por `conditionAiSync` (só quando algum provedor
 * está configurado — best-effort, nunca falha a rodada). Um acerto da IA vira `source: 'ia'`.
 */
export async function enrichConditions(maxAuctions = 8): Promise<{
  updated: number;
  auctions: number;
  remaining: number;
  done: boolean;
  aiUsed?: number;
}> {
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");

  const [snapshot, existing] = await Promise.all([scrapeVinylLots(false), getAllLotCondition()]);
  const known = new Map(existing.map((r) => [r.id, r.title_hash]));

  // Lotes que ainda precisam de estado, agrupados por leilão (domínio + idLeilao).
  const byAuction = new Map<string, { domain: string; idLeilao: string; lots: VinylLot[] }>();
  for (const lot of snapshot.lots) {
    if (!lot.id || !lot.title) continue;
    if (known.get(lot.id) === titleHash(lot.title)) continue;
    const ref = parseAuctionRef(lot.url);
    if (!ref) continue;
    const key = `${ref.domain}|${ref.idLeilao}`;
    const entry = byAuction.get(key) ?? { domain: ref.domain, idLeilao: ref.idLeilao, lots: [] };
    entry.lots.push(lot);
    byAuction.set(key, entry);
  }

  const all = [...byAuction.values()].sort((a, b) => a.idLeilao.localeCompare(b.idLeilao));
  const total = all.length;
  const batch = all.slice(0, maxAuctions);

  const rows: LotConditionRow[] = [];
  // Texto usado no parse por lote (descritivo do catálogo, cai no título) — reaproveitado
  // pelo fallback de IA quando o regex não encontra nada nele.
  const textByLotId = new Map<string, string>();
  for (const auction of batch) {
    let catalog: Map<string, import("./leiloesbr-catalog.server").CatalogLot>;
    try {
      catalog = await fetchCatalogData(auction.domain, auction.idLeilao);
    } catch (error) {
      console.error(`[lot-condition] falha ao ler catálogo do leilão ${auction.idLeilao}`, error);
      continue; // sem gravar → tenta de novo numa próxima rodada
    }
    for (const lot of auction.lots) {
      const catalogLot = catalog.get(lot.idPeca);
      rows.push(conditionRow(lot, catalogLot));
      textByLotId.set(lot.id, catalogLot?.text || lot.title || "");
    }
  }

  // Fallback de IA: só os que ficaram INDEFINIDOS pelo regex mas têm texto pra IA ler.
  let aiUsed = 0;
  const { aiConfigured } = await import("./ai-eval.server");
  if (aiConfigured()) {
    const candidates = rows
      .filter((r) => r.source === "indefinido" && (textByLotId.get(r.id) ?? "").trim())
      .slice(0, AI_CONDITION_CAP)
      .map((r) => ({ id: r.id, text: textByLotId.get(r.id)! }));
    if (candidates.length) {
      const { conditionAiSync, resolveAiProvider } = await import("./ai-eval.server");
      const provider = await resolveAiProvider();
      const { rows: aiRows } = await conditionAiSync(candidates, provider);
      const byId = new Map(aiRows.map((r) => [r.id, r]));
      for (const row of rows) {
        const ai = byId.get(row.id);
        if (!ai) continue;
        const { media, sleeve, score, faixa } = scoreCondition(ai.media, ai.sleeve);
        if (media || sleeve) {
          row.media = media ?? "";
          row.sleeve = sleeve ?? "";
          row.score = score;
          row.faixa = faixa?.label ?? "";
          row.source = "ia";
          aiUsed += 1;
        }
        if (ai.insert !== null) row.insert_state = ai.insert;
      }
    }
  }

  const updated = await upsertLotCondition(rows);
  const remaining = Math.max(0, total - batch.length);
  return { updated, auctions: batch.length, remaining, done: remaining === 0, aiUsed };
}

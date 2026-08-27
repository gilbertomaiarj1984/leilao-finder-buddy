import { titleHash } from "./ai-eval.server";
import type { LotAiRow } from "./lot-ai.server";
import type { VinylLot } from "./vinyl-parse";

/** Linha da tabela `lot_market` (âncora de mercado do Discogs por lote). */
export type LotMarketRow = {
  id: string;
  basis: string;
  matched: boolean;
  release_id: number | null;
  release_title: string | null;
  year: number | null;
  num_for_sale: number | null;
  lowest_price: number | null;
  currency: string | null;
  suggested_price: number | null;
  suggested_condition: string | null;
  have: number | null;
  want: number | null;
  price_low_br: number | null;
  price_high_br: number | null;
  num_for_sale_br: number | null;
};

export type MarketTarget = { id: string; album: string | null; title: string; price: string };

const PAGE = 1000;

/** Base de invalidação do cache: hash do que será consultado (album identificado || título). */
export function marketBasis(album: string | null, title: string): string {
  return titleHash(`${(album ?? "").trim()}|${title ?? ""}`);
}

export async function getAllLotMarket(): Promise<LotMarketRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows: LotMarketRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lot_market")
      .select(
        "id, basis, matched, release_id, release_title, year, num_for_sale, lowest_price, currency, suggested_price, suggested_condition, have, want, price_low_br, price_high_br, num_for_sale_br",
      )
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    for (const r of batch) rows.push(r as LotMarketRow);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export async function upsertLotMarket(rows: LotMarketRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const checkedAt = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, checked_at: checkedAt }));
  const { error } = await supabaseAdmin.from("lot_market").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("[lot-market] falha ao gravar", error);
    throw new Error(`Não foi possível gravar o mercado: ${error.message}`);
  }
  return payload.length;
}

/**
 * Seleciona lotes para consultar no Discogs: precisam ter **avaliação de IA** (para ter o
 * `album` identificado) e ainda **não** ter uma linha de `lot_market` com o mesmo `basis`
 * (identificação inalterada). Teto por rodada.
 */
export function selectLotsForMarket(
  lots: Pick<VinylLot, "id" | "title" | "price">[],
  aiRows: Pick<LotAiRow, "id" | "album">[],
  marketRows: Pick<LotMarketRow, "id" | "basis">[],
  max: number,
): MarketTarget[] {
  const albumById = new Map(aiRows.map((r) => [r.id, r.album]));
  const basisById = new Map(marketRows.map((r) => [r.id, r.basis]));
  const out: MarketTarget[] = [];
  for (const lot of lots) {
    if (!albumById.has(lot.id)) continue; // só lotes já avaliados pela IA
    const album = albumById.get(lot.id) ?? null;
    const basis = marketBasis(album, lot.title);
    if (basisById.get(lot.id) === basis) continue; // já consultado com esta identificação
    out.push({ id: lot.id, album, title: lot.title, price: lot.price });
    if (out.length >= max) break;
  }
  return out;
}

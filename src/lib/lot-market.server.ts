import { titleHash } from "./ai-eval.server";
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

// Colunas da faixa BR (adicionadas depois). O schema NÃO é auto-aplicado neste projeto, então
// o banco pode ainda não tê-las → tratamos como opcionais para não derrubar o cron (500).
const BR_COLS = ["price_low_br", "price_high_br", "num_for_sale_br"] as const;
const BASE_COLS =
  "id, basis, matched, release_id, release_title, year, num_for_sale, lowest_price, currency, suggested_price, suggested_condition, have, want";

/** Erro do Postgres/PostgREST de coluna inexistente (antes de aplicar o `setup.sql`). */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = error.message ?? "";
  return BR_COLS.some((c) => msg.includes(c));
}

/** Base de invalidação do cache: hash do que será consultado (album identificado || título). */
export function marketBasis(album: string | null, title: string): string {
  return titleHash(`${(album ?? "").trim()}|${title ?? ""}`);
}

export async function getAllLotMarket(): Promise<LotMarketRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Tenta com as colunas BR; se o banco ainda não as tem, cai para as colunas base.
  let withBr = true;
  const rows: LotMarketRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const cols = withBr ? `${BASE_COLS}, ${BR_COLS.join(", ")}` : BASE_COLS;
    const { data, error } = await supabaseAdmin
      .from("lot_market")
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) {
      if (withBr && isMissingColumn(error)) {
        withBr = false;
        from -= PAGE; // repete esta página sem as colunas BR
        continue;
      }
      throw error;
    }
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of batch)
      rows.push({
        price_low_br: null,
        price_high_br: null,
        num_for_sale_br: null,
        ...r,
      } as unknown as LotMarketRow);
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
    // Banco ainda sem as colunas BR (setup.sql não aplicado): grava sem elas em vez de 500.
    if (isMissingColumn(error)) {
      const slim = payload.map(({ price_low_br, price_high_br, num_for_sale_br, ...base }) => base);
      const retry = await supabaseAdmin.from("lot_market").upsert(slim, { onConflict: "id" });
      if (retry.error) {
        console.error("[lot-market] falha ao gravar (sem BR)", retry.error);
        throw new Error(`Não foi possível gravar o mercado: ${retry.error.message}`);
      }
      return payload.length;
    }
    console.error("[lot-market] falha ao gravar", error);
    throw new Error(`Não foi possível gravar o mercado: ${error.message}`);
  }
  return payload.length;
}

/**
 * Seleciona lotes para consultar no Discogs: precisam ter um **álbum identificado**
 * (`albumRows` = merge de `lot_ai` + `lot_ident`, ver cron `step=market`) e ainda
 * **não** ter uma linha de `lot_market` com o mesmo `basis` (identificação inalterada).
 * Teto por rodada.
 */
export function selectLotsForMarket(
  lots: Pick<VinylLot, "id" | "title" | "price">[],
  albumRows: { id: string; album: string | null }[],
  marketRows: Pick<LotMarketRow, "id" | "basis">[],
  max: number,
): MarketTarget[] {
  const albumById = new Map(albumRows.map((r) => [r.id, r.album]));
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

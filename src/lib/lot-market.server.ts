import { titleHash } from "./ai-eval.server";
import type { VinylLot } from "./vinyl-parse";

/** Linha da tabela `lot_market` (âncora de mercado do Discogs por lote). */
type LotMarketRow = {
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

type MarketTarget = { id: string; album: string | null; title: string; price: string };

const MARKET_COLS =
  "id, basis, matched, release_id, release_title, year, num_for_sale, lowest_price, currency, suggested_price, suggested_condition, have, want, price_low_br, price_high_br, num_for_sale_br";

/** Base de invalidação do cache: hash do que será consultado (album identificado || título). */
export function marketBasis(album: string | null, title: string): string {
  return titleHash(`${(album ?? "").trim()}|${title ?? ""}`);
}

export async function getAllLotMarket(): Promise<LotMarketRow[]> {
  const { db } = await import("@/lib/db-client.server");
  // Postgres direto (postgres.js) não tem o teto de 1000 linhas do PostgREST: 1 consulta só.
  const { data, error } = await db.from("lot_market").select(MARKET_COLS);
  if (error) throw error;
  return (data ?? []) as unknown as LotMarketRow[];
}

export async function upsertLotMarket(rows: LotMarketRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { db } = await import("@/lib/db-client.server");
  const checkedAt = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, checked_at: checkedAt }));
  const { error } = await db.from("lot_market").upsert(payload, { onConflict: "id" });
  if (error) {
    // Ver lot-orphan-guard.server.ts: `lot_market` tem FK ON DELETE CASCADE pra `lots(id)`; um
    // lote podado/excluído entre a seleção do batch e este upsert vira linha órfã que quebra o
    // upsert inteiro e derruba o resto do cron.
    if (error.code === "23503") {
      const { filterExistingLotIds } = await import("./lot-orphan-guard.server");
      const validIds = await filterExistingLotIds(payload.map((r) => r.id));
      const filtered = payload.filter((r) => validIds.has(r.id));
      const dropped = payload.length - filtered.length;
      if (dropped > 0) {
        console.warn(
          `[lot-market] ${dropped} âncora(s) órfã(s) ignorada(s) (lote não existe mais em lots)`,
        );
      }
      if (!filtered.length) return 0;
      const retry = await db.from("lot_market").upsert(filtered, { onConflict: "id" });
      if (retry.error) {
        console.error("[lot-market] falha ao gravar", retry.error);
        throw new Error(`Não foi possível gravar o mercado: ${retry.error.message}`);
      }
      return filtered.length;
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

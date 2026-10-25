import { titleHash } from "./ai-eval.server";
import type { MatchInfo } from "./discogs-match";
import { normalizeSuggestionMap, type SuggestionMap } from "./discogs-price";
import { normalizeForMatch, type VinylLot } from "./vinyl-parse";

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
  /** Sugerido de todas as condições (BRL); null = ainda não coletado. */
  suggested_by_condition: SuggestionMap | null;
  have: number | null;
  want: number | null;
  price_low_br: number | null;
  price_high_br: number | null;
  num_for_sale_br: number | null;
  /** Evidência do casamento (só gravada; não vai ao navegador). */
  match_info?: MatchInfo | null;
};

type MarketTarget = { id: string; album: string | null; title: string; price: string };

const MARKET_COLS =
  "id, basis, matched, release_id, release_title, year, num_for_sale, lowest_price, currency, suggested_price, suggested_condition, suggested_by_condition, have, want, price_low_br, price_high_br, num_for_sale_br";

/**
 * Base de invalidação do cache: o que de fato é consultado no Discogs (o álbum identificado e, sem
 * ele, o título), normalizado — sem acento, pontuação, parênteses nem ano. A identificação por título
 * (`lot_ident`) e a avaliação (`lot_ai`) escrevem o MESMO álbum de jeitos ligeiramente diferentes
 * ("Fulano - Álbum (1984)" × "Fulano – Álbum"); com o texto cru o `basis` mudava e o disco era
 * consultado de novo (3 a 6 chamadas lentas ao Discogs) à toa. Prefixo `m2:` para distinguir do
 * formato antigo.
 */
export function marketBasis(album: string | null, title: string): string {
  const raw = (album ?? "").trim() || (title ?? "");
  const key = normalizeForMatch(raw.replace(/\([^)]*\)/g, " ").replace(/\b(?:19|20)\d{2}\b/g, " "));
  return `m2:${titleHash(key)}`;
}

/** Formato antigo do `basis` (texto cru do álbum + título): linhas já gravadas continuam válidas. */
function legacyMarketBasis(album: string | null, title: string): string {
  return titleHash(`${(album ?? "").trim()}|${title ?? ""}`);
}

export async function getAllLotMarket(ids?: string[]): Promise<LotMarketRow[]> {
  if (ids && !ids.length) return [];
  const { db } = await import("@/lib/db-client.server");
  // Postgres direto (postgres.js) não tem o teto de 1000 linhas do PostgREST: 1 consulta só.
  // `ids`: só esses lotes (rotinas do cron que já sabem quais precisam, em vez da tabela inteira).
  let query = db.from("lot_market").select(MARKET_COLS);
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as LotMarketRow[]).map((r) => ({
    ...r,
    // `{}` (consultado, sem sugestões) precisa sobreviver: vira "não coletado" se virar null.
    suggested_by_condition:
      r.suggested_by_condition == null
        ? null
        : (normalizeSuggestionMap(r.suggested_by_condition) ?? {}),
  }));
}

/**
 * Linhas já casadas no Discogs que ainda não têm o mapa de sugestões por condição (coletadas
 * antes do v0.141.0). O cron refaz só a chamada de sugestões delas (1 requisição por release).
 */
export function selectMarketBackfill(
  rows: Pick<LotMarketRow, "id" | "matched" | "release_id" | "suggested_by_condition">[],
  max: number,
): { id: string; release_id: number }[] {
  const out: { id: string; release_id: number }[] = [];
  for (const r of rows) {
    if (!r.matched || !r.release_id || r.suggested_by_condition) continue;
    out.push({ id: r.id, release_id: r.release_id });
    if (out.length >= max) break;
  }
  return out;
}

/** Grava o mapa de sugestões de várias linhas (backfill) sem mexer no resto da linha. */
export async function updateSuggestionMaps(
  items: { id: string; map: SuggestionMap | null }[],
): Promise<number> {
  const { db } = await import("@/lib/db-client.server");
  let n = 0;
  for (const it of items) {
    // `{}` marca "consultado, sem sugestões" para não repetir o backfill a cada rodada.
    const { error } = await db
      .from("lot_market")
      .update({ suggested_by_condition: it.map ?? {} })
      .eq("id", it.id);
    if (error) console.error("[lot-market] backfill falhou", it.id, error.message);
    else n += 1;
  }
  return n;
}

async function upsertLotMarket(rows: LotMarketRow[]): Promise<number> {
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
      const { resolveLotIdsWithAccount } = await import("./lot-orphan-guard.server");
      const validIds = await resolveLotIdsWithAccount(payload.map((r) => r.id));
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
    const stored = basisById.get(lot.id);
    // Já consultado com esta identificação (formato novo ou o antigo, para não reconsultar a base toda).
    if (stored === basis || stored === legacyMarketBasis(album, lot.title)) continue;
    out.push({ id: lot.id, album, title: lot.title, price: lot.price });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Consulta o Discogs de UM lote e grava `lot_market` (âncora de preço/demanda). Ponto único do
 * `step=market` do cron e do "refazer" sob demanda — antes só o cron preenchia o mercado, então
 * um lote analisado/refeito na tela ficava sem os dados do Discogs até a próxima rodada. Lança
 * em falha transitória do Discogs (nada é gravado; o lote volta na próxima).
 */
export async function fetchAndStoreMarket(t: {
  id: string;
  album: string | null;
  title: string;
}): Promise<number> {
  const { fetchMarket } = await import("./discogs.server");
  const basis = marketBasis(t.album, t.title);
  const m = await fetchMarket(t.album, t.title);
  return await upsertLotMarket([
    {
      id: t.id,
      basis,
      matched: m.matched,
      release_id: m.releaseId,
      release_title: m.releaseTitle,
      year: m.year,
      num_for_sale: m.numForSale,
      lowest_price: m.lowestPrice,
      currency: m.currency,
      suggested_price: m.suggestedPrice,
      suggested_condition: m.suggestedCondition,
      suggested_by_condition: m.suggestedByCondition,
      have: m.have,
      want: m.want,
      price_low_br: m.priceLowBr,
      price_high_br: m.priceHighBr,
      num_for_sale_br: m.numForSaleBr,
      match_info: m.matchInfo,
    },
  ]);
}

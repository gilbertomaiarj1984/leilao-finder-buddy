import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { parseConditionFromText } from "./grading";
import { auctionFinished, extractArtist, parsePrice } from "./vinyl-parse";

/**
 * Histórico de vendas (`lot_sales`) — a casa de leilão é irrelevante para o Vinil Analytics,
 * mas guardamos casa/UF para referência. Cada linha é UMA venda de UM lote, capturada do
 * **catálogo da casa** DEPOIS do leilão (`catalogo.asp` traz o valor de venda por lote), sem
 * ir à `peca.asp` lote a lote. O estado (Disco/Capa) é o melhor que o texto do card permite
 * (título/descrição curta); quando não há sigla, fica indefinido. A **data da venda é a data
 * do LEILÃO** (âncora temporal do histórico), não a data da captura.
 */
export type LotSaleRow = {
  lot_id: string; // "${idLeilao}-${idPeca}"
  id_leilao: string;
  id_peca: string;
  artist: string;
  title: string;
  sold_price: number | null;
  sold_price_raw: string;
  sold_date: string | null; // data do leilão (yyyy-mm-dd)
  house: string;
  uf: string;
  media: string; // grau do disco (grading) ou ""
  sleeve: string; // grau da capa ou ""
  score: number | null; // Score Final (0–100)
  faixa: string; // rótulo da faixa ou ""
  insert_state: string; // "sim" | "nao" | ""
  source_url: string;
};

const PAGE = 1000;
const SALE_COLUMNS =
  "lot_id, id_leilao, id_peca, artist, title, sold_price, sold_price_raw, sold_date, house, uf, media, sleeve, score, faixa, insert_state, source_url";

/** Lê todo o histórico de vendas (single-user; paginado). Best-effort. */
export async function getAllLotSales(): Promise<LotSaleRow[]> {
  const rows: LotSaleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lot_sales")
      .select(SALE_COLUMNS)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data as LotSaleRow[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/** Grava/atualiza vendas (upsert por `lot_id`). Só chamamos com linhas já vendidas. */
export async function upsertLotSales(rows: LotSaleRow[]): Promise<number> {
  if (!rows.length) return 0;
  const capturedAt = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, captured_at: capturedAt }));
  const { error } = await supabaseAdmin.from("lot_sales").upsert(payload, { onConflict: "lot_id" });
  if (error) {
    console.error("[lot-sales] falha ao gravar vendas", error);
    throw new Error(`Não foi possível gravar as vendas: ${error.message}`);
  }
  return payload.length;
}

type SeenAuctionRow = {
  id_leilao: string;
  entry_url: string | null;
  day_key: string;
  start_time: string;
  house: string;
  uf: string | null;
};

/** Lê os leilões conhecidos (durável; nunca podado) com o que a captura precisa. */
async function readSeenAuctions(): Promise<SeenAuctionRow[]> {
  const out: SeenAuctionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("seen_auctions")
      .select("id_leilao, entry_url, day_key, start_time, house, uf")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data as SeenAuctionRow[] | null) ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Monta as linhas de venda de um leilão a partir do catálogo (só os lotes vendidos). */
function salesRowsFromCatalog(
  auction: { idLeilao: string; domain: string; dayKey: string; house: string; uf: string },
  catalog: Map<string, import("./leiloesbr-catalog.server").CatalogLot>,
): LotSaleRow[] {
  const rows: LotSaleRow[] = [];
  for (const [idPeca, data] of catalog) {
    if (!data.sold || !data.soldPrice) continue; // fail-closed: sem venda clara, não grava
    const title = data.text || "";
    const cond = parseConditionFromText(title);
    rows.push({
      lot_id: `${auction.idLeilao}-${idPeca}`,
      id_leilao: auction.idLeilao,
      id_peca: idPeca,
      artist: extractArtist(title),
      title,
      sold_price: parsePrice(data.soldPrice),
      sold_price_raw: data.soldPrice,
      sold_date: auction.dayKey || null,
      house: auction.house,
      uf: auction.uf,
      media: cond.media ?? "",
      sleeve: cond.sleeve ?? "",
      score: cond.score,
      faixa: cond.faixa?.label ?? "",
      insert_state: cond.insert ?? "",
      source_url: `${auction.domain}/peca.asp?ID=${idPeca}`,
    });
  }
  return rows;
}

/**
 * Varredura pós-leilão: para os leilões JÁ CONHECIDOS (`seen_auctions`) que terminaram e
 * ainda não foram capturados, busca o catálogo UMA vez por leilão e grava as vendas em
 * `lot_sales`. Processa até `maxAuctions` por rodada (cursor em `app_state.sales_captured`),
 * então roda várias vezes até zerar o backlog (backfill retroativo + fluxo contínuo).
 * Retorna quantas vendas gravou, quantos leilões processou e se ainda há pendentes.
 */
export async function captureFinishedSales(maxAuctions = 8): Promise<{
  sales: number;
  auctions: number;
  remaining: number;
  done: boolean;
}> {
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const { getSalesCaptured, markSalesCaptured } = await import("./app-state.server");

  const [seen, captured] = await Promise.all([readSeenAuctions(), getSalesCaptured()]);
  const now = Date.now();

  // Leilões terminados, com link de catálogo válido, ainda não capturados. Mais antigos
  // primeiro (data do leilão) para o backfill drenar o histórico em ordem.
  const pending = seen
    .filter((a) => !captured.has(a.id_leilao))
    .filter((a) => auctionFinished(a.day_key, a.start_time, now))
    .map((a) => ({ row: a, ref: parseAuctionRef(a.entry_url ?? "") }))
    .filter(
      (x): x is { row: SeenAuctionRow; ref: { domain: string; idLeilao: string } } =>
        x.ref !== null,
    )
    .sort((a, b) => a.row.day_key.localeCompare(b.row.day_key));

  const batch = pending.slice(0, maxAuctions);
  let sales = 0;
  const doneIds: string[] = [];
  for (const { row, ref } of batch) {
    try {
      const catalog = await fetchCatalogData(ref.domain, ref.idLeilao);
      const rows = salesRowsFromCatalog(
        {
          idLeilao: ref.idLeilao,
          domain: ref.domain,
          dayKey: row.day_key,
          house: row.house,
          uf: row.uf ?? "",
        },
        catalog,
      );
      if (rows.length) sales += await upsertLotSales(rows);
      // Catálogo lido com sucesso → leilão capturado (não revisita), mesmo com 0 vendas
      // reconhecidas (leilão terminado tem catálogo estável).
      doneIds.push(ref.idLeilao);
    } catch (error) {
      console.error(`[lot-sales] falha ao capturar vendas do leilão ${ref.idLeilao}`, error);
      // Não marca como capturado → tenta de novo numa próxima rodada.
    }
  }
  if (doneIds.length) await markSalesCaptured(doneIds);

  const remaining = Math.max(0, pending.length - doneIds.length);
  return { sales, auctions: doneIds.length, remaining, done: remaining === 0 };
}

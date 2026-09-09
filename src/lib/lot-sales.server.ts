import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { type Condition, parseConditionFromText } from "./grading";
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

/** Identidade dos nossos lotes de VINIL (por id), para filtrar o catálogo e nomear a venda. */
export type VinylInfo = { title: string; artist: string };

// Sinal POSITIVO de vinil no texto do card (formato). NÃO usa "disco" solto (fraco: casa
// "Catavento Discos", "disco voador"…). Grau de Disco/Capa também conta como vinil.
const VINYL_FORMAT =
  /\b(?:lps?|vinil|vinyl|compacto|bolach[aã]o|long\s*play|33\s*rpm)\b|disco\s+de\s+vinil/i;

export function looksVinyl(text: string, cond: Condition): boolean {
  return Boolean(cond.media || cond.sleeve) || VINYL_FORMAT.test(text);
}

/** Título conciso a partir do descritivo do catálogo (corta estado/venda/visitas e nº inicial). */
export function catalogTitle(text: string): string {
  return text
    .split(
      /\s(?:-\s*)?(?:capa|disco|m[íi]dia|vinil)\s+(?:M-|VG\+\+|VG\+|VG-|G\+|G-|F\/P|NM|EX|VG|G|M)\b/i,
    )[0]!
    .split(/valor\s+de\s+venda|\bvisita/i)[0]!
    .replace(/^\s*\d{1,4}\s+/, "") // nº do lote no começo ("140 GILBERTO GIL…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * Monta as linhas de venda de um leilão a partir do catálogo — só de lotes de VINIL. O
 * `catalogo.asp` da casa lista TODAS as categorias (livros, DVDs, medalhas, miudezas…), então
 * filtramos: (1) lotes que conhecemos (`vinylById`, id do nosso vinil) → identidade LIMPA do
 * nosso lote; (2) lotes desconhecidos (leilões que já saíram da janela) que **parecem vinil**
 * pelo texto (grau Disco/Capa ou LP/vinil/compacto) → identidade do descritivo do catálogo. O
 * resto (jornal/medalha/fósforo/CD/DVD) é descartado. Catálogo entra só p/ valor + estado.
 */
function salesRowsFromCatalog(
  auction: { idLeilao: string; domain: string; dayKey: string; house: string; uf: string },
  catalog: Map<string, import("./leiloesbr-catalog.server").CatalogLot>,
  vinylById: Map<string, VinylInfo>,
): LotSaleRow[] {
  const rows: LotSaleRow[] = [];
  for (const [idPeca, data] of catalog) {
    if (!data.sold || !data.soldPrice) continue; // fail-closed: sem venda clara, não grava
    const lotId = `${auction.idLeilao}-${idPeca}`;
    const known = vinylById.get(lotId);
    const catCond = parseConditionFromText(data.text);
    if (!known && !looksVinyl(data.text, catCond)) continue; // desconhecido e não parece vinil → pula

    const title = known?.title || catalogTitle(data.text);
    // Estado: prefere o grau do catálogo; cai no título.
    const cond =
      catCond.media || catCond.sleeve || catCond.insert ? catCond : parseConditionFromText(title);
    rows.push({
      lot_id: lotId,
      id_leilao: auction.idLeilao,
      id_peca: idPeca,
      artist: known?.artist || extractArtist(title),
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
 * Diagnóstico da captura de vendas: sonda o catálogo dos primeiros `limit` leilões TERMINADOS
 * (ignorando o checkpoint de capturados) e devolve sinais crus — quantos lotes o parser vê,
 * quantos reconhece como vendidos, se o HTML contém "Valor de venda"/"vendido"/"não vendido",
 * e uma amostra. NÃO grava nada nem marca como capturado. Serve para confirmar se `sales:0` é
 * legítimo ou se o parser precisa de ajuste para o formato daquela casa.
 */
export async function debugSales(
  limit = 3,
  num?: string,
): Promise<{ probed: number; auctions: unknown[] }> {
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const seen = await readSeenAuctions();
  const now = Date.now();
  const finished = seen
    // `num` sonda UM leilão específico (ignora o filtro de terminado); senão, os TERMINADOS.
    .filter((a) => (num ? a.id_leilao === num : auctionFinished(a.day_key, a.start_time, now)))
    .map((a) => ({ row: a, ref: parseAuctionRef(a.entry_url ?? "") }))
    .filter(
      (x): x is { row: SeenAuctionRow; ref: { domain: string; idLeilao: string } } =>
        x.ref !== null,
    )
    // Mais RECENTES primeiro (catálogo ainda vivo tem mais chance de trazer os lotes).
    .sort((a, b) => b.row.day_key.localeCompare(a.row.day_key))
    .slice(0, limit);

  const auctions: unknown[] = [];
  for (const { row, ref } of finished) {
    try {
      const map = await fetchCatalogData(ref.domain, ref.idLeilao);
      let sold = 0;
      let sample: unknown = null;
      for (const [idPeca, d] of map) {
        if (d.sold) {
          sold++;
          if (!sample)
            sample = { idPeca, lote: d.lote, soldPrice: d.soldPrice, text: d.text.slice(0, 140) };
        }
      }
      auctions.push({
        idLeilao: ref.idLeilao,
        house: row.house,
        domain: ref.domain,
        lotsParsed: map.size,
        soldParsed: sold,
        sample,
      });
    } catch (error) {
      auctions.push({
        idLeilao: ref.idLeilao,
        house: row.house,
        domain: ref.domain,
        error: (error as Error)?.message,
      });
    }
  }
  return { probed: auctions.length, auctions };
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
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");

  const [seen, captured, snapshot] = await Promise.all([
    readSeenAuctions(),
    getSalesCaptured(),
    scrapeVinylLots(false),
  ]);
  const now = Date.now();

  // Identidade dos NOSSOS lotes de vinil (id → título/artista já parseados). Só capturamos
  // vendas destes — o catálogo da casa traz todas as categorias (livros, DVDs, medalhas…).
  const vinylById = new Map<string, VinylInfo>();
  for (const lot of snapshot.lots) vinylById.set(lot.id, { title: lot.title, artist: lot.artist });

  // Leilões terminados, com link de catálogo válido, ainda não capturados. Mais RECENTES
  // primeiro: o catálogo da casa só fica de pé por um tempo após o leilão (os antigos já
  // saíram do ar e devolvem página genérica sem lotes), então priorizamos os que ainda têm
  // catálogo vivo. Os antigos ainda são processados (e marcados) nas rodadas seguintes.
  const pending = seen
    .filter((a) => !captured.has(a.id_leilao))
    .filter((a) => auctionFinished(a.day_key, a.start_time, now))
    .map((a) => ({ row: a, ref: parseAuctionRef(a.entry_url ?? "") }))
    .filter(
      (x): x is { row: SeenAuctionRow; ref: { domain: string; idLeilao: string } } =>
        x.ref !== null,
    )
    .sort((a, b) => b.row.day_key.localeCompare(a.row.day_key));

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
        vinylById,
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

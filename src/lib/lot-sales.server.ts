import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { type Condition, parseConditionFromText, scoreCondition } from "./grading";
import {
  auctionFinished,
  extractArtist,
  isGenericArtist,
  looksNonVinylSale,
  parsePrice,
} from "./vinyl-parse";

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
  // Sinais ricos do catálogo (mesma varredura): demanda, taxa e valor inicial.
  views: number | null; // nº de visualizações do lote (demanda)
  bids: number | null; // nº de lances (demanda)
  fee_pct: number | null; // comissão do leiloeiro em % (custo real = venda × (1 + taxa/100))
  initial_price: number | null; // valor inicial/contratado (p/ desconto/ágio vs. venda)
};

const PAGE = 1000;
const SALE_COLUMNS =
  "lot_id, id_leilao, id_peca, artist, title, sold_price, sold_price_raw, sold_date, house, uf, media, sleeve, score, faixa, insert_state, source_url, views, bids, fee_pct, initial_price";

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

// Prefixo de formato no início do PECA ("Disco de vinil ...", "LP ...", "Disco ...").
const PECA_FORMAT_PREFIX =
  /^(?:disco de vinil|discos?|lps?|vinil|vinyl|compacto|bolach[aã]o)\b[\s:.\-–—]*/i;
// Sufixo de estado no fim do PECA ("... - Novo", "- Usado", "- Regular").
const PECA_STATE_SUFFIX =
  /\s*[-–—]\s*(?:novo|usado|semi-?novo|regular|[óo]timo|bom|ruim|conforme fotos)\.?\s*$/i;

/**
 * Melhor título p/ identidade a partir do lote do catálogo (#8). Casas cujo DESCRICAO traz
 * "Artista - Álbum" (Discos Esquecidos) → usa o descritivo. Casas em PROSA (Catavento,
 * santavelharia: "Disco de vinil: Título. Gravadora…") → usa o campo **PECA** (título curado,
 * ex.: "Disco Rock In ELMA CHIPS - Novo"), limpo de prefixo de formato e sufixo de estado.
 */
export function bestCatalogTitle(data: import("./leiloesbr-catalog.server").CatalogLot): string {
  const desc = catalogTitle(data.text);
  // Formato ESTRUTURADO (Discos Esquecidos): o DESCRICAO traz grau "CAPA/DISCO <sigla>" e vem
  // como "Artista - Álbum - CAPA …" — o descritivo (cortado no grau) é a melhor identidade.
  // Prosa (Catavento/santavelharia) NÃO tem grau → cai no PECA. (O separador " - " sozinho não
  // serve: a prosa tem "Disco de Vinil - LP".)
  const structured =
    /(?:capa|disco|m[íi]dia|vinil)\s+(?:M-|VG\+\+|VG\+|VG-|G\+|G-|F\/P|NM|EX|VG|G|M)\b/i.test(
      data.text,
    );
  if (structured) return desc;
  if (data.peca) {
    const p = data.peca
      .replace(PECA_FORMAT_PREFIX, "")
      .replace(PECA_STATE_SUFFIX, "")
      .replace(/\s+/g, " ")
      .trim();
    if (p) return p.slice(0, 160);
  }
  return desc;
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
    // Exclui OUTROS formatos (DVD, HQ, revista, livro, K7…) do histórico — mesmo se o texto
    // disser "disco" (um DVD também é "disco"). Aplica-se a conhecidos e desconhecidos.
    if (looksNonVinylSale(`${data.peca ?? ""} ${data.text}`)) continue;
    const lotId = `${auction.idLeilao}-${idPeca}`;
    const known = vinylById.get(lotId);
    const catCond = parseConditionFromText(data.text);
    if (!known && !looksVinyl(data.text, catCond)) continue; // desconhecido e não parece vinil → pula

    const title = known?.title || bestCatalogTitle(data);
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
      views: data.views ?? null,
      bids: data.bids ?? null,
      fee_pct: data.feePct ?? null,
      initial_price: data.initialPrice ?? null,
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

// Teto de linhas por RODADA (somado entre todos os leilões do batch) que passam pelo
// fallback de IA — mantém a rodada rápida/barata mesmo com muitos lotes sem sigla no catálogo.
const AI_CONDITION_CAP = 25;
// Teto por RODADA de vendas cujo ARTISTA é genérico/lixo e vão à IA de identificação
// (extrai "Artista - Álbum" corretos do texto do catálogo; grava também em `lot_ident`).
const AI_IDENT_CAP = 25;

/**
 * Varredura pós-leilão: para os leilões JÁ CONHECIDOS (`seen_auctions`) que terminaram e
 * ainda não foram capturados, busca o catálogo UMA vez por leilão e grava as vendas em
 * `lot_sales`. Processa até `maxAuctions` por rodada (cursor em `app_state.sales_captured`),
 * então roda várias vezes até zerar o backlog (backfill retroativo + fluxo contínuo).
 * Retorna quantas vendas gravou, quantos leilões processou e se ainda há pendentes.
 *
 * **Fallback de IA**: das vendas que ficaram sem estado pelo regex mas TÊM texto descritivo,
 * até `AI_CONDITION_CAP` por rodada (somado entre os leilões do batch) passam por
 * `conditionAiSync` (só quando algum provedor está configurado — best-effort).
 */
export async function captureFinishedSales(maxAuctions = 8): Promise<{
  sales: number;
  auctions: number;
  remaining: number;
  done: boolean;
  aiUsed?: number;
  identUsed?: number;
}> {
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const { getSalesCaptured, markSalesCaptured } = await import("./app-state.server");
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  const { getAllLotIdent } = await import("./lot-ident.server");
  const { aiConfigured } = await import("./ai-eval.server");
  const aiOn = aiConfigured();

  const [seen, captured, snapshot, identRows] = await Promise.all([
    readSeenAuctions(),
    getSalesCaptured(),
    scrapeVinylLots(false),
    getAllLotIdent().catch(() => []),
  ]);
  const now = Date.now();

  // Identidade dos NOSSOS lotes de vinil (id → título/artista já parseados), com a qual nomeamos
  // a venda e priorizamos identidade LIMPA. Do snapshot da janela (título/artista) e, de forma
  // DURÁVEL, do `lot_ident` (álbum "Artista - Álbum") — cobre leilões que já saíram da janela e
  // casas cujo descritivo não vem no formato "Artista - Álbum" (ex.: Catavento).
  const vinylById = new Map<string, VinylInfo>();
  for (const r of identRows) {
    if (r.album) vinylById.set(r.id, { title: r.album, artist: extractArtist(r.album) });
  }
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
  let aiUsed = 0;
  let identUsed = 0;
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

      // Reident por IA: vendas cujo ARTISTA ficou genérico/lixo ("Colecionismo", "Duplo",
      // "Various Artists", "Ao Vivo"…) — a IA extrai "Artista - Álbum" corretos do texto do
      // catálogo. O resultado é gravado em `lot_ident` (durável, reaproveitado nas próximas
      // rodadas) e aplicado à venda agora. Teto por rodada, best-effort.
      if (aiOn && identUsed < AI_IDENT_CAP && rows.length) {
        const budget = AI_IDENT_CAP - identUsed;
        const candidates = rows
          .filter((r) => isGenericArtist(r.artist))
          .map((r) => ({ row: r, text: catalog.get(r.id_peca)?.text ?? "" }))
          .filter((c) => c.text.trim())
          .slice(0, budget);
        if (candidates.length) {
          const { identLotsSyncRows, resolveAiProvider } = await import("./ai-eval.server");
          const { upsertLotIdent } = await import("./lot-ident.server");
          const provider = await resolveAiProvider();
          const { rows: identOut } = await identLotsSyncRows(
            candidates.map((c) => ({
              id: c.row.lot_id,
              title: c.text,
              price: "",
              house: row.house,
              image: null,
            })),
            false,
            provider,
          );
          const withAlbum = identOut.filter((r) => r.album);
          if (withAlbum.length) await upsertLotIdent(withAlbum);
          const byId = new Map(withAlbum.map((r) => [r.id, r.album!]));
          for (const { row: saleRow } of candidates) {
            const album = byId.get(saleRow.lot_id);
            if (!album) continue;
            saleRow.title = album;
            saleRow.artist = extractArtist(album);
            identUsed += 1;
          }
        }
      }

      // Fallback de IA: só as vendas SEM estado pelo regex mas com texto pra IA ler, até
      // esgotar o teto da RODADA (soma entre os leilões deste batch).
      if (aiOn && aiUsed < AI_CONDITION_CAP && rows.length) {
        const budget = AI_CONDITION_CAP - aiUsed;
        const candidates = rows
          .filter((r) => !r.media && !r.sleeve && !r.insert_state)
          .map((r) => ({ row: r, text: catalog.get(r.id_peca)?.text ?? "" }))
          .filter((c) => c.text.trim())
          .slice(0, budget);
        if (candidates.length) {
          const { conditionAiSync, resolveAiProvider } = await import("./ai-eval.server");
          const provider = await resolveAiProvider();
          const { rows: aiRows } = await conditionAiSync(
            candidates.map((c) => ({ id: c.row.lot_id, text: c.text })),
            provider,
          );
          const byId = new Map(aiRows.map((r) => [r.id, r]));
          for (const { row: saleRow } of candidates) {
            const ai = byId.get(saleRow.lot_id);
            if (!ai) continue;
            const { media, sleeve, score, faixa } = scoreCondition(ai.media, ai.sleeve);
            if (media || sleeve) {
              saleRow.media = media ?? "";
              saleRow.sleeve = sleeve ?? "";
              saleRow.score = score;
              saleRow.faixa = faixa?.label ?? "";
              aiUsed += 1;
            }
            if (ai.insert !== null) saleRow.insert_state = ai.insert;
          }
        }
      }

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
  return { sales, auctions: doneIds.length, remaining, done: remaining === 0, aiUsed, identUsed };
}

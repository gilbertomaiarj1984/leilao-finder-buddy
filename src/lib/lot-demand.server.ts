import { getSql } from "./db.server";
import { getAllLotCondition, invalidateLotConditionCache } from "./lot-condition.server";
import { pickDemandAuctions, type DemandCandidate } from "./lot-demand";

/**
 * Relê a DEMANDA (VISITAS/QTDLANCE) dos lotes dos próximos dias direto do catálogo da casa
 * (1 requisição paginada por leilão, nunca por lote) e atualiza só `views`/`bids`/`demand_at` em
 * `lot_condition`. Antes a demanda era gravada uma única vez, quando o lote entrava na fila de
 * estado — dias antes do pregão, quase sempre com 0 lances — e nunca mais mudava.
 *
 * Chunked como `condition`: cada chamada processa até `maxAuctions` leilões (os de leitura mais
 * velha primeiro). Falha de uma casa (403, timeout) só pula aquele leilão; ele volta na próxima.
 */
export async function refreshDemand(
  maxAuctions = 4,
  dayCount = 2,
): Promise<{
  updated: number;
  auctions: number;
  failed: number;
  remaining: number;
  done: boolean;
}> {
  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  const { parseAuctionRef, fetchCatalogData } = await import("./leiloesbr-catalog.server");
  const { upcomingDayKeys } = await import("./vinyl-parse");

  const [snapshot, conditions] = await Promise.all([scrapeVinylLots(false), getAllLotCondition()]);
  const demandAt = new Map(
    conditions.map((c) => [c.id, (c as { demand_at?: string | null }).demand_at ?? null]),
  );
  const refs = new Map<string, { domain: string; idLeilao: string }>();
  const candidates: DemandCandidate[] = [];
  const idPecaById = new Map<string, string>();
  for (const lot of snapshot.lots) {
    // Só lotes que já têm linha em `lot_condition` (o UPDATE não cria linha).
    if (!lot.id || !demandAt.has(lot.id)) continue;
    const ref = parseAuctionRef(lot.url);
    if (!ref) continue;
    const auctionKey = `${ref.domain}|${ref.idLeilao}`;
    refs.set(auctionKey, ref);
    idPecaById.set(lot.id, lot.idPeca);
    candidates.push({
      id: lot.id,
      dayKey: lot.dayKey,
      time: lot.time,
      demandAt: demandAt.get(lot.id),
      auctionKey,
    });
  }

  const picked = pickDemandAuctions(candidates, upcomingDayKeys(dayCount));
  const batch = picked.slice(0, maxAuctions);
  const ids: string[] = [];
  const views: (number | null)[] = [];
  const bids: (number | null)[] = [];
  let failed = 0;
  for (const auction of batch) {
    const ref = refs.get(auction.auctionKey)!;
    let catalog;
    try {
      catalog = await fetchCatalogData(ref.domain, ref.idLeilao);
    } catch (error) {
      failed += 1;
      console.error(`[demand] falha ao ler catálogo do leilão ${ref.idLeilao}`, error);
      continue;
    }
    for (const id of auction.ids) {
      const item = catalog.get(idPecaById.get(id) ?? "");
      // Sem o lote no catálogo, ou catálogo em HTML antigo (sem VISITAS/QTDLANCE): não sobrescreve.
      if (!item || (item.views == null && item.bids == null)) continue;
      ids.push(id);
      views.push(item.views ?? null);
      bids.push(item.bids ?? null);
    }
  }

  let updated = 0;
  if (ids.length) {
    const sql = getSql();
    const res = await sql`
      update public.lot_condition lc
         set views = d.views, bids = d.bids, demand_at = now()
        from unnest(${sql.array(ids, 1009)}::text[], ${sql.array(views, 1007)}::int[], ${sql.array(bids, 1007)}::int[])
             as d(id, views, bids)
       where lc.id = d.id`;
    updated = res.count;
    // Sem isto a próxima chamada (cache de 30 s) releria os MESMOS leilões, achando-os ainda velhos.
    invalidateLotConditionCache();
  }
  const remaining = Math.max(0, picked.length - batch.length);
  // Todas as casas da rodada falharam: encerra (insistir repetiria as mesmas requisições bloqueadas).
  return {
    updated,
    auctions: batch.length,
    failed,
    remaining,
    done: remaining === 0 || (batch.length > 0 && failed === batch.length),
  };
}

import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getUnsoldLots } from "@/lib/leiloesbr.functions";
import type { VinylLot } from "@/lib/vinyl-parse";

import { houseAuctionInfo, splitByAuction } from "./grouping";

type DayNoBid = {
  /** `idPeca` dos lotes do dia que ainda não receberam lance; `null` enquanto busca (ou desligado). */
  ids: ReadonlySet<string> | null;
  loading: boolean;
  /** Lotes de pregões sem link de catálogo consultável — ficam de fora do filtro. */
  skipped: number;
};

/**
 * Filtro "Sem lance" da listagem principal do dia (ícone verde): qual lote do dia ainda não
 * recebeu lance. Qualquer dia e qualquer fase do pregão (em breve, ao vivo, encerrado) — usa o
 * mesmo `getUnsoldLots` da visão "Sem lance" de hoje, sem `currentLote` (devolve todo o catálogo
 * sem lance, não só o que já passou no pregão). Só consulta com `enabled` (um catálogo por pregão
 * do dia, cache de 5 min no servidor), então dias sem o filtro ligado não custam nada.
 */
export function useDayNoBid(lots: VinylLot[], dayKey: string, enabled: boolean): DayNoBid {
  const fetchUnsold = useServerFn(getUnsoldLots);

  const auctions = enabled
    ? splitByAuction(lots.filter((lot) => lot.dayKey === dayKey)).map((auction) => ({
        count: auction.lots.length,
        info: houseAuctionInfo(dayKey, auction.lots[0]),
      }))
    : [];
  const targets = auctions.filter((a): a is typeof a & { info: NonNullable<typeof a.info> } =>
    Boolean(a.info?.presencialUrl),
  );
  const skipped = auctions.reduce((n, a) => n + (a.info?.presencialUrl ? 0 : a.count), 0);

  const queries = useQueries({
    queries: targets.map((t) => ({
      queryKey: ["unsold-lots", t.info.idLeilao, dayKey, "all"] as const,
      queryFn: () =>
        fetchUnsold({
          data: { idLeilao: t.info.idLeilao, presencialUrl: t.info.presencialUrl!, dayKey },
        }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  if (!enabled) return { ids: null, loading: false, skipped: 0 };
  const loading = queries.some((q) => q.isLoading);
  if (loading) return { ids: null, loading: true, skipped };
  const ids = new Set<string>();
  for (const q of queries) for (const lot of q.data?.lots ?? []) ids.add(lot.idPeca);
  return { ids, loading: false, skipped };
}

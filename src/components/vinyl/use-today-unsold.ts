import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";

import { getPresencialNow, getUnsoldLots } from "@/lib/leiloesbr.functions";
import { isSeenLive, markSeenLive } from "@/lib/auction-seen-live";
import { trackedAuctionStatus, type VinylLot } from "@/lib/vinyl-parse";

import { groupByHouse, houseAuctionInfo, splitByAuction } from "./grouping";

export type UnsoldLotItem = Awaited<ReturnType<typeof getUnsoldLots>>["lots"][number];

export type TodayUnsoldHouse = {
  house: string;
  houseUrl: string;
  uf: string;
  catalogUrl: string | null;
  idLeilao: string;
  status: "live" | "ended";
  /** lotes sem lance achados até agora (casa ao vivo: só os que já passaram no pregão). */
  lots: UnsoldLotItem[];
  /** lotes do catálogo conhecidos pro dia (vendidos + sem lance); `null` até a 1ª resposta. */
  total: number | null;
  loading: boolean;
};

const LIVE_REFETCH_MS = 60 * 1000;

/**
 * Casas DISTINTAS entre as entradas (há uma por pregão e uma casa pode ter mais de um no dia).
 * `onlyWithLots`: só as que já têm lote sem lance achado.
 */
export function countUnsoldHouses(houses: TodayUnsoldHouse[], onlyWithLots = false): number {
  return new Set(houses.filter((h) => !onlyWithLots || h.lots.length > 0).map((h) => h.house)).size;
}

/**
 * Lotes sem lance das casas de HOJE, para o ícone do dia e a visão "Sem lance" (`unsold-view.tsx`).
 * Por casa: status do pregão (`trackedAuctionStatus`, mesmo acompanhamento do badge — peça
 * atual/total do presencial + "já visto ao vivo"), e a busca sob demanda `getUnsoldLots`:
 * casa encerrada → tudo que não vendeu; casa ao vivo → só o que já passou (`currentLote`),
 * refeita a cada minuto, então a lista cresce conforme os lotes são achados. Casa "em breve"
 * fica de fora. Usa as MESMAS chaves de query do polling do presencial (`presencial-now`) e de
 * `unsold-lots`, então chamar o hook em mais de um lugar (cabeçalho + visão) não duplica fetch.
 */
export function useTodayUnsold(lots: VinylLot[], dayKey: string | null): TodayUnsoldHouse[] {
  const fetchNow = useServerFn(getPresencialNow);
  const fetchUnsold = useServerFn(getUnsoldLots);

  const targets = dayKey
    ? groupByHouse(lots.filter((lot) => lot.dayKey === dayKey))
        // Um alvo por PREGÃO (casa com mais de um no dia: cada um tem status e presencial próprios).
        .flatMap((group) =>
          splitByAuction(group.lots).map((auction) => ({
            group,
            info: houseAuctionInfo(dayKey, auction.lots[0]),
          })),
        )
        .filter(
          (t): t is typeof t & { info: NonNullable<typeof t.info> } =>
            Boolean(t.info?.presencialUrl) &&
            t.info?.status !== "upcoming" &&
            t.info?.status !== null,
        )
    : [];

  const nowQueries = useQueries({
    queries: targets.map((t) => ({
      queryKey: ["presencial-now", t.info.presencialUrl ?? ""] as const,
      queryFn: () => fetchNow({ data: { url: t.info.presencialUrl! } }),
      staleTime: 30 * 1000,
      refetchInterval: LIVE_REFETCH_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
  });

  const rows = targets.map((t, i) => {
    const now = nowQueries[i]?.data ?? null;
    const known = now && now.peca !== null && now.total !== null;
    const inProgress = Boolean(known && now.peca! < now.total!);
    const finished = Boolean(known && now.peca! >= now.total!);
    const status = trackedAuctionStatus(
      t.info.status,
      t.info.dayKey,
      { inProgress, finished, seenLive: isSeenLive(t.info.idLeilao, t.info.dayKey) },
      t.info.dayKey,
    );
    return { ...t, status, inProgress, currentLote: now?.lote ?? null };
  });

  useEffect(() => {
    for (const r of rows) if (r.inProgress) markSeenLive(r.info.idLeilao, r.info.dayKey);
  });

  const unsoldQueries = useQueries({
    queries: rows.map((r) => {
      const live = r.status === "live";
      return {
        queryKey: ["unsold-lots", r.info.idLeilao, r.info.dayKey, live ? "live" : "ended"] as const,
        queryFn: () =>
          fetchUnsold({
            data: {
              idLeilao: r.info.idLeilao,
              presencialUrl: r.info.presencialUrl!,
              dayKey: r.info.dayKey,
              ...(live && r.currentLote ? { currentLote: r.currentLote } : {}),
            },
          }),
        // Ao vivo só busca com o lote atual conhecido (sem ele não dá pra saber o que já passou).
        enabled: r.status === "ended" || (live && Boolean(r.currentLote)),
        staleTime: live ? 45 * 1000 : 5 * 60 * 1000,
        refetchInterval: live ? LIVE_REFETCH_MS : false,
        refetchIntervalInBackground: false,
        // Mantém a lista na tela enquanto o refetch (lote atual mudou) chega.
        placeholderData: (prev: Awaited<ReturnType<typeof getUnsoldLots>> | undefined) => prev,
      };
    }),
  });

  return rows.flatMap((r, i): TodayUnsoldHouse[] => {
    if (r.status !== "live" && r.status !== "ended") return [];
    const q = unsoldQueries[i];
    return [
      {
        house: r.group.house,
        houseUrl: r.group.houseUrl,
        uf: r.group.lots[0]?.uf ?? "",
        catalogUrl: r.info.catalogUrl,
        idLeilao: r.info.idLeilao,
        status: r.status,
        lots: q?.data?.lots ?? [],
        total: q?.data?.total ?? null,
        loading: Boolean(q?.isLoading),
      },
    ];
  });
}

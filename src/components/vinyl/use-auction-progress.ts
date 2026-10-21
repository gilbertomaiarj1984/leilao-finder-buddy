import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { isSeenLive, markSeenLive } from "@/lib/auction-seen-live";
import { getPresencialNow } from "@/lib/leiloesbr.functions";
import type { AuctionProgress } from "@/lib/analise-time";
import { startsInMinutes } from "@/lib/analise-time";
import { presencialUrlFromLot, trackedAuctionStatus, type VinylLot } from "@/lib/vinyl-parse";

/** Relógio que reavalia o "em N min" a cada `everyMs` (a Análise o mostra sem recarregar). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const REFETCH_MS = 60 * 1000;

/**
 * Andamento do pregão por casa para os lotes VISÍVEIS da Análise: UMA consulta por pregão
 * (`getPresencialNow`, mesma chave `["presencial-now", url]` do badge da home e da visão "Sem
 * lance" — o cache é dividido), só para pregões de hoje que já começaram. Casas fora da plataforma
 * (sem presencial) ficam sem andamento. Chave do resultado: `idLeilao|dayKey`.
 */
export function useAuctionProgress(
  lots: readonly VinylLot[],
  todayKey: string,
  nowMs: number,
): Map<string, AuctionProgress> {
  const fetchNow = useServerFn(getPresencialNow);
  const targets = useMemo(() => {
    const byKey = new Map<string, { key: string; url: string; idLeilao: string; dayKey: string }>();
    for (const lot of lots) {
      if (lot.dayKey !== todayKey) continue;
      const startsIn = startsInMinutes(lot.dayKey, lot.time, nowMs);
      if (startsIn === null || startsIn > 0) continue; // ainda não começou: sem consulta
      const url = presencialUrlFromLot(lot);
      if (!url) continue;
      const key = `${lot.idLeilao}|${lot.dayKey}`;
      if (!byKey.has(key)) byKey.set(key, { key, url, idLeilao: lot.idLeilao, dayKey: lot.dayKey });
    }
    return [...byKey.values()];
  }, [lots, todayKey, nowMs]);

  const queries = useQueries({
    queries: targets.map((t) => ({
      queryKey: ["presencial-now", t.url] as const,
      queryFn: () => fetchNow({ data: { url: t.url } }),
      staleTime: 30 * 1000,
      refetchInterval: REFETCH_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
  });

  // Assinatura do que cada consulta devolveu (o tamanho do vetor de dependências não pode variar).
  const dataSig = queries
    .map((q) => (q.data ? `${q.data.lote}/${q.data.peca}/${q.data.total}` : "-"))
    .join("|");
  const progress = useMemo(() => {
    const map = new Map<string, AuctionProgress>();
    targets.forEach((t, i) => {
      const now = queries[i]?.data ?? null;
      const known = now !== null && now.peca !== null && now.total !== null;
      const inProgress = Boolean(known && now.peca! < now.total!);
      const status = trackedAuctionStatus(
        "live",
        t.dayKey,
        {
          inProgress,
          finished: Boolean(known && now.peca! >= now.total!),
          seenLive: isSeenLive(t.idLeilao, t.dayKey),
        },
        todayKey,
      );
      if (inProgress) markSeenLive(t.idLeilao, t.dayKey);
      if (status === "live" || status === "ended")
        map.set(t.key, {
          status,
          currentLote: now?.lote ?? null,
          total: now?.total ?? null,
          peca: now?.peca ?? null,
        });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `queries` muda a cada render; `dataSig` resume os dados
  }, [targets, todayKey, dataSig]);
  return progress;
}

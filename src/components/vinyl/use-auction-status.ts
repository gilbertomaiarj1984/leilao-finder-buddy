import { useEffect, useState } from "react";

import { useManuallyFinished } from "./use-manually-finished";
import { usePresencialNow } from "./use-presencial-now";
import { isSeenLive, markSeenLive } from "@/lib/auction-seen-live";
import { trackedAuctionStatus } from "@/lib/vinyl-parse";

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/**
 * Status do pregão de uma casa pautado só no acompanhamento lote a lote (`usePresencialNow`),
 * sem a janela fixa de 3h — ver `trackedAuctionStatus`. Lembra no navegador (`localStorage`)
 * que o pregão já foi visto ao vivo: quando o presencial para de responder, vira "encerrado".
 */
export function useAuctionStatus(
  info: {
    status: "upcoming" | "live" | "ended" | null;
    presencialUrl: string | null | undefined;
    idLeilao: string;
    dayKey: string;
  } | null,
) {
  const base = info?.status ?? null;
  const url = info?.presencialUrl ?? null;
  const idLeilao = info?.idLeilao ?? "";
  const dayKey = info?.dayKey ?? "";
  const { now, isFinished, inProgress } = usePresencialNow(
    base && base !== "upcoming" ? url : null,
  );
  const { finished: manual, markFinished, unmarkFinished } = useManuallyFinished(idLeilao, dayKey);
  const [seenLive, setSeenLive] = useState(() => isSeenLive(idLeilao, dayKey));

  useEffect(() => {
    if (!inProgress) return;
    markSeenLive(idLeilao, dayKey);
    setSeenLive(true);
  }, [inProgress, idLeilao, dayKey, now]);

  const status = trackedAuctionStatus(
    base,
    dayKey,
    { inProgress, finished: isFinished, seenLive, manual },
    todaySP(),
  );
  return { status, manual, markFinished, unmarkFinished };
}

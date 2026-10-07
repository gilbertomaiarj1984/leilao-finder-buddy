import { useEffect, useState } from "react";

import { useManuallyFinished } from "./use-manually-finished";
import { usePresencialNow } from "./use-presencial-now";
import { trackedAuctionStatus } from "@/lib/vinyl-parse";

const STORAGE_KEY = "auctions-seen-live";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function readSeen(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, at]) => typeof at === "number" && now - at < MAX_AGE_MS),
    );
  } catch {
    return {};
  }
}

function markSeen(key: string): void {
  try {
    const store = readSeen();
    store[key] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage indisponível — best-effort.
  }
}

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
  const { finished: manual } = useManuallyFinished(idLeilao, dayKey);
  const seenKey = `${idLeilao}:${dayKey}`;
  const [seenLive, setSeenLive] = useState(() => Boolean(readSeen()[seenKey]));

  useEffect(() => {
    if (!inProgress) return;
    markSeen(seenKey);
    setSeenLive(true);
  }, [inProgress, seenKey, now]);

  const status = trackedAuctionStatus(
    base,
    dayKey,
    { inProgress, finished: isFinished, seenLive, manual },
    todaySP(),
  );
  return { status, presencialFinished: isFinished, manual };
}

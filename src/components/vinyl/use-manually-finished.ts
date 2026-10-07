import { useSyncExternalStore } from "react";

import {
  isManuallyFinished,
  markManuallyFinished,
  notifyManuallyFinishedChange,
  subscribeManuallyFinished,
  unmarkManuallyFinished,
} from "@/lib/manually-finished-auctions";

/**
 * Estado reativo do override manual (`manually-finished-auctions.ts`) para a linha de UM
 * leilão NUM dia específico — `dayKey` importa porque o mesmo `idLeilao` pode cobrir mais de
 * um dia (catálogo multi-dia da casa); marcar "encerrado" só vale pro dia desta linha.
 * Sincronizado entre componentes (badge, link, seção "Acontecendo agora") por evento.
 */
export function useManuallyFinished(idLeilao: string, dayKey: string) {
  const finished = useSyncExternalStore(
    subscribeManuallyFinished,
    () => isManuallyFinished(idLeilao, dayKey),
    () => false,
  );
  const markFinished = () => {
    markManuallyFinished(idLeilao, dayKey);
    notifyManuallyFinishedChange();
  };
  const unmarkFinished = () => {
    unmarkManuallyFinished(idLeilao, dayKey);
    notifyManuallyFinishedChange();
  };
  return { finished, markFinished, unmarkFinished };
}

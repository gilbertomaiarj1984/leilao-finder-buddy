import { useState } from "react";

import { isManuallyFinished, markManuallyFinished } from "@/lib/manually-finished-auctions";

/**
 * Estado reativo do override manual (`manually-finished-auctions.ts`) para a linha de UM
 * leilão NUM dia específico — `dayKey` importa porque o mesmo `idLeilao` pode cobrir mais de
 * um dia (catálogo multi-dia da casa); marcar "encerrado" só vale pro dia desta linha.
 */
export function useManuallyFinished(idLeilao: string, dayKey: string) {
  const [finished, setFinished] = useState(() => isManuallyFinished(idLeilao, dayKey));
  const markFinished = () => {
    markManuallyFinished(idLeilao, dayKey);
    setFinished(true);
  };
  return { finished, markFinished };
}

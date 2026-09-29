import { useState } from "react";

import { isManuallyFinished, markManuallyFinished } from "@/lib/manually-finished-auctions";

/** Estado reativo do override manual (`manually-finished-auctions.ts`) para UM leilão. */
export function useManuallyFinished(idLeilao: string) {
  const [finished, setFinished] = useState(() => isManuallyFinished(idLeilao));
  const markFinished = () => {
    markManuallyFinished(idLeilao);
    setFinished(true);
  };
  return { finished, markFinished };
}

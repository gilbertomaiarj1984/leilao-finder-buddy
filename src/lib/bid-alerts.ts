// Aviso de "lance superado": dispara um toast quando um lote em que o usuário tem lance
// muda de status para "Coberto" (alguém deu um lance maior). Roda só com o app aberto,
// no mesmo refetch de `["vinyl-my-bids"]` já existente (staleTime 5min + refresh manual) —
// sem cron, sem tabela nova no Supabase, sem push/e-mail.
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { bidIsCovered } from "./vinyl-parse";
import { loadAccum, saveAccum } from "./watched-accum";
import type { MyBid } from "./leiloesbr-bids.server";

// Snapshot do último `status` visto por lote (`id`), para só avisar na TRANSIÇÃO para
// "Coberto" — sem isso, todo carregamento de página reavisaria de lotes já cobertos
// numa sessão anterior.
export const BID_STATUS_SNAPSHOT_KEY = "leilao-finder:bid-status-snapshot:v1";

export function detectNewlyCoveredBids(
  bids: MyBid[],
  prevSnapshot: Map<string, string>,
): { newlyCovered: MyBid[]; nextSnapshot: Map<string, string> } {
  const nextSnapshot = new Map(prevSnapshot);
  const newlyCovered: MyBid[] = [];
  for (const bid of bids) {
    const prevStatus = prevSnapshot.get(bid.id);
    if (bidIsCovered(bid.status) && (prevStatus === undefined || !bidIsCovered(prevStatus))) {
      newlyCovered.push(bid);
    }
    nextSnapshot.set(bid.id, bid.status);
  }
  return { newlyCovered, nextSnapshot };
}

/**
 * Avisa (toast) quando `bids` traz um lote que acabou de virar "Coberto". Chamar com o
 * `bids.data` da MESMA query `["vinyl-my-bids"]` usada em `index.tsx`/`analise.tsx` — o
 * snapshot é compartilhado (mesma chave de `localStorage`) entre as duas rotas.
 */
export function useBidCoveredAlerts(bids: MyBid[] | undefined): void {
  const snapshotRef = useRef<Map<string, string> | null>(null);
  if (snapshotRef.current === null) {
    snapshotRef.current = loadAccum<string>(BID_STATUS_SNAPSHOT_KEY);
  }

  useEffect(() => {
    if (!bids) return;
    const { newlyCovered, nextSnapshot } = detectNewlyCoveredBids(bids, snapshotRef.current!);
    snapshotRef.current = nextSnapshot;
    saveAccum(BID_STATUS_SNAPSHOT_KEY, nextSnapshot);
    if (newlyCovered.length === 0) return;
    if (newlyCovered.length === 1) {
      const bid = newlyCovered[0];
      toast.warning(`Lance superado: ${bid.title}`, { description: bid.house });
    } else {
      toast.warning(`${newlyCovered.length} lances foram superados`, {
        description: newlyCovered.map((b) => b.title).join(", "),
      });
    }
  }, [bids]);
}

// Aviso de "lance superado": dispara um toast quando um lote em que o usuário tem lance
// muda de status para "Coberto" (alguém deu um lance maior). Roda só com o app aberto,
// no mesmo refetch de `["vinyl-my-bids"]` já existente (staleTime 5min + refresh manual) —
// sem cron, sem tabela nova no banco, sem push/e-mail.
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { formatCoveredLot } from "@/components/vinyl/ai-score-utils";

import { bidIsCovered } from "./vinyl-parse";
import { loadAccum, saveAccum } from "./watched-accum";
import type { MyBid } from "./leiloesbr-bids.server";

// Snapshot do último `status` visto por lote (`id`), para só avisar na TRANSIÇÃO para
// "Coberto" — sem isso, todo carregamento de página reavisaria de lotes já cobertos
// numa sessão anterior.
const BID_STATUS_SNAPSHOT_KEY = "leilao-finder:bid-status-snapshot:v1";

function detectNewlyCoveredBids(
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
export function useBidCoveredAlerts(
  bids: MyBid[] | undefined,
  albumFor?: (lotId: string) => string | null,
): void {
  const snapshotRef = useRef<Map<string, string> | null>(null);
  if (snapshotRef.current === null) {
    snapshotRef.current = loadAccum<string>(BID_STATUS_SNAPSHOT_KEY);
  }
  // Ref para o efeito não reexecutar (e reavisar) quando só a função de álbum muda.
  const albumForRef = useRef(albumFor);
  albumForRef.current = albumFor;

  useEffect(() => {
    if (!bids) return;
    const { newlyCovered, nextSnapshot } = detectNewlyCoveredBids(bids, snapshotRef.current!);
    snapshotRef.current = nextSnapshot;
    saveAccum(BID_STATUS_SNAPSHOT_KEY, nextSnapshot);
    if (newlyCovered.length === 0) return;
    // Fica aberto até o usuário fechar (sem timeout) e mostra só nº do lote, artista e álbum.
    toast.warning(
      newlyCovered.length === 1 ? "Lance superado" : `${newlyCovered.length} lances superados`,
      {
        description: newlyCovered
          .map((b) => formatCoveredLot(b, albumForRef.current?.(b.id)))
          .join("\n"),
        duration: Infinity,
        closeButton: true,
        style: { whiteSpace: "pre-line" },
      },
    );
  }, [bids]);
}

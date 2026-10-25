// Aviso de "lance superado": dispara um toast quando um lote em que o usuário tem lance
// muda de status para "Coberto" (alguém deu um lance maior). Roda só com o app aberto,
// no mesmo refetch de `["vinyl-my-bids"]` já existente (staleTime 5min + refresh manual) —
// sem cron, sem tabela nova no banco, sem push/e-mail.
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { formatCoveredLot, formatCoveredWhere } from "@/components/vinyl/ai-score-utils";

import { newlyCoveredBids } from "./bid-transitions";
import { loadAccum, saveAccum } from "./watched-accum";
import type { MyBid } from "./leiloesbr-bids.server";
import { lotOpenUrl } from "./vinyl-parse";

// Snapshot do último `status` visto por lote (`id`), para só avisar na TRANSIÇÃO para
// "Coberto" — sem isso, todo carregamento de página reavisaria de lotes já cobertos
// numa sessão anterior.
const BID_STATUS_SNAPSHOT_KEY = "leilao-finder:bid-status-snapshot:v1";

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
    const { newlyCovered, nextSnapshot } = newlyCoveredBids(bids, snapshotRef.current!);
    snapshotRef.current = nextSnapshot;
    saveAccum(BID_STATUS_SNAPSHOT_KEY, nextSnapshot);
    if (newlyCovered.length === 0) return;
    // Fica aberto até o usuário fechar (sem timeout): por lote, nº/artista/álbum, dia e casa do
    // leilão e um link para abrir o lote no leiloeiro.
    toast.warning(
      newlyCovered.length === 1 ? "Lance superado" : `${newlyCovered.length} lances superados`,
      {
        description: (
          <div className="flex flex-col gap-2">
            {newlyCovered.map((b) => (
              <div key={b.id} className="flex flex-col">
                <span>{formatCoveredLot(b, albumForRef.current?.(b.id))}</span>
                <span className="text-xs opacity-80">{formatCoveredWhere(b)}</span>
                <a
                  href={lotOpenUrl(b.url, b.title, b.lote)}
                  target="_blank"
                  rel="noreferrer"
                  className="w-fit text-xs font-medium underline underline-offset-2"
                >
                  Ver lote no leiloeiro
                </a>
              </div>
            ))}
          </div>
        ),
        duration: Infinity,
        closeButton: true,
      },
    );
  }, [bids]);
}

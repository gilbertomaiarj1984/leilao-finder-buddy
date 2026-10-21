import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DiscCodeScannerDialog } from "@/components/vinyl/disc-code-scanner-dialog";
import { refreshLotTracklistFn } from "@/lib/ai.functions";
import { queryKeys } from "@/lib/queries";

export type TracklistRefresh = {
  /** Pede as faixas: abre a pergunta “ler o código com a câmera ou buscar só pelo nome”. */
  onClick: () => void;
  pending: boolean;
  /** Diálogo dessa pergunta — quem usa o refresh precisa renderizá-lo (fora de popovers que fecham). */
  dialog?: ReactNode;
};

/**
 * Refresh manual da tracklist de um lote: re-puxa as faixas do Discogs e depois força a fama
 * pela IA; atualiza o cache `lotAi`. Sem `lotId`, devolve `undefined` (sem botão). A câmera NUNCA
 * abre direto: o clique abre `DiscCodeScannerDialog` em modo `askBeforeCamera` (o código lido
 * escolhe o release exato do Discogs; “buscar só pelo nome” segue sem ele).
 */
export function useLotTracklistRefresh(lotId?: string | null): TracklistRefresh | undefined {
  const queryClient = useQueryClient();
  const run = useServerFn(refreshLotTracklistFn);
  const [asking, setAsking] = useState(false);
  const mutation = useMutation({
    mutationFn: ({ id, code }: { id: string; code?: string }) => run({ data: { id, code } }),
    onSuccess: (res, { id }) => {
      queryClient.setQueryData(queryKeys.lotTracklist(id), res.tracklist);
      queryClient.setQueriesData({ queryKey: queryKeys.lotAi }, (old: unknown) =>
        Array.isArray(old)
          ? old.map((r) =>
              r && (r as { id: string }).id === id
                ? { ...(r as object), hasTracklist: Boolean(res.tracklist?.length) }
                : r,
            )
          : old,
      );
      toast.success(
        res.rated ? "Faixas do Discogs e fama da IA atualizadas" : "Faixas do Discogs atualizadas",
      );
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível atualizar as faixas"),
  });
  if (!lotId) return undefined;
  return {
    onClick: () => setAsking(true),
    pending: mutation.isPending,
    dialog: (
      <DiscCodeScannerDialog
        open={asking}
        askBeforeCamera
        title="Buscar as faixas deste disco"
        confirmLabel="Usar o código e buscar faixas"
        skipLabel="Buscar só pelo nome"
        onClose={() => setAsking(false)}
        onSkip={() => mutation.mutate({ id: lotId })}
        onConfirm={(code) => mutation.mutate({ id: lotId, code })}
      />
    ),
  };
}

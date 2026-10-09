import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { refreshLotTracklistFn } from "@/lib/ai.functions";
import { queryKeys } from "@/lib/queries";

export type TracklistRefresh = { onClick: () => void; pending: boolean };

/**
 * Refresh manual da tracklist de um lote: re-puxa as faixas do Discogs e depois força a fama
 * pela IA; atualiza o cache `lotAi`. Sem `lotId`, devolve `undefined` (sem botão).
 */
export function useLotTracklistRefresh(lotId?: string | null): TracklistRefresh | undefined {
  const queryClient = useQueryClient();
  const run = useServerFn(refreshLotTracklistFn);
  const mutation = useMutation({
    mutationFn: (id: string) => run({ data: { id } }),
    onSuccess: (res, id) => {
      queryClient.setQueryData(queryKeys.lotAi, (old: unknown) =>
        Array.isArray(old)
          ? old.map((r) =>
              r && (r as { id: string }).id === id
                ? { ...(r as object), tracklist: res.tracklist }
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
  return { onClick: () => mutation.mutate(lotId), pending: mutation.isPending };
}

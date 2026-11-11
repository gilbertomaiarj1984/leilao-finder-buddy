import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LotCard } from "@/components/vinyl/lot-card";
import { useLotCardData } from "@/components/vinyl/use-lot-card-data";
import { getScheduledLot } from "@/lib/bid-schedule.functions";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { queryKeys, useWatchedQuery } from "@/lib/queries";
import { errorMessage } from "@/lib/transient-error";

/**
 * Cartão COMPLETO do lote de um agendamento (o mesmo `LotCard` da home), aberto ao clicar no
 * agendamento. O lote vem do banco pelo leilão + nº do lote (sem depender da janela de dias da home).
 */
export function ScheduledLotDialog({
  idLeilao,
  targetLote,
  onClose,
}: {
  idLeilao: string;
  targetLote: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchLot = useServerFn(getScheduledLot);
  const runWatch = useServerFn(toggleWatch);
  const query = useQuery({
    queryKey: ["scheduled-lot", idLeilao, targetLote] as const,
    queryFn: () => fetchLot({ data: { idLeilao, targetLote } }),
    staleTime: 5 * 60 * 1000,
  });
  const lot = query.data ?? null;
  const { query: watchedQuery } = useWatchedQuery();
  const watched = Boolean(
    lot && watchedQuery.data?.some((w) => w.idPeca === lot.idPeca && w.idLeilao === lot.idLeilao),
  );
  const data = useLotCardData(lot ? { id: lot.id, title: lot.title, uf: lot.uf } : null);

  const toggle = useMutation({
    mutationFn: async () => {
      if (!lot) return false;
      return (
        await runWatch({
          data: { idPeca: lot.idPeca, idLeilao: lot.idLeilao, base: lot.base, watch: !watched },
        })
      ).watched;
    },
    onSuccess: (now) => {
      toast.success(now ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
      void qc.invalidateQueries({ queryKey: queryKeys.watched });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível alterar a vigia")),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-3">
        <DialogTitle className="sr-only">Lote {targetLote}</DialogTitle>
        <DialogDescription className="sr-only">
          Cartão completo do lote agendado, com avaliação da IA, mercado, estado e ações.
        </DialogDescription>
        {query.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando o lote…</p>
        ) : lot ? (
          <LotCard
            lot={{ ...lot, watched }}
            busy={toggle.isPending}
            showDate
            onToggle={() => toggle.mutate()}
            ai={data.ai}
            market={data.market}
            album={data.album}
            condition={data.condition}
            demand={data.demand}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Este lote não está no banco (o leilão pode ter saído da janela de varredura).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

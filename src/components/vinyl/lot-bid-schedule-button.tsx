import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gavel } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseLoteNumber } from "@/lib/bid-schedule";
import {
  cancelBidSchedule,
  createBidSchedule,
  getBidSchedules,
  updateBidSchedule,
} from "@/lib/bid-schedule.functions";
import { parseAuctionRef, presencialUrlFromLot, type VinylLot } from "@/lib/vinyl-parse";
import { cn } from "@/lib/utils";

const QUERY_KEY = ["bid-schedules"] as const;

type Props = {
  /** Nem todo card traz `idLeilao`: sai de `idLeilao`, do link do catálogo ou do `id` (`leilão-peça`). */
  lot: Pick<VinylLot, "url" | "house" | "title"> & {
    idLeilao?: string;
    id?: string;
    lote?: string;
    dayKey?: string;
  };
  className?: string;
};

function lotAuctionId(lot: Props["lot"]): string {
  return lot.idLeilao || parseAuctionRef(lot.url)?.idLeilao || (lot.id ?? "").split("-")[0] || "";
}

/**
 * Martelo do lote: abre o modal para agendar UM lance neste lote (alvo). O gatilho padrão é o
 * lote anterior. Mecânica e regras: `docs/areas/ui.md` ("Agendamentos de lance").
 */
export function LotBidScheduleButton({ lot, className }: Props) {
  const [open, setOpen] = useState(false);
  const idLeilao = lotAuctionId(lot);
  const target = parseLoteNumber(lot.lote);
  const presencialUrl = idLeilao ? presencialUrlFromLot({ idLeilao, url: lot.url }) : null;
  const supported = target !== null && presencialUrl !== null;
  // Mesma chave da lista/modal: uma só consulta compartilhada por todos os martelos da tela.
  const fetchAll = useServerFn(getBidSchedules);
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchAll(),
    enabled: supported,
    staleTime: 30_000,
  });
  // Aceso (como o olho de "vigiando") quando o lote tem agendamento aguardando.
  const scheduled = Boolean(
    data?.schedules.some(
      (s) => s.idLeilao === idLeilao && s.targetLote === target && s.status === "waiting",
    ),
  );
  return (
    <>
      <button
        type="button"
        disabled={!supported}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Agendar lance neste lote"
        aria-pressed={scheduled}
        title={
          !supported
            ? "Sem pregão presencial ou número do lote: não dá para agendar"
            : scheduled
              ? "Lance agendado — clique para editar ou cancelar"
              : "Agendar um lance único neste lote"
        }
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border shadow-sm hover:border-primary disabled:opacity-40",
          scheduled
            ? "border-yellow-500 bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
            : "border-input text-muted-foreground",
          className,
        )}
      >
        <Gavel className="h-4 w-4" />
      </button>
      {open && supported ? (
        <BidScheduleDialog
          lot={lot}
          idLeilao={idLeilao}
          target={target}
          presencialUrl={presencialUrl}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function BidScheduleDialog({
  lot,
  idLeilao,
  target,
  presencialUrl,
  onClose,
}: {
  lot: Props["lot"];
  idLeilao: string;
  target: number;
  presencialUrl: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchAll = useServerFn(getBidSchedules);
  const create = useServerFn(createBidSchedule);
  const cancel = useServerFn(cancelBidSchedule);
  const update = useServerFn(updateBidSchedule);
  const [trigger, setTrigger] = useState(String(Math.max(1, target - 1)));
  const [expected, setExpected] = useState("");
  const [max, setMax] = useState("");

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => fetchAll() });
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const live = query.data?.live === true;
  const existing = (query.data?.schedules ?? []).filter(
    (s) => s.idLeilao === idLeilao && s.targetLote === target && s.status === "waiting",
  );

  // Já existe agendamento aguardando para este lote: o modal passa a EDITÁ-LO.
  const current = existing[0];
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!current || loaded.current === current.id) return;
    loaded.current = current.id;
    setTrigger(String(current.triggerLote));
    setExpected(current.expectedValue === null ? "" : String(current.expectedValue));
    setMax(String(current.maxValue));
  }, [current]);

  const save = useMutation({
    mutationFn: () => {
      const data = {
        idLeilao,
        house: lot.house,
        presencialUrl,
        dayKey: lot.dayKey ?? "",
        triggerLote: trigger,
        targetLote: String(target),
        expectedValue: expected,
        maxValue: max,
      };
      return current
        ? update({ data: { id: current.id, ...data } }).then(() => undefined)
        : create({ data }).then(() => undefined);
    },
    onSuccess: () => {
      toast.success(
        current
          ? "Agendamento atualizado."
          : live
            ? "Lance agendado."
            : "Lance agendado (modo simulação).",
      );
      void refresh();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro inesperado."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => cancel({ data: { id } }),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro inesperado."),
  });

  const submit = () => {
    if (
      live &&
      !current &&
      !window.confirm(
        `Confirmar? Quando o pregão chegar ao lote ${trigger}, o app dará UM lance de verdade no lote ${target} (até R$ ${max}).`,
      )
    ) {
      return;
    }
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar lance — lote {target}</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {lot.house} · {lot.title}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Modo: <b>{live ? "ENVIO REAL" : "SIMULAÇÃO (não envia nada ao site)"}</b>. O lance é
          sempre o próximo valor do lote, e só um.
        </p>
        {current ? (
          <div className="flex items-center justify-between rounded-md border p-2 text-xs">
            <span>Já agendado: edite abaixo ou cancele.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => remove.mutate(current.id, { onSuccess: onClose })}
            >
              Cancelar agendamento
            </Button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Quando o pregão chegar no lote
            <Input
              inputMode="numeric"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Teto (R$, obrigatório)
            <Input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            Só se o valor atual do lote for (R$, opcional)
            <Input
              inputMode="decimal"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {current ? "Salvar alterações" : "Agendar lance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Gavel, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HouseLight } from "@/components/vinyl/house-light";
import { LiveLotNow } from "@/components/vinyl/live-lot-now";
import { dayLabel } from "@/components/vinyl/grouping";
import { isEditable, type BidSchedule, type BidScheduleStatus } from "@/lib/bid-schedule";
import {
  cancelBidSchedule,
  getBidSchedules,
  runBidSchedulerNow,
  setBidScheduleLive,
  updateBidSchedule,
} from "@/lib/bid-schedule.functions";

const QUERY_KEY = ["bid-schedules"] as const;
const NO_DAY = "sem-data";

const STATUS_LABEL: Record<BidScheduleStatus, string> = {
  waiting: "Aguardando",
  firing: "Enviando",
  fired: "Disparado",
  simulated: "Simulado",
  skipped: "Não disparou",
  failed: "Falhou",
  expired: "Expirado",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<BidScheduleStatus, string> = {
  waiting: "text-amber-500",
  firing: "text-amber-500",
  fired: "text-emerald-500",
  simulated: "text-sky-500",
  skipped: "text-muted-foreground",
  failed: "text-red-500",
  expired: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const todayKey = () => {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000); // Brasília
  return d.toISOString().slice(0, 10);
};

/** "Hoje 10/11", "Amanhã 11/11" ou "ter 12/11" — mesmo rótulo das outras telas. */
function dayTitle(dayKey: string): string {
  if (dayKey === NO_DAY) return "Sem data";
  const today = todayKey();
  const diff = Math.round((Date.parse(dayKey) - Date.parse(today)) / 86_400_000);
  return dayLabel(dayKey, diff === 0 ? 0 : diff === 1 ? 1 : 2);
}

type Group = { dayKey: string; houses: { house: string; items: BidSchedule[] }[] };

/** Dia (hoje e futuro primeiro, depois os passados) → casa → agendamentos por lote alvo. */
function groupSchedules(list: BidSchedule[]): Group[] {
  const today = todayKey();
  const byDay = new Map<string, Map<string, BidSchedule[]>>();
  for (const s of list) {
    const day = s.dayKey || NO_DAY;
    const houses = byDay.get(day) ?? new Map<string, BidSchedule[]>();
    const items = houses.get(s.house) ?? [];
    items.push(s);
    houses.set(s.house, items);
    byDay.set(day, houses);
  }
  const days = [...byDay.keys()].sort((a, b) => {
    if (a === NO_DAY) return 1;
    if (b === NO_DAY) return -1;
    const fa = a >= today;
    const fb = b >= today;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? a.localeCompare(b) : b.localeCompare(a);
  });
  return days.map((dayKey) => ({
    dayKey,
    houses: [...byDay.get(dayKey)!]
      .map(([house, items]) => ({
        house,
        items: [...items].sort((x, y) => x.targetLote - y.targetLote),
      }))
      .sort((x, y) => x.house.localeCompare(y.house, "pt-BR")),
  }));
}

function AgendamentosPage() {
  const qc = useQueryClient();
  const fetchAll = useServerFn(getBidSchedules);
  const update = useServerFn(updateBidSchedule);
  const cancel = useServerFn(cancelBidSchedule);
  const setLive = useServerFn(setBidScheduleLive);
  const runNow = useServerFn(runBidSchedulerNow);
  const [editing, setEditing] = useState<BidSchedule | null>(null);
  const [form, setForm] = useState({ trigger: "", expected: "", max: "" });

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchAll(),
    refetchInterval: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro inesperado.");

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      await update({
        data: {
          id: editing.id,
          idLeilao: editing.idLeilao,
          house: editing.house,
          presencialUrl: editing.presencialUrl,
          dayKey: editing.dayKey,
          triggerLote: form.trigger,
          targetLote: String(editing.targetLote),
          expectedValue: form.expected,
          maxValue: form.max,
        },
      });
    },
    onSuccess: () => {
      toast.success("Agendamento atualizado.");
      setEditing(null);
      void refresh();
    },
    onError: fail,
  });
  const doCancel = useMutation({
    mutationFn: (id: string) => cancel({ data: { id } }),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const toggleLive = useMutation({
    mutationFn: (live: boolean) => setLive({ data: { live } }),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const run = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (r) => {
      toast.success(`Ciclo rodado (${r.checked} agendamento(s) conferido(s)).`);
      void refresh();
    },
    onError: fail,
  });

  const groups = useMemo(() => groupSchedules(query.data?.schedules ?? []), [query.data]);
  const live = query.data?.live === true;

  const openEdit = (s: BidSchedule) => {
    setEditing(s);
    setForm({
      trigger: String(s.triggerLote),
      expected: s.expectedValue === null ? "" : String(s.expectedValue),
      max: String(s.maxValue),
    });
  };

  const confirmLive = () => {
    if (live) return toggleLive.mutate(false);
    if (
      window.confirm(
        "Ligar o envio REAL? A partir de agora os agendamentos darão lances de verdade na sua conta (dinheiro real, lances irrevogáveis).",
      )
    ) {
      toggleLive.mutate(true);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Início
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Gavel className="h-5 w-5" />
          Agendamentos de lance
        </h1>
      </div>

      <div
        className={`rounded-lg border p-3 text-sm ${live ? "border-red-500/60" : "border-sky-500/60"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Modo: <b>{live ? "ENVIO REAL" : "SIMULAÇÃO (não envia nada ao site)"}</b>
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Rodar agora
            </Button>
            <Button size="sm" variant={live ? "destructive" : "outline"} onClick={confirmLive}>
              {live ? "Voltar para simulação" : "Ligar envio real"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Para agendar, use o martelo <Gavel className="inline h-3 w-3" /> no lote (ao lado do
          olho).
          {!query.data?.autoRunner
            ? " O acompanhamento automático está desligado neste servidor (preview): use “Rodar agora” para conferir manualmente."
            : ""}
        </p>
      </div>

      {query.data && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum agendamento ainda.</p>
      ) : null}

      {groups.map((g) => (
        <section key={g.dayKey} className="space-y-2">
          <h2 className="text-sm font-semibold">{dayTitle(g.dayKey)}</h2>
          {g.houses.map((h) => (
            <div key={h.house} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HouseLight house={h.house} />
                {h.house || "Casa não informada"}
              </div>
              {h.items.map((s) => (
                <div key={s.id} className="space-y-1 rounded-md border bg-muted/30 p-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${STATUS_TONE[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">Lote {s.targetLote}</span>
                  </div>
                  {s.status === "waiting" ? (
                    <div className="flex min-h-5 items-center">
                      <LiveLotNow url={s.presencialUrl} />
                    </div>
                  ) : null}
                  <div className="text-sm">
                    Ao chegar no lote <b>{s.triggerLote}</b> → 1 lance no lote <b>{s.targetLote}</b>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Próximo lance, teto {brl(s.maxValue)}
                    {s.expectedValue !== null
                      ? ` · só se o valor atual for ${brl(s.expectedValue)}`
                      : ""}
                  </div>
                  {s.message ? <div className="text-xs">{s.message}</div> : null}
                  {isEditable(s) ? (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => doCancel.mutate(s.id)}>
                        Cancelar
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}

      {editing ? (
        <Dialog open onOpenChange={(o) => (o ? undefined : setEditing(null))}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Editar agendamento — lote {editing.targetLote}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                Quando o pregão chegar no lote
                <Input
                  inputMode="numeric"
                  value={form.trigger}
                  onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Teto (R$)
                <Input
                  inputMode="decimal"
                  value={form.max}
                  onChange={(e) => setForm((f) => ({ ...f, max: e.target.value }))}
                />
              </label>
              <label className="text-xs text-muted-foreground sm:col-span-2">
                Só se o valor atual for (R$, opcional)
                <Input
                  inputMode="decimal"
                  value={form.expected}
                  onChange={(e) => setForm((f) => ({ ...f, expected: e.target.value }))}
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Fechar
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos — Garimpo de Vinil" }] }),
  component: AgendamentosPage,
});

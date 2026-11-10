import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Gavel, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isEditable, type BidSchedule, type BidScheduleStatus } from "@/lib/bid-schedule";
import {
  cancelBidSchedule,
  createBidSchedule,
  getBidSchedules,
  runBidSchedulerNow,
  setBidScheduleLive,
  updateBidSchedule,
} from "@/lib/bid-schedule.functions";

const QUERY_KEY = ["bid-schedules"] as const;

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

type Form = {
  auction: string; // `${idLeilao}`
  triggerLote: string;
  targetLote: string;
  expectedValue: string;
  maxValue: string;
};
const EMPTY: Form = {
  auction: "",
  triggerLote: "",
  targetLote: "",
  expectedValue: "",
  maxValue: "",
};

function AgendamentosPage() {
  const qc = useQueryClient();
  const fetchAll = useServerFn(getBidSchedules);
  const create = useServerFn(createBidSchedule);
  const update = useServerFn(updateBidSchedule);
  const cancel = useServerFn(cancelBidSchedule);
  const setLive = useServerFn(setBidScheduleLive);
  const runNow = useServerFn(runBidSchedulerNow);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchAll(),
    refetchInterval: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro inesperado.");

  const save = useMutation({
    mutationFn: async () => {
      const auction = query.data?.auctions.find((a) => a.idLeilao === form.auction);
      const common = {
        idLeilao: form.auction,
        house: auction?.house ?? "",
        presencialUrl: auction?.presencialUrl ?? "",
        triggerLote: form.triggerLote,
        targetLote: form.targetLote,
        expectedValue: form.expectedValue,
        maxValue: form.maxValue,
      };
      if (editing) await update({ data: { id: editing, ...common } });
      else await create({ data: common });
    },
    onSuccess: () => {
      toast.success(editing ? "Agendamento atualizado." : "Lance agendado.");
      setForm(EMPTY);
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

  const edit = (s: BidSchedule) => {
    setEditing(s.id);
    setForm({
      auction: s.idLeilao,
      triggerLote: String(s.triggerLote),
      targetLote: String(s.targetLote),
      expectedValue: s.expectedValue === null ? "" : String(s.expectedValue),
      maxValue: String(s.maxValue),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const live = query.data?.live === true;
  const auctions = query.data?.auctions ?? [];
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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

  const submit = () => {
    if (!live) return save.mutate();
    const msg = `Confirmar? Quando o pregão chegar ao lote ${form.triggerLote}, o app dará UM lance de verdade no lote ${form.targetLote} (até ${form.maxValue}).`;
    if (window.confirm(msg)) save.mutate();
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
          <Button size="sm" variant={live ? "destructive" : "outline"} onClick={confirmLive}>
            {live ? "Voltar para simulação" : "Ligar envio real"}
          </Button>
        </div>
        {!query.data?.autoRunner ? (
          <p className="mt-2 text-xs text-muted-foreground">
            O acompanhamento automático está desligado neste servidor (preview). Use “Rodar agora”
            para conferir os agendamentos manualmente.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="font-medium">{editing ? "Editar agendamento" : "Novo agendamento"}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground sm:col-span-2">
            Leilão / casa
            <select
              className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground"
              value={form.auction}
              onChange={set("auction")}
              disabled={editing !== null}
            >
              <option value="">Escolha…</option>
              {auctions.map((a) => (
                <option key={a.idLeilao} value={a.idLeilao}>
                  {a.house} — {a.dayKey} {a.time} ({a.lotCount} lotes)
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Quando o pregão chegar no lote (gatilho)
            <Input inputMode="numeric" value={form.triggerLote} onChange={set("triggerLote")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Dar 1 lance no lote (alvo)
            <Input inputMode="numeric" value={form.targetLote} onChange={set("targetLote")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Só se o valor atual do alvo for (opcional)
            <Input inputMode="decimal" value={form.expectedValue} onChange={set("expectedValue")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Teto: o próximo lance não pode passar de
            <Input inputMode="decimal" value={form.maxValue} onChange={set("maxValue")} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          O lance é sempre o próximo valor do lote (nunca outro) e só um é dado.
        </p>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={save.isPending}>
            {editing ? "Salvar" : "Agendar lance"}
          </Button>
          {editing ? (
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
              }}
            >
              Cancelar edição
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Agendamentos</h2>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play className="mr-1 h-3.5 w-3.5" />
          Rodar agora
        </Button>
      </div>
      {query.data && query.data.schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum agendamento ainda.</p>
      ) : null}
      {query.data?.schedules.map((s) => (
        <div key={s.id} className="space-y-1 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${STATUS_TONE[s.status]}`}>
              {STATUS_LABEL[s.status]}
            </span>
            <span className="text-xs text-muted-foreground">{s.house}</span>
          </div>
          <div>
            Ao chegar no lote <b>{s.triggerLote}</b> → 1 lance no lote <b>{s.targetLote}</b>
          </div>
          <div className="text-xs text-muted-foreground">
            Próximo lance, teto {brl(s.maxValue)}
            {s.expectedValue !== null ? ` · só se o valor atual for ${brl(s.expectedValue)}` : ""}
          </div>
          {s.message ? <div className="text-xs">{s.message}</div> : null}
          {isEditable(s) ? (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => edit(s)}>
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
  );
}

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos — Garimpo de Vinil" }] }),
  component: AgendamentosPage,
});

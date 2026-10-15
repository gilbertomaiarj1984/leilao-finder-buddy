import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GradeSelect } from "@/components/vinyl/grade-select";
import { saveCalibrationEntry } from "@/lib/ai-panel.functions";
import {
  calibrationHints,
  conditionStats,
  dealAtPurchase,
  dealStats,
  scoreStats,
  VERDICT_LABEL,
  VERDICTS,
  type CalibrationRow,
  type ConditionStats,
  type Verdict,
} from "@/lib/calibration";
import { queryKeys, useCalibrationQuery } from "@/lib/queries";

const pct = (a: number, n: number) => (n ? `${Math.round((a / n) * 100)}%` : "—");

function Stat({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function conditionSub(s: ConditionStats): string {
  if (!s.n) return "preencha o estado real dos discos recebidos";
  const dir = s.optimism > 0.25 ? "lê melhor" : s.optimism < -0.25 ? "lê pior" : "sem viés";
  return `${s.n} discos · ±1 grau: ${pct(s.withinOne, s.n)} · ${
    dir === "sem viés" ? dir : `o app ${dir} (${Math.abs(s.optimism).toFixed(1)} grau)`
  }`;
}

/** Uma compra recebida: o que o app achava na época × o que o disco realmente é. */
function CalibrationCard({ row }: { row: CalibrationRow }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCalibrationEntry);
  const [media, setMedia] = useState(row.real.media);
  const [sleeve, setSleeve] = useState(row.real.sleeve);
  const [score, setScore] = useState(row.realScore == null ? "" : String(row.realScore));
  const [verdict, setVerdict] = useState<Verdict | "">(row.verdict);
  const [note, setNote] = useState(row.note);
  const dirty =
    media !== row.real.media ||
    sleeve !== row.real.sleeve ||
    score !== (row.realScore == null ? "" : String(row.realScore)) ||
    verdict !== row.verdict ||
    note !== row.note;
  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          lotId: row.lotId,
          realMedia: media,
          realSleeve: sleeve,
          realScore: score.trim() === "" ? null : Number(score),
          verdict,
          note,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.calibration });
      toast.success("Calibração salva");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  const s = row.snapshot;
  const deal = dealAtPurchase(s);
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex gap-3">
        {row.image ? (
          <img
            src={row.image}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-cover"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={row.title}>
            {row.label}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.house} · pago {row.wonPrice || "—"}
            {row.receivedAt ? ` · recebido ${row.receivedAt.split("-").reverse().join("/")}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span title="O que a IA dizia quando você comprou">
              IA na época:{" "}
              <b>
                {s?.ai?.score != null ? `${s.ai.score}/100` : "—"}
                {s?.ai?.rarity ? ` · ${s.ai.rarity}` : ""}
                {deal ? ` · ${deal}` : ""}
              </b>
            </span>
            <span title="Estado que o app leu da descrição (com as regras de hoje)">
              Leitura do texto:{" "}
              <b>
                {row.read.media || "—"} / {row.read.sleeve || "—"}
              </b>
            </span>
            {!s ? (
              <span className="text-amber-600 dark:text-amber-400">
                sem retrato da época (o lote já saíra da janela)
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_6rem]">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Disco real
          <GradeSelect value={media} onChange={setMedia} ariaLabel="Estado real do disco" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Capa real
          <GradeSelect value={sleeve} onChange={setSleeve} ariaLabel="Estado real da capa" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Minha nota
          <Input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="0–100"
            aria-label="Nota que eu daria (0 a 100)"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={verdict === v}
            onClick={() => setVerdict(verdict === v ? "" : v)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              verdict === v ? "border-primary bg-primary text-primary-foreground" : "border-border"
            }`}
          >
            {VERDICT_LABEL[v]}
          </button>
        ))}
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Observação (opcional)"
          aria-label="Observação"
          className="h-8 min-w-40 flex-1 text-xs"
        />
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}

export function CalibrationTab() {
  const query = useCalibrationQuery();
  const [onlyPending, setOnlyPending] = useState(false);
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const media = useMemo(() => conditionStats(rows, "media"), [rows]);
  const sleeve = useMemo(() => conditionStats(rows, "sleeve"), [rows]);
  const score = useMemo(() => scoreStats(rows), [rows]);
  const deal = useMemo(() => dealStats(rows), [rows]);
  const hints = useMemo(() => calibrationHints(media), [media]);
  const answered = (r: CalibrationRow) =>
    Boolean(r.real.media || r.real.sleeve || r.realScore != null || r.verdict);
  const shown = onlyPending ? rows.filter((r) => !answered(r)) : rows;

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar as compras.</p>;
  if (!rows.length) {
    return (
      <section className="max-w-2xl rounded-md border border-border bg-card p-4 text-sm">
        <h2 className="mb-1 font-semibold">Nenhuma compra recebida ainda</h2>
        <p className="text-muted-foreground">
          Quando um pregão em <b>Compras</b> for marcado como «Recebido», os discos dele aparecem
          aqui. Diga como cada disco realmente chegou (estado, nota, se valeu a pena) e o painel
          mostra onde a IA e o leitor de estado erram.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        Compras <b>recebidas</b>: para cada uma, o que o app achava na época (nota da IA, veredicto,
        estado lido) ao lado de como o disco <b>realmente</b> é. Informe o estado real, a nota que
        você daria e se valeu a pena — as contas abaixo mostram o viés do app e sugerem ajustes na
        aba «Correlação de condições».
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          title="Estado do disco"
          value={media.n ? `${pct(media.exact, media.n)} exato` : "—"}
          sub={conditionSub(media)}
        />
        <Stat
          title="Estado da capa"
          value={sleeve.n ? `${pct(sleeve.exact, sleeve.n)} exato` : "—"}
          sub={conditionSub(sleeve)}
        />
        <Stat
          title="Nota da IA × minha"
          value={score.n ? `erro médio ${score.mae}` : "—"}
          sub={
            score.n
              ? `${score.n} discos · a IA é ${score.bias > 0 ? "mais generosa" : score.bias < 0 ? "mais dura" : "igual"}${score.bias ? ` (${score.bias > 0 ? "+" : ""}${score.bias})` : ""}`
              : "precisa de retrato da época + sua nota"
          }
        />
        <Stat
          title="Veredicto × valeu a pena"
          value={deal.n ? `${pct(deal.hits, deal.n)} bateu` : "—"}
          sub={deal.n ? `${deal.n} discos` : "barato/justo/caro × «valeu a pena?»"}
        />
      </div>

      {hints.length ? (
        <section className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
          <h2 className="mb-1 font-semibold">Sugestões</h2>
          <ul className="list-inside list-disc space-y-0.5">
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {media.matrix.length ? (
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Disco: lido do texto → como chegou
          </h2>
          <div className="space-y-1 text-sm">
            {media.matrix.map((line) => (
              <div key={line.read} className="flex flex-wrap items-center gap-2">
                <b className="w-10 shrink-0">{line.read}</b>
                <span className="text-muted-foreground">→</span>
                {line.real.map((r) => (
                  <span
                    key={r.grade}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      r.grade === line.read ? "border-green-500/60" : "border-border"
                    }`}
                  >
                    {r.grade} · {r.n}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {rows.length} compra(s) recebida(s)
          <span className="ml-2 font-normal text-muted-foreground">
            {rows.filter(answered).length} com opinião
          </span>
        </h2>
        <button
          type="button"
          aria-pressed={onlyPending}
          onClick={() => setOnlyPending((v) => !v)}
          className={`rounded-full border px-2.5 py-1 text-xs ${
            onlyPending ? "border-primary bg-primary text-primary-foreground" : "border-border"
          }`}
        >
          Só as que faltam opinar
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((r) => (
          <CalibrationCard key={r.lotId} row={r} />
        ))}
      </div>
    </div>
  );
}

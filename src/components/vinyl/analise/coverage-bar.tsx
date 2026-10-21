import { Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Cobertura da IA na janela do app: quantos lotes já têm nota e o que fazer com os que faltam
 * ("Analisar pendentes", sob demanda) e com as notas dadas a um preço que já subiu ("Reavaliar").
 */
export function CoverageBar({
  rated,
  total,
  pendingInScope,
  scopeLabel,
  analyzing,
  onAnalyze,
  staleCount,
  repricing,
  onReprice,
}: {
  rated: number;
  total: number;
  /** Pendentes no escopo atual (dia escolhido ou toda a janela de hoje em diante). */
  pendingInScope: number;
  scopeLabel: string;
  analyzing: boolean;
  onAnalyze: () => void;
  staleCount: number;
  repricing: boolean;
  onReprice: () => void;
}) {
  const pct = total ? Math.round((rated / total) * 100) : 0;
  return (
    <section
      aria-label="Cobertura da IA"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card/40 p-3"
    >
      <div className="min-w-[220px] flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">Cobertura da IA</span>
          <span className="tabular-nums text-muted-foreground">
            {pct}% · {rated} de {total} lote(s) com nota
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pendingInScope > 0 || analyzing ? (
          <Button
            size="sm"
            onClick={onAnalyze}
            disabled={analyzing}
            title={`Avalia agora, com o provedor de IA escolhido no topo, os lotes sem nota (${scopeLabel})`}
          >
            {analyzing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            {analyzing ? "Analisando…" : `Analisar pendentes (${pendingInScope})`}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Nada pendente {scopeLabel}.</span>
        )}
        {staleCount > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onReprice}
            disabled={repricing}
            title="Notas dadas quando o lote custava bem menos (subiu ≥ 20% e ≥ R$ 10): refaz com o preço de hoje"
          >
            {repricing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Reavaliar defasadas ({staleCount})
          </Button>
        ) : null}
      </div>
    </section>
  );
}

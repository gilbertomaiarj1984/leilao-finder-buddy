import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearDeepProgress, useDeepProgress } from "@/lib/deep-progress";

/**
 * Andamento da análise profunda dos vigiados ("Analisar vigiados") no rodapé: barra com
 * `feitos/total` enquanto roda; ao terminar fica o resumo (e o botão "Ver erros" se algo falhou)
 * até o usuário fechar. No celular vira uma pílula acima da barra de navegação.
 */
export function DeepProgressBar({ variant }: { variant: "footer" | "mobile" }) {
  const p = useDeepProgress();
  const [open, setOpen] = useState(false);
  if (p.status === "idle") return null;
  const running = p.status === "running";
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const hasErrors = p.errors.length > 0 || p.failed > 0;
  const label = running
    ? `Analisando vigiados ${p.dayLabel}: ${p.done}/${p.total}`
    : `Análise de ${p.dayLabel} concluída: ${p.evaluated} analisado(s)${
        p.skipped ? ` · ${p.skipped} em dia` : ""
      }`;
  const body = (
    <>
      {running ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : hasErrors ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      )}
      <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
      {running ? (
        <span
          className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="block h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
      {p.failed > 0 ? (
        <span className="shrink-0 text-amber-600 dark:text-amber-400">{p.failed} falha(s)</span>
      ) : null}
      {hasErrors ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded border border-amber-500/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
        >
          Ver erros
        </button>
      ) : null}
      {!running ? (
        <button
          type="button"
          onClick={clearDeepProgress}
          aria-label="Fechar o andamento da análise"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </>
  );
  return (
    <>
      {variant === "footer" ? (
        <div className="flex min-w-0 items-center gap-2" aria-live="polite">
          {body}
        </div>
      ) : (
        <div
          className="fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-40 flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow backdrop-blur sm:hidden"
          aria-live="polite"
        >
          {body}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Erros da análise de {p.dayLabel}</DialogTitle>
            <DialogDescription>
              {p.failed} lote(s) sem análise. Rode "Analisar vigiados" de novo para tentar outra vez
              só os que faltam.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {p.errors.map((e, i) => (
              <li key={i} className="rounded-md border border-border p-2">
                <p className="font-medium">
                  {e.title}
                  {e.house ? (
                    <span className="font-normal text-muted-foreground"> · {e.house}</span>
                  ) : null}
                </p>
                <p className="break-words text-xs text-muted-foreground">{e.message}</p>
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

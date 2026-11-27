import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Painel do botão "Analisar vigiados": análise PROFUNDA (descritivo do álbum, estado lido do texto
 * completo, sinergia com a coleção e análise de preço) dos vigiados e lances do DIA selecionado.
 * Nunca roda em todos os dias de uma vez — o botão só abre este painel com um dia escolhido.
 */
export function WatchedDeepDialog({
  open,
  onOpenChange,
  dayLabel,
  total,
  pending,
  hasImages,
  running,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayLabel: string;
  /** Vigiados + lances do dia (sem os já vendidos). */
  total: number;
  /** Os que ainda não têm análise profunda ou cujo preço subiu desde a análise. */
  pending: number;
  hasImages: boolean;
  running: boolean;
  onRun: (opts: { mode: "image" | "text"; redo: boolean }) => void;
}) {
  const [mode, setMode] = useState<"image" | "text">("image");
  const [redo, setRedo] = useState(false);
  const count = redo ? total : pending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Analisar vigiados de {dayLabel}</DialogTitle>
          <DialogDescription>
            Análise profunda só dos vigiados e lances deste dia: nota (raridade, oportunidade,
            sinergia com a coleção), descritivo do álbum, estado lido do texto completo do lote e
            comparação do preço com o Analytics.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            <strong>{total}</strong> lote(s) no dia; <strong>{pending}</strong> sem análise profunda
            (ou com preço que subiu).
          </p>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">Base da análise</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="deep-mode"
                checked={mode === "image"}
                onChange={() => setMode("image")}
                disabled={!hasImages}
                className="mt-1"
              />
              <span>
                Texto do lote e capa
                <span className="block text-xs text-muted-foreground">
                  O texto manda no estado; a capa ajuda a identificar o disco.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="deep-mode"
                checked={mode === "text"}
                onChange={() => setMode("text")}
                className="mt-1"
              />
              <span>
                Só o texto do lote
                <span className="block text-xs text-muted-foreground">Sem enviar imagens.</span>
              </span>
            </label>
          </fieldset>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={redo}
              onChange={(e) => setRedo(e.target.checked)}
              className="mt-1"
            />
            <span>
              Refazer também os que já têm análise profunda
              <span className="block text-xs text-muted-foreground">
                Padrão: só os sem análise ou com preço que subiu.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Preço avaliado: valor atual quando o seu lance está ganhando; próximo lance nos demais
            (só vigiado ou lance superado). Vão {count} chamada(s) de IA.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={running || count === 0}
            onClick={() => {
              onRun({ mode: hasImages ? mode : "text", redo });
              onOpenChange(false);
            }}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            Analisar {count} lote(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

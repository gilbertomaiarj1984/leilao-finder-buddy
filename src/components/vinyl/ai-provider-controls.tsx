/**
 * Controles de UI para escolher o PROVEDOR de IA (Claude vs Gemini):
 * - `AiProviderSelect`: seletor do provedor PADRÃO (fica no header, ao lado do modo da IA).
 * - `AiProviderDialog`: diálogo que pergunta qual provedor usar ANTES de um processamento
 *   (análise/identificação). Controlado — o estado/promessa vive no hook
 *   `useAiProviderPicker` (`src/lib/use-ai-provider-picker.ts`).
 *
 * Só componentes são exportados aqui (o hook fica em arquivo `.ts` à parte) para não
 * disparar o aviso do react-refresh de "export que não é componente".
 */
import { Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AI_PROVIDERS, AI_PROVIDER_LABELS, type AiProvider } from "@/lib/ai-provider";

/** Seletor do provedor de IA padrão (persistido em `app_state` pelo chamador). */
export function AiProviderSelect({
  value,
  onChange,
  disabled,
}: {
  value: AiProvider;
  onChange: (provider: AiProvider) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      title="Provedor de IA padrão (Claude ou Gemini). Cada análise/identificação pergunta qual usar; troca automaticamente para o outro se um ficar sem créditos."
    >
      <Bot className="h-4 w-4 shrink-0 text-primary" />
      <Select value={value} onValueChange={(v) => onChange(v as AiProvider)} disabled={disabled}>
        <SelectTrigger className="h-8 w-[168px] text-xs" aria-label="Provedor de IA padrão">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AI_PROVIDERS.map((p) => (
            <SelectItem key={p} value={p}>
              {AI_PROVIDER_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Diálogo "qual IA usar?" — pré-seleciona o `defaultProvider`. Controlado: `onPick` recebe
 * o provedor escolhido; `onCancel` (fechar/Esc/Cancelar) cancela a ação.
 */
export function AiProviderDialog({
  open,
  defaultProvider,
  onPick,
  onCancel,
  title = "Analisar com qual IA?",
  description = "Escolha o provedor para este processamento. Se ele ficar sem créditos, o outro assume automaticamente.",
}: {
  open: boolean;
  defaultProvider: AiProvider;
  onPick: (provider: AiProvider) => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {AI_PROVIDERS.map((p) => (
            <Button
              key={p}
              variant={p === defaultProvider ? "default" : "outline"}
              className="justify-start"
              onClick={() => onPick(p)}
            >
              <Bot className="mr-2 h-4 w-4" />
              {AI_PROVIDER_LABELS[p]}
              {p === defaultProvider ? " (padrão)" : ""}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

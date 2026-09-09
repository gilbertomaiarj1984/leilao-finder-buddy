/**
 * Controle de UI para escolher o PROVEDOR de IA (Claude vs Gemini):
 * - `AiProviderSelect`: seletor do provedor PADRÃO (fica no header, ao lado do modo da IA).
 *   É a **única** forma de escolher a IA — todo recurso do site (síncrono e assíncrono) usa
 *   esse provedor. Não há mais o diálogo "qual IA usar?" antes de cada ação.
 */
import { Bot } from "lucide-react";

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
      title="Provedor de IA usado por todo o site (Claude ou Gemini), síncrono ou em background. Troca automaticamente para o outro se um ficar sem créditos."
    >
      <Bot className="h-4 w-4 shrink-0 text-primary" />
      <Select value={value} onValueChange={(v) => onChange(v as AiProvider)} disabled={disabled}>
        <SelectTrigger className="h-8 w-[168px] text-xs" aria-label="Provedor de IA">
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

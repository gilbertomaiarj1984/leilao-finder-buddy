/**
 * Controle de UI para escolher o PROVEDOR de IA (Claude vs Gemini) e, dentro do Gemini,
 * QUAL MODELO usar:
 * - `AiProviderSelect`: seletor do provedor PADRÃO (fica no header, ao lado do modo da IA).
 *   É a **única** forma de escolher a IA — todo recurso do site (síncrono e assíncrono) usa
 *   esse provedor. Não há mais o diálogo "qual IA usar?" antes de cada ação.
 * - `GeminiModelSelect`: seletor da variante do Gemini (Flash-Lite/Flash/Pro), do MAIS
 *   BARATO pro MAIS CARO. Fica sempre visível (mesmo com Claude escolhido) porque o
 *   failover por quota pode acabar caindo no Gemini mesmo assim.
 */
import { Bot, Cpu } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  GEMINI_MODELS,
  GEMINI_MODEL_LABELS,
  type AiProvider,
  type GeminiModel,
} from "@/lib/ai-provider";

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

/** Seletor do modelo do Gemini (persistido em `app_state` pelo chamador), do mais barato ao mais caro. */
export function GeminiModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: GeminiModel;
  onChange: (model: GeminiModel) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      title="Modelo do Gemini (Flash-Lite/Flash/Pro), do mais barato pro mais caro. Vale mesmo com Claude escolhido: o failover por falta de créditos pode cair no Gemini."
    >
      <Cpu className="h-4 w-4 shrink-0 text-primary" />
      <Select value={value} onValueChange={(v) => onChange(v as GeminiModel)} disabled={disabled}>
        <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Modelo do Gemini">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GEMINI_MODELS.map((m) => (
            <SelectItem key={m} value={m}>
              {GEMINI_MODEL_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

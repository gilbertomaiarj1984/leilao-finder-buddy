/**
 * Caixa ÚNICA de IA: provedor + modelo juntos (Claude e Gemini, do mais barato ao mais caro,
 * com o preço de cada modelo — US$ por 1M de tokens entrada/saída). Escolher uma opção grava o
 * provedor padrão E o modelo daquele provedor em `app_state`; todo recurso do site (síncrono e
 * assíncrono) usa essa escolha. O modelo do OUTRO provedor continua valendo no failover por
 * quota. O componente cuida das queries/gravação sozinho (mesmas chaves de `queries.ts`), então
 * as telas só renderizam `<AiModelSelect />`.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cpu } from "lucide-react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setAiProvider, setAnthropicModel, setGeminiModel } from "@/lib/ai.functions";
import {
  AI_MODEL_OPTIONS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_SHORT,
  AI_PROVIDERS,
  isAnthropicModel,
  isGeminiModel,
  type AiProvider,
} from "@/lib/ai-provider";
import {
  queryKeys,
  useAiProviderQuery,
  useAnthropicModelQuery,
  useGeminiModelQuery,
} from "@/lib/queries";

/** Chave do item do Select: `provedor|modelo`. */
const keyOf = (provider: AiProvider, model: string) => `${provider}|${model}`;

export function AiModelSelect({ disabled, className }: { disabled?: boolean; className?: string }) {
  const queryClient = useQueryClient();
  const runSetProvider = useServerFn(setAiProvider);
  const runSetGemini = useServerFn(setGeminiModel);
  const runSetAnthropic = useServerFn(setAnthropicModel);
  const providerQuery = useAiProviderQuery();
  const geminiQuery = useGeminiModelQuery();
  const anthropicQuery = useAnthropicModelQuery();

  const provider: AiProvider = providerQuery.data ?? "anthropic";
  const model =
    provider === "gemini"
      ? (geminiQuery.data ?? "gemini-3.1-flash-lite")
      : (anthropicQuery.data ?? "claude-haiku-4-5");

  const onChange = (value: string) => {
    const [p, m] = value.split("|") as [AiProvider, string];
    const prevProvider = providerQuery.data;
    const prevModel = p === "gemini" ? geminiQuery.data : anthropicQuery.data;
    const modelKey = p === "gemini" ? queryKeys.geminiModel : queryKeys.anthropicModel;
    queryClient.setQueryData(queryKeys.aiProvider, p); // otimista
    queryClient.setQueryData(modelKey, m);
    const saveModel =
      p === "gemini" && isGeminiModel(m)
        ? runSetGemini({ data: { model: m } })
        : isAnthropicModel(m)
          ? runSetAnthropic({ data: { model: m } })
          : Promise.reject(new Error("Modelo de IA inválido"));
    void Promise.all([runSetProvider({ data: { provider: p } }), saveModel])
      .then(() => toast.success(`IA: ${AI_PROVIDER_SHORT[p]} · ${m}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.aiProvider, prevProvider);
        queryClient.setQueryData(modelKey, prevModel);
        toast.error((error as Error)?.message || "Não foi possível salvar a IA");
      });
  };

  return (
    <div
      className={`flex items-center gap-1.5 ${className ?? ""}`}
      title="IA e modelo usados por todo o site (síncrono e em background), com preço em US$ por 1M de tokens (entrada/saída). Troca automaticamente para o outro provedor se um ficar sem créditos."
    >
      <Cpu className="h-4 w-4 shrink-0 text-primary" />
      <Select value={keyOf(provider, model)} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-8 w-[230px] text-xs" aria-label="IA e modelo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AI_PROVIDERS.map((p) => (
            <SelectGroup key={p}>
              <SelectLabel>{AI_PROVIDER_LABELS[p]}</SelectLabel>
              {AI_MODEL_OPTIONS.filter((o) => o.provider === p).map((o) => (
                <SelectItem key={keyOf(o.provider, o.model)} value={keyOf(o.provider, o.model)}>
                  {AI_PROVIDER_SHORT[o.provider]} {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

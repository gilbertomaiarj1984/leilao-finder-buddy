/**
 * Metadados de provedores de IA — CLIENT-SAFE (sem chaves, sem SDK, sem rede). Fica
 * separado de `ai-provider.server.ts` para o cliente (Selects/diálogos) poder importar
 * a lista e os rótulos sem puxar o código de servidor.
 *
 * ⚠️ Lição do v0.24.x: um `*.server.ts` NÃO deve importar de módulo client-safe (quebra o
 * code-splitting do cliente → 404 de chunk). Por isso a `AiProvider` é (re)declarada também
 * no lado server — mantenha as duas listas em sincronia (são triviais e raramente mudam).
 */

/** Provedores suportados. Anthropic (Claude) é o histórico; Gemini (Google) foi adicionado. */
export type AiProvider = "anthropic" | "gemini";

export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "gemini"] as const;

/** Rótulo curto para a UI (Select/diálogo). */
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
};

/** Rótulo bem curto (chip/badge). */
export const AI_PROVIDER_SHORT: Record<AiProvider, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
};

/** true quando o valor é um provedor conhecido (validação de entrada client/server). */
export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Modelos do Gemini selecionáveis na UI, do MAIS BARATO pro MAIS CARO (v0.121.0: revisão).
 * Só entram ids que a API aceita de verdade — `gemini-flash-lite-latest` e o `3.5-flash-lite`
 * antigo (pré-lançamento) voltaram 400 em produção no v0.69.2. `gemini-3.1-flash-lite` é o
 * mais barato SEM prazo de desligamento e fica como padrão. Saíram da lista: `gemini-2.5-flash-lite`
 * (geração 2.5 desliga em 16/out/2026 — segue só como downgrade interno de quota, ver
 * `GEMINI_FREE_FALLBACK_MODEL` em `ai-provider.server.ts`) e o alias `gemini-flash-latest`
 * (o mais caro, ~$0,75/$3,75). `gemini-3.5-flash-lite` (lançado em jul/2026, ~$0,30/$2,50) foi
 * adicionado a partir de fontes públicas — se a API devolver 400, volte pro 3.1 na caixa de IA.
 */
export type GeminiModel = "gemini-3.1-flash-lite" | "gemini-3.5-flash-lite";

const GEMINI_MODELS: readonly GeminiModel[] = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
] as const;

/** Preço aproximado (US$ por 1M de tokens, entrada/saída) mostrado ao lado de cada modelo. */
const GEMINI_MODEL_LABELS: Record<GeminiModel, string> = {
  "gemini-3.1-flash-lite": "Flash-Lite 3.1 · $0,25/$1,50",
  "gemini-3.5-flash-lite": "Flash-Lite 3.5 · $0,30/$2,50",
};

/**
 * Modelos do Claude selecionáveis, do MAIS BARATO pro mais caro — só o Haiku 5.5, por custo (o 4.5 custa 10× mais e foi removido). O Haiku 5.5 cobra $0,10/$0,50 até 100K tokens de prompt
 * (acima disso $0,50/$2,50); rodamos com o raciocínio desligado pra não gastar saída à toa.
 */
export type AnthropicModel = "claude-haiku-5-5";

const ANTHROPIC_MODELS: readonly AnthropicModel[] = ["claude-haiku-5-5"] as const;

const ANTHROPIC_MODEL_LABELS: Record<AnthropicModel, string> = {
  "claude-haiku-5-5": "Haiku 5.5 · $0,10/$0,50",
};

/** true quando o valor é um modelo do Claude conhecido (validação de entrada client/server). */
export function isAnthropicModel(value: unknown): value is AnthropicModel {
  return typeof value === "string" && (ANTHROPIC_MODELS as readonly string[]).includes(value);
}

/** Opção da caixa única de IA: provedor + modelo + rótulo com preço. */
type AiModelOption = { provider: AiProvider; model: string; label: string };

/** Todas as opções, agrupáveis por provedor, cada uma já com o preço no rótulo. */
export const AI_MODEL_OPTIONS: readonly AiModelOption[] = [
  ...ANTHROPIC_MODELS.map((model) => ({
    provider: "anthropic" as const,
    model,
    label: ANTHROPIC_MODEL_LABELS[model],
  })),
  ...GEMINI_MODELS.map((model) => ({
    provider: "gemini" as const,
    model,
    label: GEMINI_MODEL_LABELS[model],
  })),
];

/** true quando o valor é um modelo do Gemini conhecido (validação de entrada client/server). */
export function isGeminiModel(value: unknown): value is GeminiModel {
  return typeof value === "string" && (GEMINI_MODELS as readonly string[]).includes(value);
}

/**
 * Monta uma frase curta com o motivo de cada provedor pulado/que falhou até a IA responder —
 * ex.: `"Claude: sem chave de API configurada · Gemini: sem créditos/quota"`. Devolve `""`
 * quando não houve nenhuma tentativa falha (uso direto, sem failover). Usada pela UI (toasts)
 * em vez do genérico "trocou de provedor", pra deixar claro POR QUE pulou de um pro outro.
 */
export function formatFailoverTrail(attemptErrors: Partial<Record<AiProvider, string>>): string {
  return AI_PROVIDERS.filter((p) => attemptErrors[p])
    .map((p) => `${AI_PROVIDER_SHORT[p]}: ${attemptErrors[p]}`)
    .join(" · ");
}

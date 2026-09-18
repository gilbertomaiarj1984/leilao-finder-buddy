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

/** Provedor padrão de fábrica (usado quando nada foi configurado em `app_state`/env). */
export const DEFAULT_AI_PROVIDER: AiProvider = "anthropic";

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
 * Modelos do Gemini selecionáveis na UI, do MAIS BARATO pro MAIS CARO. ⚠️ v0.69.2 tentou uma
 * lista de 6 ids baseada em busca na web — testado em produção pelo usuário no mesmo dia:
 * `gemini-flash-lite-latest` e `gemini-3.5-flash-lite` voltam **400 INVALID_ARGUMENT** (não
 * existem de verdade pra API); `gemini-3.1-flash-lite` **funciona** (confirmado rodando).
 * `gemini-3.7-flash`/`gemini-3.6-flash`/`gemini-3.1-pro` nunca foram testados — tirados da
 * lista até alguém confirmar. Lista final (v0.69.3), só ids testados de verdade:
 * `gemini-2.5-flash-lite` (fallback de quota desde o v0.69.0), `gemini-3.1-flash-lite`
 * (confirmado em produção nesta sessão) e `gemini-flash-latest` (padrão histórico desde o
 * v0.27.0). NÃO adicione um id novo aqui sem confirmar contra a API de verdade primeiro —
 * nome "provável" achado em busca na web já errou duas vezes na mesma lista.
 * `gemini-2.5-flash-lite` tem desligamento anunciado pra 16/out/2026 (geração 2.5 inteira).
 */
export type GeminiModel = "gemini-2.5-flash-lite" | "gemini-3.1-flash-lite" | "gemini-flash-latest";

export const GEMINI_MODELS: readonly GeminiModel[] = [
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
] as const;

/**
 * Modelo do Gemini padrão de fábrica: o mais barato confirmado SEM prazo de desligamento
 * anunciado (`gemini-2.5-flash-lite` é ainda mais barato, mas desliga em 16/out/2026).
 */
export const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-3.1-flash-lite";

/** Rótulo curto pra UI, com o preço aproximado (US$ por 1M de tokens, entrada/saída). */
export const GEMINI_MODEL_LABELS: Record<GeminiModel, string> = {
  "gemini-2.5-flash-lite": "Flash-Lite 2.5 · $0,10/$0,40 (mais barato, desliga out/2026)",
  "gemini-3.1-flash-lite": "Flash-Lite 3.1 · $0,25/$1,50",
  "gemini-flash-latest": "Flash (alias, sem prazo) · ~$0,75/$3,75 (mais caro)",
};

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

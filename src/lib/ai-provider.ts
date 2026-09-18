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

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
 * Modelos do Gemini selecionáveis na UI, do MAIS BARATO pro MAIS CARO (preço por 1M de
 * tokens de entrada/saída, checado em set/2026 — a Google muda preço/linha com frequência;
 * conferir https://ai.google.dev/gemini-api/docs/pricing antes de mexer nesta lista).
 * NÃO inclui a geração 2.5 (`gemini-2.5-flash`/`gemini-2.5-flash-lite`) — mesmo sendo a mais
 * barata de todas (Flash-Lite ~US$0,10/US$0,40), a Google anunciou o desligamento de TODA a
 * geração 2.5 pra 16/out/2026, então não faz sentido oferecer como opção nova. O Flash-Lite
 * 2.5 continua existindo só como fallback interno de quota em `ai-provider.server.ts`.
 *
 * `gemini-flash-lite-latest` é um ALIAS (a Google reaponta pra versão Flash-Lite vigente —
 * hoje o 3.1, "seu modelo mais custo-efetivo" segundo o blog oficial) em vez de um modelo
 * fixo: sobrevive a descontinuações (nunca vira 404 quando a versão por trás muda ou é
 * aposentada, ao contrário de um id fixo tipo `gemini-3.1-flash-lite`) — por isso é o
 * padrão de fábrica. As versões fixas ficam como opção pra quem quiser TRAVAR um preço
 * específico (o alias pode, no futuro, passar a apontar pra algo mais caro).
 */
export type GeminiModel =
  | "gemini-flash-lite-latest"
  | "gemini-3.1-flash-lite"
  | "gemini-3.5-flash-lite"
  | "gemini-3.7-flash"
  | "gemini-3.6-flash"
  | "gemini-3.1-pro";

export const GEMINI_MODELS: readonly GeminiModel[] = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.1-pro",
] as const;

/**
 * Modelo do Gemini padrão de fábrica: o alias do Flash-Lite (mais barato E imune a
 * descontinuação — ver comentário do tipo acima).
 */
export const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-flash-lite-latest";

/** Rótulo curto pra UI, com o preço aproximado (US$ por 1M de tokens, entrada/saída). */
export const GEMINI_MODEL_LABELS: Record<GeminiModel, string> = {
  "gemini-flash-lite-latest": "Flash-Lite (alias, sempre o + recente) · mais barato",
  "gemini-3.1-flash-lite": "Flash-Lite 3.1 (travado) · $0,25/$1,50",
  "gemini-3.5-flash-lite": "Flash-Lite 3.5 (travado) · $0,30/$2,50",
  "gemini-3.7-flash": "Flash 3.7 (travado) · $0,75/$3,75",
  "gemini-3.6-flash": "Flash 3.6 (travado) · $1,50/$7,50",
  "gemini-3.1-pro": "Pro 3.1 (travado) · $2,00/$12,00 (mais caro)",
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

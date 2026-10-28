// Falha de TRANSPORTE numa server function (a resposta nem chegou como o app a montou): no build
// de produção o cliente do TanStack Start lança um "Invariant failed" sem detalhe quando a resposta
// vem sem `content-type` (5xx vazio do proxy — Caddy fora/reiniciando, timeout — ou conexão
// cortada). Não diz nada do que o servidor fez; a ação pode até ter sido gravada. Puro/client-safe.
const TRANSIENT =
  /^invariant failed|failed to fetch|fetch failed|load failed|network ?error|network request failed/i;

export function isTransientTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return TRANSIENT.test(message.trim());
}

/** Texto do toast: erro de transporte vira mensagem útil; qualquer outro mantém a mensagem do servidor. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isTransientTransportError(error)) {
    return "O servidor não respondeu direito (conexão instável) — tente de novo em instantes.";
  }
  return (error as Error | undefined)?.message || fallback;
}

/**
 * `retry`/`retryDelay` do `useMutation` para ações IDEMPOTENTES (editar, remover, vincular): repete
 * até 2 vezes só em erro de transporte; erro do servidor (validação, banco) nunca é repetido.
 */
export const retryTransient = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 && isTransientTransportError(error);

export const transientRetryDelay = (attempt: number): number => 600 * 2 ** attempt;

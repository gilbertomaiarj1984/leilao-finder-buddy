import { createServerFn } from "@tanstack/react-start";

/**
 * Só checa se existe uma sessão válida (qualquer conta Google) — usado pelo gate
 * em `_authenticated/route.tsx`. A checagem fina de "é o e-mail autorizado?" fica
 * em `getAccessStatus` (leiloesbr.functions.ts), atrás de `requireSupabaseAuth`.
 * Sem middleware de auth aqui de propósito: precisa responder `{ email: null }`
 * em vez de lançar quando não há sessão.
 */
export const getSessionEmail = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { readSessionEmail } = await import("./auth.server");
  const request = getRequest();
  const email = request ? await readSessionEmail(request) : null;
  return { email };
});

// Apesar do path, não usa mais Supabase Auth (Fase 2 da migração para VPS —
// docs/economia-fase-2-vps-unico.md): valida o cookie de sessão assinado
// (src/lib/auth.server.ts) em vez de um Bearer JWT do Supabase. Nome do
// export e caminho do arquivo mantidos de propósito — os 60 call sites de
// `.middleware([requireSupabaseAuth])` não precisam mudar uma linha.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { readSessionEmail } from "@/lib/auth.server";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const email = await readSessionEmail(request);
    if (!email) {
      throw new Error("Unauthorized: No session");
    }

    return next({
      context: {
        claims: { email },
      },
    });
  },
);

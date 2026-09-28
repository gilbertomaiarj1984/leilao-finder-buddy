// Middleware das server functions: valida o cookie de sessão assinado (src/lib/auth.server.ts)
// e expõe `context.claims.email`. O gate de e-mail permitido fica em `access.server.ts`.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { readSessionEmail } from "@/lib/auth.server";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
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
});

import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Health check pro Caddy (reverse_proxy health_uri) — confirma DATABASE_URL/CRON_TOKEN
      // presentes e o Postgres respondendo antes de qualquer outra rota. Barato, sem segredo.
      const { handleHealth } = await import("./lib/health.server");
      const healthResponse = await handleHealth(request);
      if (healthResponse) return healthResponse;

      // Proxy autenticado do pregão ao vivo (abre já logado dentro do app), fora do
      // fluxo de server functions. Retorna cedo quando o caminho for /api/live/*.
      const { handleLiveProxy } = await import("./lib/leiloesbr-live.server");
      const liveResponse = await handleLiveProxy(request);
      if (liveResponse) return liveResponse;

      // Endpoint de atualização periódica (agendador externo, token-gated), fora
      // do fluxo de server functions. Retorna cedo quando o caminho for /api/cron.
      const { handleCron } = await import("./lib/cron.server");
      const cronResponse = await handleCron(request);
      if (cronResponse) return cronResponse;

      // Login/logout via Google OAuth direto (Fase 2 da migração para VPS),
      // fora do fluxo de server functions. Retorna cedo para /api/auth/*.
      const { handleGoogleAuth } = await import("./lib/auth.server");
      const authResponse = await handleGoogleAuth(request);
      if (authResponse) return authResponse;

      // Fotos da Coleção servidas do disco (Fase 3 da migração para VPS) — até
      // a Fase 4 (Docker/Caddy), o Node serve /collection/* direto.
      const { handleCollectionAssets } = await import("./lib/collection-storage.server");
      const collectionResponse = await handleCollectionAssets(request);
      if (collectionResponse) return collectionResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

/**
 * Endpoint de atualização periódica (chamado por um agendador externo, ex.: GitHub
 * Actions 4x/dia). Fica FORA do fluxo de server functions do TanStack (que exige
 * sessão Supabase + CSRF): é tratado direto no `server.ts` e protegido por um token
 * compartilhado (`CRON_TOKEN`).
 *
 * Trabalha em BLOCOS (como o botão "Atualizar tudo"): o agendador chama
 *   /api/cron?step=chunk&fromPage=<n|null>&size=15   → varre um bloco de páginas
 *   /api/cron?step=enrich&max=6                       → preenche nº de lote (catálogo)
 * em laço até terminar. A varredura geral e o catálogo são PÚBLICOS (sem login).
 * Vigias/lances continuam sendo lidos ao vivo quando o usuário abre o app.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleCron(request: Request, env?: unknown): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cron") return null;

  // No alvo Cloudflare as variáveis podem chegar pelo binding `env` (não em process.env).
  const fromEnv =
    env && typeof env === "object" ? (env as Record<string, unknown>)["CRON_TOKEN"] : undefined;
  const token = process.env["CRON_TOKEN"] ?? (typeof fromEnv === "string" ? fromEnv : undefined);
  const provided = request.headers.get("x-cron-token") ?? url.searchParams.get("token") ?? "";
  if (!token) return json({ error: "CRON_TOKEN não configurado no servidor" }, 503);
  if (provided !== token) return json({ error: "unauthorized" }, 401);

  const step = url.searchParams.get("step") ?? "";
  try {
    const { scrapeVinylChunk, enrichMissingLotes } = await import("./leiloesbr-scrape.server");

    if (step === "chunk") {
      const raw = url.searchParams.get("fromPage");
      const fromPage = raw == null || raw === "" || raw === "null" ? null : Number(raw);
      const size = Math.min(Math.max(Number(url.searchParams.get("size")) || 15, 1), 40);
      return json(await scrapeVinylChunk(Number.isNaN(fromPage as number) ? null : fromPage, size));
    }

    if (step === "enrich") {
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 6, 1), 20);
      return json(await enrichMissingLotes(max));
    }

    return json({ error: "step inválido (use chunk|enrich)" }, 400);
  } catch (error) {
    console.error("[cron] falha", error);
    return json({ error: (error as Error)?.message ?? "cron failed" }, 500);
  }
}

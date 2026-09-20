// Endpoint de health check (mitigação pro bug intermitente do cron — ver "Pendências" em
// docs/notas-desenvolvimento.md). Fora do fluxo de server functions, como handleCron/
// handleLiveProxy — o Caddy chama isso via `health_uri` no reverse_proxy pro `app`, pra
// nunca rotear tráfego pra uma instância num estado ruim (env ausente, banco fora do ar).
// Não exige CRON_TOKEN: não expõe nada além de booleans, e o Caddy precisa alcançar isso
// sem segredo (é ele quem decide se o upstream está saudável).
export async function handleHealth(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/health") return null;

  const hasDatabaseUrl = Boolean(process.env["DATABASE_URL"]);
  const hasCronToken = Boolean(process.env["CRON_TOKEN"]);
  if (!hasDatabaseUrl || !hasCronToken) {
    return json({ ok: false, hasDatabaseUrl, hasCronToken }, 503);
  }

  try {
    const { getSql } = await import("./db.server");
    await getSql()`select 1`;
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: (error as Error)?.message ?? "falha desconhecida" }, 503);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

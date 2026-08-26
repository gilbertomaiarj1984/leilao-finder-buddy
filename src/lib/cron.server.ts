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

export async function handleCron(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cron") return null;

  const token = process.env["CRON_TOKEN"];
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
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      return json(await enrichMissingLotes(max, offset));
    }

    // Avaliação da IA (assíncrona, via Batches API). Idempotente por chamada: coleta o
    // batch anterior e/ou submete o próximo. Sem ANTHROPIC_API_KEY → no-op explícito
    // (nunca quebra o cron de scraping).
    if (step === "aieval") {
      const { aiConfigured, selectLotsToEvaluate, submitEvalBatch, collectEvalBatch } =
        await import("./ai-eval.server");
      if (!aiConfigured()) return json({ skipped: "ANTHROPIC_API_KEY não configurado" });
      const { getPendingAiBatch, setPendingAiBatch } = await import("./app-state.server");
      const { getAllLotAi, upsertLotAi } = await import("./lot-ai.server");

      // 1) Há batch em andamento? Tenta coletar.
      const pending = await getPendingAiBatch();
      if (pending) {
        const { done, rows } = await collectEvalBatch(pending.batchId, pending.hashes);
        if (!done) return json({ pending: true, batchId: pending.batchId });
        const collected = await upsertLotAi(rows);
        await setPendingAiBatch(null);
        return json({ collected, batchId: pending.batchId });
      }

      // 2) Sem pendente: seleciona os lotes sem avaliação (ou com título mudado) e submete.
      const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
      const [snapshot, aiRows] = await Promise.all([scrapeVinylLots(false), getAllLotAi()]);
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 800, 1), 2000);
      const toEval = selectLotsToEvaluate(snapshot.lots, aiRows, max);
      if (!toEval.length) return json({ done: true, submitted: 0 });
      const { batchId, hashes, count } = await submitEvalBatch(toEval);
      await setPendingAiBatch({ batchId, submittedAt: new Date().toISOString(), hashes });
      return json({ submitted: count, batchId });
    }

    // Diagnóstico: sonda os catálogos das casas dos primeiros leilões sem nº de lote.
    if (step === "catdebug") {
      const { listMissingAuctions } = await import("./leiloesbr-scrape.server");
      const UA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
      const probe = async (target: string) => {
        try {
          const resp = await fetch(target, {
            headers: { "User-Agent": UA, Accept: "text/html" },
            redirect: "follow",
          });
          const text = await resp.text();
          return {
            status: resp.status,
            len: text.length,
            prodBox: (text.match(/class="prod-box/g) ?? []).length,
            ocItem: (text.match(/class="oc-item/g) ?? []).length,
            pecaHit: text.match(/peca\.asp\?ID=(\d+)/i)?.[1] ?? null,
            loteHit: text.match(/LoteProd[\s\S]{0,120}?lote:?\s*([0-9]+)/i)?.[1] ?? null,
          };
        } catch (error) {
          return { status: "ERR", error: (error as Error)?.message ?? "fetch failed" };
        }
      };
      const auctions = await listMissingAuctions(3);
      const probes = [];
      for (const a of auctions) {
        for (const path of [`/catalogo.asp?Num=${a.idLeilao}`, `/leilao.asp?Num=${a.idLeilao}`]) {
          const target = `${a.domain}${path}`;
          probes.push({
            idLeilao: a.idLeilao,
            sampleIds: a.ids,
            url: target,
            ...(await probe(target)),
          });
        }
      }
      return json({ missingAuctions: auctions.length, probes });
    }

    return json({ error: "step inválido (use chunk|enrich|aieval|catdebug)" }, 400);
  } catch (error) {
    console.error("[cron] falha", error);
    return json({ error: (error as Error)?.message ?? "cron failed" }, 500);
  }
}

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

/**
 * Compara dois tokens em tempo constante (não vaza o tamanho do prefixo comum por
 * timing). Só o header `x-cron-token` é aceito — nunca a querystring, que costuma
 * ir parar em logs de acesso.
 */
function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleCron(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cron") return null;

  const token = process.env["CRON_TOKEN"];
  const provided = request.headers.get("x-cron-token") ?? "";
  if (!token) return json({ error: "CRON_TOKEN não configurado no servidor" }, 503);
  if (!tokensMatch(provided, token)) return json({ error: "unauthorized" }, 401);

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

    // Âncora de mercado (Discogs). Chunked como o enrich: cada chamada consulta até
    // `max` lotes ainda não casados (throttle interno respeita o rate limit). Sem
    // DISCOGS_TOKEN → no-op explícito.
    if (step === "market") {
      const { discogsConfigured, fetchMarket } = await import("./discogs.server");
      if (!discogsConfigured()) return json({ skipped: "DISCOGS_TOKEN não configurado" });
      const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
      const { getAllLotAi } = await import("./lot-ai.server");
      const { getAllLotMarket, upsertLotMarket, selectLotsForMarket, marketBasis } =
        await import("./lot-market.server");
      const max = Math.min(Math.max(Number(url.searchParams.get("max")) || 12, 1), 40);
      const [snapshot, aiRows, marketRows] = await Promise.all([
        scrapeVinylLots(false),
        getAllLotAi(),
        getAllLotMarket(),
      ]);
      const targets = selectLotsForMarket(snapshot.lots, aiRows, marketRows, max);
      if (!targets.length) return json({ done: true, updated: 0 });

      const rows = [];
      for (const t of targets) {
        const basis = marketBasis(t.album, t.title);
        const m = await fetchMarket(t.album, t.title);
        rows.push({
          id: t.id,
          basis,
          matched: m.matched,
          release_id: m.releaseId,
          release_title: m.releaseTitle,
          year: m.year,
          num_for_sale: m.numForSale,
          lowest_price: m.lowestPrice,
          currency: m.currency,
          suggested_price: m.suggestedPrice,
          suggested_condition: m.suggestedCondition,
          have: m.have,
          want: m.want,
          price_low_br: m.priceLowBr,
          price_high_br: m.priceHighBr,
          num_for_sale_br: m.numForSaleBr,
        });
      }
      const updated = await upsertLotMarket(rows);
      // Ainda há mais? (a seleção pega os primeiros `max`; se veio cheio, provavelmente há resto)
      return json({ updated, done: targets.length < max });
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

    return json({ error: "step inválido (use chunk|enrich|aieval|market|catdebug)" }, 400);
  } catch (error) {
    console.error("[cron] falha", error);
    return json({ error: (error as Error)?.message ?? "cron failed" }, 500);
  }
}

import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

export const getAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { configuredEmail } = await import("./access.server");
    const email = String(context.claims?.["email"] ?? "")
      .trim()
      .toLowerCase();
    const allowed = configuredEmail();
    return {
      email,
      allowed: Boolean(allowed && email === allowed),
      configured: Boolean(allowed),
    };
  });

export const getVinylLots = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((data: { force?: boolean; day?: string } | undefined) => data ?? {})
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { scrapeVinylLots, refreshVinylDay } = await import("./leiloesbr-scrape.server");
    // Atualização por data: re-varre somente o dia informado e mescla no cache.
    if (data.force && data.day) return await refreshVinylDay(data.day);
    // "force" ignora o TTL, mas a varredura MESCLA (não apaga o que já existe).
    return await scrapeVinylLots(data.force ?? false);
  });

export const scrapeVinylChunk = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { fromPage?: number | null; size?: number } | undefined) => ({
    fromPage: input?.fromPage ?? null,
    size: Math.min(Math.max(Number(input?.size) || 15, 1), 40),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { scrapeVinylChunk: run } = await import("./leiloesbr-scrape.server");
    return await run(data.fromPage, data.size);
  });

export const getLiveAuctions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listLiveAuctions } = await import("./leiloesbr-auctions.server");
    return await listLiveAuctions();
  });

/** Leilões de vinil do DIA com o link do pregão presencial de cada casa e o status. */
export const getTodayAuctions = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listTodayAuctions } = await import("./leiloesbr-auctions.server");
    return await listTodayAuctions();
  });

/**
 * Emite a URL do PROXY autenticado para abrir o pregão presencial JÁ LOGADO dentro
 * do app (iframe ou nova aba). Recebe a `presencialUrl` da casa e devolve um caminho
 * no nosso domínio (`/api/live/...`) com um token de curta duração. Só o e-mail
 * autorizado consegue emitir.
 */
export const openLiveAuction = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { url?: string } | undefined) => {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) throw new Error("URL do pregão obrigatória.");
    return { url };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { buildLiveProxyUrl } = await import("./leiloesbr-live.server");
    return { proxyUrl: await buildLiveProxyUrl(data.url) };
  });

/**
 * Lote em pregão AGORA (nº do lote + "peça x de y") no presencial de uma casa, para o selo ao
 * lado de "Ao vivo agora". Best-effort: `null` quando não há pregão ou a casa não respondeu.
 */
export const getPresencialNow = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { url?: string } | undefined) => {
    const url = typeof input?.url === "string" ? input.url.trim() : "";
    if (!url) throw new Error("URL do pregão obrigatória.");
    return { url };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { fetchPresencialNow } = await import("./leiloesbr-presencial.server");
    return await fetchPresencialNow(data.url);
  });

// Preenche o nº do lote (via catálogo da casa) em blocos de leilões, para caber no
// tempo do servidor. O cliente chama em laço até `remaining` chegar a 0.
export const enrichLotes = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { max?: number; offset?: number } | undefined) => ({
    max: Math.min(Math.max(Number(input?.max) || 6, 1), 20),
    offset: Math.max(0, Number(input?.offset) || 0),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { enrichMissingLotes } = await import("./leiloesbr-scrape.server");
    return await enrichMissingLotes(data.max, data.offset);
  });

// Descoberta por galeria (casas fora da plataforma, ou cuja categoria "Disco de Vinil" não
// bate com a marcação da LeilõesBR — ex.: Abreu Colecionismo). Mesmo padrão chunked de
// `enrichLotes` (cursor `offset` no servidor), reaproveitado pelo cron (`step=galleryscan`)
// e pelo botão manual "Atualizar tudo" (v0.84.0).
export const runGalleryscan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { offset?: number; count?: number } | undefined) => ({
    offset: Math.max(0, Number(input?.offset) || 0),
    count: Math.min(Math.max(Number(input?.count) || 3, 1), 10),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { scanGalleries } = await import("./leiloesbr-scrape.server");
    return await scanGalleries(data.offset, data.count);
  });

// Estado (Disco/Capa) dos lotes pré-leilão, lido do catálogo da casa (`lot_condition`).
// Chunked como `enrichLotes`; reaproveitado pelo botão manual "Atualizar tudo" (v0.84.0).
export const runCondition = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { max?: number } | undefined) => ({
    max: Math.min(Math.max(Number(input?.max) || 8, 1), 20),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { enrichConditions } = await import("./lot-condition.server");
    return await enrichConditions(data.max);
  });

/** Lances dados pelo usuário (conta_site.asp?l=4). Best-effort: [] em erro. */
export const listMyBids = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { listMyBidsFromSite } = await import("./leiloesbr-bids.server");
      return await listMyBidsFromSite();
    } catch (error) {
      console.error("[leiloesbr] não foi possível ler os lances", error);
      return [];
    }
  });

/**
 * Detalhes por lote lidos do `peca.asp` (1 requisição por lote → usar só para conjuntos
 * pequenos: vigiados + lances): valor atual (`VALOR_VALUE`, ao vivo — mais fresco que a
 * varredura geral), próximo lance (`NOVO_VALOR`) e, quando o leilão já terminou, o resultado
 * da venda (sinal mais rápido de "vendido" para quem só VIGIA, sem lance — ver
 * `leiloesbr-lot-details.server.ts`). Best-effort: {} em erro.
 */
export const getLotDetails = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { targets?: { id: string; idPeca: string; url: string }[] } | undefined) => ({
      targets: Array.isArray(input?.targets)
        ? input!.targets
            .filter(
              (t) =>
                t &&
                typeof t.id === "string" &&
                typeof t.idPeca === "string" &&
                typeof t.url === "string",
            )
            .slice(0, 100)
        : [],
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const empty: Record<string, { currentValue?: string; nextBid?: string; sold?: string }> = {};
    if (!data.targets.length) return empty;
    try {
      const { fetchLotDetails } = await import("./leiloesbr-lot-details.server");
      return await fetchLotDetails(data.targets);
    } catch (error) {
      console.error("[leiloesbr] não foi possível ler os detalhes dos lotes", error);
      return empty;
    }
  });

/** Casas marcadas como verificadas (durável no servidor; global). */
export const getVerifiedHouses = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getVerifiedHouses } = await import("./app-state.server");
    return await getVerifiedHouses();
  });

/** Grava a lista completa de casas verificadas (sobrescreve). */
export const setVerifiedHouses = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { keys?: string[] } | undefined) => ({
    keys: Array.isArray(input?.keys) ? input!.keys.filter((k) => typeof k === "string") : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setVerifiedHouses } = await import("./app-state.server");
    return await setVerifiedHouses(data.keys);
  });

/** Estado de conservação (Disco/Capa) por lote p/ os cards (`lot_condition`). Best-effort: [] em erro. */
export const getLotCondition = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotCondition } = await import("./lot-condition.server");
      return await getAllLotCondition();
    } catch (error) {
      console.error("[lot-condition] não foi possível ler o estado dos lotes", error);
      return [];
    }
  });

/**
 * Status de VENDIDO para um conjunto pontual de lotes (vigiados + lances), casado por
 * `lot_id` com o histórico já capturado em `lot_sales` (mesma tabela do Vinil Analytics,
 * preenchida pelo cron `step=sales` após cada leilão terminar). Escopado por `ids` — nunca lê a
 * tabela inteira — para servir a tarja "Vendido" nos cards sem custo de egress. Best-effort: [].
 */
export const getSoldLots = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { ids?: string[] } | undefined) => ({
    ids: Array.isArray(input?.ids)
      ? input!.ids
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .slice(0, 500)
      : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    if (!data.ids.length) return [];
    try {
      const { getAllLotSales } = await import("./lot-sales.server");
      const rows = await getAllLotSales({ ids: data.ids, withOrig: false });
      return rows.map((r) => ({ lot_id: r.lot_id, sold_price_raw: r.sold_price_raw }));
    } catch (error) {
      console.error("[lot-sales] não foi possível checar lotes vendidos", error);
      return [];
    }
  });

/** Âncora de mercado do Discogs por lote (preço/demanda). Best-effort: [] em erro. */
export const getLotMarket = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotMarket } = await import("./lot-market.server");
      return await getAllLotMarket();
    } catch (error) {
      console.error("[lot-market] não foi possível ler o mercado", error);
      return [];
    }
  });

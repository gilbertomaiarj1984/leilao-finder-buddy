import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";
import { parseLotScope, type LotScope } from "@/lib/lot-scope";

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

/** Lotes já gravados de um intervalo de dias (histórico/futuro), sem varrer o site. */
export const getVinylLotsRange = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((data: { from: string; to: string; beyond?: boolean }) => {
    const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!ok(data?.from) || !ok(data?.to)) throw new Error("intervalo de dias inválido");
    return { from: data.from, to: data.to, beyond: data.beyond === true };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { readLotsRange } = await import("./leiloesbr-scrape.server");
    return { lots: await readLotsRange(data.from, data.to, data.beyond) };
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

/**
 * Lotes sem lance de um leilão — sob demanda, pela visão "Sem lance" do dia. Leilão encerrado:
 * tudo que não vendeu; em andamento (`currentLote`): só o que já passou no pregão.
 */
export const getUnsoldLots = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | { idLeilao?: string; presencialUrl?: string; dayKey?: string; currentLote?: string }
        | undefined,
    ) => {
      const idLeilao = typeof input?.idLeilao === "string" ? input.idLeilao.trim() : "";
      const presencialUrl =
        typeof input?.presencialUrl === "string" ? input.presencialUrl.trim() : "";
      const dayKey = typeof input?.dayKey === "string" ? input.dayKey.trim() : "";
      if (!idLeilao || !presencialUrl || !dayKey) {
        throw new Error("idLeilao, presencialUrl e dayKey obrigatórios.");
      }
      const currentLote =
        typeof input?.currentLote === "string" ? input.currentLote.trim() || null : null;
      return { idLeilao, presencialUrl, dayKey, currentLote };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getUnsoldLotsForAuction } = await import("./unsold-lots.server");
    return await getUnsoldLotsForAuction(
      data.idLeilao,
      data.presencialUrl,
      data.dayKey,
      data.currentLote,
    );
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

/**
 * Lances dados pelo usuário (conta_site.asp?l=4). Best-effort: [] em erro. Cache de
 * `ACCOUNT_CACHE_MS` no servidor; `force` (botão Atualizar) lê de novo.
 */
export const listMyBids = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { force?: boolean } | undefined) => ({ force: input?.force === true }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { listMyBidsFromSite } = await import("./leiloesbr-bids.server");
      const { ACCOUNT_CACHE_MS } = await import("./account-cache.server");
      return await listMyBidsFromSite({ maxAgeMs: data.force ? 0 : ACCOUNT_CACHE_MS });
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
  .inputValidator((input: { scope?: LotScope } | undefined) => ({ scope: parseLotScope(input) }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotCondition } = await import("./lot-condition.server");
      const { filterByLotScope } = await import("./lot-scope.server");
      return await filterByLotScope(await getAllLotCondition(), data.scope);
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
  .inputValidator((input: { scope?: LotScope } | undefined) => ({ scope: parseLotScope(input) }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotMarket } = await import("./lot-market.server");
      const { filterByLotScope } = await import("./lot-scope.server");
      return await filterByLotScope(await getAllLotMarket(), data.scope);
    } catch (error) {
      console.error("[lot-market] não foi possível ler o mercado", error);
      return [];
    }
  });

/** UF de cada casa (`houseKey` → "SP"), para mostrar ao lado do nome da casa em toda a UI. */
export const getHouseUfs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getHouseUfs: read } = await import("./house-uf.server");
    return await read();
  });

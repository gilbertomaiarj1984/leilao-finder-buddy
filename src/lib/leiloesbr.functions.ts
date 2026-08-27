import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listLiveAuctions } = await import("./leiloesbr-auctions.server");
    return await listLiveAuctions();
  });

// Preenche o nº do lote (via catálogo da casa) em blocos de leilões, para caber no
// tempo do servidor. O cliente chama em laço até `remaining` chegar a 0.
export const enrichLotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

/** Lances dados pelo usuário (conta_site.asp?l=4). Best-effort: [] em erro. */
export const listMyBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
 * Próximo lance (NOVO_VALOR do `peca.asp`) por lote. 1 requisição por lote → usar só
 * para conjuntos pequenos (vigiados + lances). Best-effort: {} em erro.
 */
export const getNextBids = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targets?: { idPeca: string; url: string }[] } | undefined) => ({
    targets: Array.isArray(input?.targets)
      ? input!.targets
          .filter((t) => t && typeof t.idPeca === "string" && typeof t.url === "string")
          .slice(0, 100)
      : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    if (!data.targets.length) return {} as Record<string, string>;
    try {
      const { fetchNextBids } = await import("./leiloesbr-lot-details.server");
      return await fetchNextBids(data.targets);
    } catch (error) {
      console.error("[leiloesbr] não foi possível ler os próximos lances", error);
      return {} as Record<string, string>;
    }
  });

/** Casas marcadas como verificadas (durável no servidor; global). */
export const getVerifiedHouses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getVerifiedHouses } = await import("./app-state.server");
    return await getVerifiedHouses();
  });

/** Grava a lista completa de casas verificadas (sobrescreve). */
export const setVerifiedHouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keys?: string[] } | undefined) => ({
    keys: Array.isArray(input?.keys) ? input!.keys.filter((k) => typeof k === "string") : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setVerifiedHouses } = await import("./app-state.server");
    return await setVerifiedHouses(data.keys);
  });

/** Lista de interesses do usuário (artistas/álbuns/gêneros). Global. */
export const getUserInterests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getUserInterests } = await import("./app-state.server");
    return await getUserInterests();
  });

/** Grava a lista completa de interesses (sobrescreve). */
export const setUserInterests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { items?: string[] } | undefined) => ({
    items: Array.isArray(input?.items) ? input!.items.filter((s) => typeof s === "string") : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setUserInterests } = await import("./app-state.server");
    return await setUserInterests(data.items);
  });

/** Sondagem: rascunho de obras que o usuário caça (wantlist_items). Best-effort: [] em erro. */
export const getWantlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllWantlist } = await import("./wantlist.server");
      return await getAllWantlist();
    } catch (error) {
      console.error("[wantlist] não foi possível ler a sondagem", error);
      return [];
    }
  });

/** Importa (acrescenta) obras coladas em texto. Não apaga o que já existe. */
export const importWantlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text?: string } | undefined) => ({
    text: typeof input?.text === "string" ? input.text : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { importWantlistText } = await import("./wantlist.server");
    return await importWantlistText(data.text);
  });

/** Adiciona uma obra manualmente à sondagem. */
export const addWantlistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { work?: string; year?: number | null; note?: string } | undefined) => ({
    work: typeof input?.work === "string" ? input.work : "",
    year: input?.year === null || input?.year === undefined ? null : Number(input.year) || null,
    note: typeof input?.note === "string" ? input.note : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addWantlistItem: add } = await import("./wantlist.server");
    return await add(data);
  });

/** Atualiza uma obra da sondagem (obra/ano/nota/adquirida). */
export const updateWantlistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input:
        | { id?: string; work?: string; year?: number | null; note?: string; acquired?: boolean }
        | undefined,
    ) => {
      if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
      const patch: {
        id: string;
        work?: string;
        year?: number | null;
        note?: string;
        acquired?: boolean;
      } = { id: input.id };
      if (typeof input.work === "string") patch.work = input.work;
      if (input.year !== undefined)
        patch.year = input.year === null ? null : Number(input.year) || null;
      if (typeof input.note === "string") patch.note = input.note;
      if (typeof input.acquired === "boolean") patch.acquired = input.acquired;
      return patch;
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { updateWantlistItem: update } = await import("./wantlist.server");
    return await update(data);
  });

/** Remove uma obra da sondagem. */
export const deleteWantlistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { deleteWantlistItem: remove } = await import("./wantlist.server");
    return await remove(data.id);
  });

/** Avaliações da IA por lote (score/raridade/oportunidade/motivo/tags). Best-effort: [] em erro. */
export const getLotAi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotAi } = await import("./lot-ai.server");
      return await getAllLotAi();
    } catch (error) {
      console.error("[lot-ai] não foi possível ler as avaliações", error);
      return [];
    }
  });

/** Edita manualmente as tags de um lote (add/remove pela UI). Devolve as tags gravadas. */
export const setLotTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; tags?: unknown } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("Lote inválido.");
    const tags = Array.isArray(input.tags)
      ? input.tags.filter((t): t is string => typeof t === "string")
      : [];
    return { id: input.id, tags };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { updateLotTags } = await import("./lot-ai.server");
    return { id: data.id, tags: await updateLotTags(data.id, data.tags) };
  });

/** Âncora de mercado do Discogs por lote (preço/demanda). Best-effort: [] em erro. */
export const getLotMarket = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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

/** Baseline de preços do último acesso ao painel. */
export const getDashboardBaseline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getBaseline } = await import("./app-state.server");
    return await getBaseline();
  });

/** Marca o painel como visto: grava o mapa {lotId: price} atual como novo baseline. */
export const markDashboardSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prices?: Record<string, string> } | undefined) => ({
    prices: input?.prices ?? {},
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { markSeen } = await import("./app-state.server");
    return await markSeen(data.prices);
  });

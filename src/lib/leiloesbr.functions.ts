import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAiProvider, type AiProvider } from "./ai-provider";

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

/** Leilões de vinil do DIA com o link do pregão presencial de cada casa e o status. */
export const getTodayAuctions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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

/** Vínculos manuais lote → disco da Coleção ("já tenho"). Global. */
export const getCollectionLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCollectionLinks } = await import("./app-state.server");
    return await getCollectionLinks();
  });

/** Aprendizado por assinatura (feedback das decisões). Global. */
export const getCollectionFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCollectionFeedback } = await import("./app-state.server");
    return await getCollectionFeedback();
  });

/**
 * Aplica UMA decisão de relação lote↔Coleção e alimenta o aprendizado numa tacada:
 * - `value` = itemId (vincular) | false ("não tenho") | null (reativar automático);
 * - `sig` = como o disco apareceu no lote (para o aprendizado por assinatura).
 * Vincular → feedback `pos`; "não tenho" → feedback `neg`; reativar → remove o
 * feedback originado deste lote.
 */
export const applyCollectionDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      lotId?: string;
      value?: string | false | null;
      itemId?: string | null;
      sig?: { artist?: string[]; album?: string[]; year?: number | null };
    }) => {
      if (!input?.lotId || typeof input.lotId !== "string") throw new Error("lotId obrigatório");
      const value =
        input.value === false || input.value === null || typeof input.value === "string"
          ? input.value
          : null;
      const toStr = (a: unknown): string[] =>
        Array.isArray(a) ? a.filter((s): s is string => typeof s === "string") : [];
      return {
        lotId: input.lotId,
        value: value as string | false | null,
        itemId: typeof input.itemId === "string" ? input.itemId : null,
        sig: {
          artist: toStr(input.sig?.artist),
          album: toStr(input.sig?.album),
          year: typeof input.sig?.year === "number" ? input.sig!.year : null,
        },
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setCollectionLink, addCollectionFeedback, removeCollectionFeedbackByLot } =
      await import("./app-state.server");
    const res = await setCollectionLink(data.lotId, data.value);
    if (data.value === null) {
      await removeCollectionFeedbackByLot(data.lotId);
    } else if (data.itemId) {
      await addCollectionFeedback({
        lotId: data.lotId,
        itemId: data.itemId,
        verdict: data.value === false ? "neg" : "pos",
        artist: data.sig.artist,
        album: data.sig.album,
        year: data.sig.year,
      });
    }
    return res;
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

/** Identificação simplificada da IA por lote (artista/álbum/ano). Best-effort: [] em erro. */
export const getLotIdent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotIdent } = await import("./lot-ident.server");
      return await getAllLotIdent();
    } catch (error) {
      console.error("[lot-ident] não foi possível ler as identificações", error);
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

/** Modo da avaliação por IA da rodada automática: "off" | "all" | "watched". Global. */
export const getAiMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiMode } = await import("./app-state.server");
    return await getAiMode();
  });

/** Grava o modo da IA (valida contra os valores permitidos). */
export const setAiMode = createServerFn({ method: "POST" })
  .inputValidator((input: { mode?: string } | undefined) => {
    const allowed = ["off", "all", "watched"] as const;
    const mode = input?.mode;
    if (typeof mode !== "string" || !(allowed as readonly string[]).includes(mode)) {
      throw new Error("Modo da IA inválido.");
    }
    return { mode: mode as (typeof allowed)[number] };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAiMode } = await import("./app-state.server");
    return await setAiMode(data.mode);
  });

/** Provedor de IA PADRÃO: "anthropic" (Claude) | "gemini" (Google). Global. */
export const getAiProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiProvider> => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    return await getAiProvider();
  });

/** Grava o provedor de IA padrão (valida contra os provedores conhecidos). */
export const setAiProvider = createServerFn({ method: "POST" })
  .inputValidator((input: { provider?: string } | undefined) => {
    if (!isAiProvider(input?.provider)) throw new Error("Provedor de IA inválido.");
    return { provider: input.provider };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAiProvider } = await import("./app-state.server");
    return await setAiProvider(data.provider);
  });

/**
 * Análise SOB DEMANDA de um dia (e opcionalmente de UMA casa desse dia): avalia NA HORA,
 * de forma síncrona, só os lotes AINDA NÃO avaliados (reaproveita o cache por título).
 * Roda mesmo com a IA automática desligada. Processa até `max` lotes por chamada e devolve
 * `remaining` (não avaliados que ficaram de fora) para o cliente repetir em laço.
 */
export const analyzeOnDemand = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { day?: string; house?: string; max?: number; provider?: string } | undefined) => {
      const day = typeof input?.day === "string" ? input.day.trim() : "";
      if (!day) throw new Error("Dia obrigatório.");
      return {
        day,
        house: typeof input?.house === "string" && input.house.trim() ? input.house.trim() : null,
        max: Math.min(Math.max(Number(input?.max) || 25, 1), 50),
        // Provedor escolhido na hora (opcional): senão usa o padrão do `app_state`.
        provider: isAiProvider(input?.provider) ? input.provider : null,
      };
    },
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { aiConfigured, selectLotsToEvaluate, evalLotsSync } = await import("./ai-eval.server");
    if (!aiConfigured()) {
      throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
    }
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
    const { getAllLotAi, upsertLotAi } = await import("./lot-ai.server");
    const [snapshot, aiRows] = await Promise.all([scrapeVinylLots(false), getAllLotAi()]);

    // Recorta o dia (e a casa, quando informada) e seleciona só o que falta avaliar.
    const scope = snapshot.lots.filter(
      (lot) => lot.dayKey === data.day && (!data.house || lot.house === data.house),
    );
    const pending = selectLotsToEvaluate(scope, aiRows, Number.MAX_SAFE_INTEGER);
    const toEval = pending.slice(0, data.max);
    if (!toEval.length) {
      return {
        evaluated: 0,
        remaining: 0,
        scope: scope.length,
        served: null,
        switched: false,
        failed: 0,
        error: null,
      };
    }

    const { rows, served, switched, failed, error } = await evalLotsSync(toEval, provider);
    const evaluated = await upsertLotAi(rows);
    return {
      evaluated,
      remaining: Math.max(0, pending.length - toEval.length),
      scope: scope.length,
      // Qual provedor de fato atendeu (para a UI) e se houve failover por falta de créditos.
      served,
      switched,
      // Quantos lotes a IA NÃO conseguiu avaliar (erro/vazio) e o motivo — a UI distingue
      // "a IA falhou" de "nada pendente" (evita o falso "já avaliado").
      failed,
      error,
    };
  });

/** Estado de conservação (Disco/Capa) por lote p/ os cards (`lot_condition`). Best-effort: [] em erro. */
export const getLotCondition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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

/** Histórico de vendas (`lot_sales`, base do Vinil Analytics). Best-effort: [] em erro. */
export const getVinylSales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLotSales } = await import("./lot-sales.server");
      return await getAllLotSales();
    } catch (error) {
      console.error("[lot-sales] não foi possível ler o histórico de vendas", error);
      return [];
    }
  });

/**
 * Captura de vendas pós-leilão sob demanda (mesma rotina do cron `step=sales`): varre o
 * catálogo de até `max` leilões terminados ainda não capturados e grava em `lot_sales`.
 * O cliente pode chamar em laço até `done` (igual ao preenchimento de nº de lote).
 */
export const captureSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { max?: number } | undefined) => ({
    max: Math.min(Math.max(Number(input?.max) || 8, 1), 20),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { captureFinishedSales } = await import("./lot-sales.server");
    return await captureFinishedSales(data.max);
  });

/**
 * Reidentificação por IA de TODO o histórico de vendas (mesma rotina do cron `step=reident`):
 * ajusta artista/álbum (título+descrição → IA) e padroniza a grafia dos nomes. Usa o provedor
 * de IA PADRÃO (o selecionado no topo do site). O cliente pode chamar em laço até `done`.
 */
export const reidentifySales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { max?: number } | undefined) => ({
    max: Math.min(Math.max(Number(input?.max) || 25, 1), 50),
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { reidentifyAllSales } = await import("./lot-sales.server");
    return await reidentifyAllSales(data.max);
  });

/**
 * Apelidos do Vinil Analytics (curadoria manual do agrupamento artista → álbum, com
 * "aprendizado" durável). Ver `app-state.server.ts` / `buildAnalytics`.
 */
export const getAnalyticsAliases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAnalyticsAliases: read } = await import("./app-state.server");
      return await read();
    } catch (error) {
      console.error("[analytics] não foi possível ler os apelidos", error);
      return { artists: {}, albums: {} };
    }
  });

/** Renomear/fundir ARTISTA: cada chave normalizada em `sourceKeys` passa a apontar para `name`. */
export const setAnalyticsArtistAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceKeys?: unknown; name?: unknown }) => ({
    sourceKeys: Array.isArray(input?.sourceKeys)
      ? input.sourceKeys.filter((k): k is string => typeof k === "string" && !!k)
      : [],
    name: typeof input?.name === "string" ? input.name.trim() : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsArtistAlias: save } = await import("./app-state.server");
    return await save(data.sourceKeys, data.name);
  });

/** Renomear/fundir ÁLBUM: cada chave `"${artistKey}|${albumKey}"` em `keys` aponta para `name`. */
export const setAnalyticsAlbumAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { keys?: unknown; name?: unknown }) => ({
    keys: Array.isArray(input?.keys)
      ? input.keys.filter((k): k is string => typeof k === "string" && !!k)
      : [],
    name: typeof input?.name === "string" ? input.name.trim() : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnalyticsAlbumAlias: save } = await import("./app-state.server");
    return await save(data.keys, data.name);
  });

/** Desfaz um apelido (remove a chave do mapa de artista ou de álbum). */
export const clearAnalyticsAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind?: unknown; key?: unknown }) => ({
    kind: input?.kind === "album" ? ("album" as const) : ("artist" as const),
    key: typeof input?.key === "string" ? input.key : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { clearAnalyticsAlias: clear } = await import("./app-state.server");
    return await clear(data.kind, data.key);
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

// Server functions de IA: avaliação/identificação de lotes, tags, interesses do usuário e
// seleção de modo/provedor/modelo.
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";
import {
  isAiProvider,
  isAnthropicModel,
  isGeminiModel,
  type AiProvider,
  type AnthropicModel,
  type GeminiModel,
} from "./ai-provider";

// Identificação simplificada por IA (artista/álbum, `lot_ident`). UMA chamada só SUBMETE
// (Claude batch) ou GRAVA na hora (Gemini síncrono) — nunca espera o batch terminar, então
// o chamador (aqui, o botão manual "Atualizar tudo") só informa "enviado, completa sozinho"
// e segue. Mesma lógica de `cron.server.ts`/`step=aiident`, extraída em v0.84.0 pra
// `ai-ident-step.server.ts` e reaproveitada aqui.
export const runAiident = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { runAiIdentStep } = await import("./ai-ident-step.server");
    return await runAiIdentStep();
  });

/** Lista de interesses do usuário (artistas/álbuns/gêneros). Global. */
export const getUserInterests = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getUserInterests } = await import("./app-state.server");
    return await getUserInterests();
  });

/** Grava a lista completa de interesses (sobrescreve). */
export const setUserInterests = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { items?: string[] } | undefined) => ({
    items: Array.isArray(input?.items) ? input!.items.filter((s) => typeof s === "string") : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setUserInterests } = await import("./app-state.server");
    return await setUserInterests(data.items);
  });

/** Avaliações da IA por lote (score/raridade/oportunidade/motivo/tags). Best-effort: [] em erro. */
export const getLotAi = createServerFn({ method: "GET" })
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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

/**
 * Refaz a avaliação da IA de UM lote sob demanda (botão no painel de detalhes da nota).
 * Ignora o cache por título (sempre consulta de novo, mesmo sem mudança no título) — é
 * justamente para atualizar com base em informações novas do lote (imagem, texto). Usa o
 * provedor de IA PADRÃO do usuário. Devolve a linha gravada para o cliente atualizar o
 * cache local sem precisar reler tudo.
 */
export const reevaluateLot = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | { id?: string; title?: string; price?: string; house?: string; image?: string | null }
        | undefined,
    ) => {
      if (!input?.id || typeof input.id !== "string") throw new Error("Lote inválido.");
      if (!input.title || typeof input.title !== "string") throw new Error("Lote inválido.");
      return {
        id: input.id,
        title: input.title,
        price: typeof input.price === "string" ? input.price : "",
        house: typeof input.house === "string" ? input.house : "",
        image: typeof input.image === "string" ? input.image : null,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { aiConfigured, evalLotsSync } = await import("./ai-eval.server");
    if (!aiConfigured()) {
      throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
    }
    const { getAiProvider } = await import("./app-state.server");
    const provider = await getAiProvider();
    const { upsertLotAi } = await import("./lot-ai.server");
    const { rows, error } = await evalLotsSync([data], provider);
    const row = rows[0];
    if (!row) throw new Error(error || "A IA não conseguiu reavaliar este lote.");
    await upsertLotAi([row]);
    return { row };
  });

/**
 * Reavalia a nota da IA de vigiados/lances cujo preço ATUAL (ao vivo, do `peca.asp`) subiu o
 * bastante desde a avaliação (`priceRoseSinceEval`, ver `ai-reprice.ts`) — a nota mistura
 * raridade + oportunidade, então fica otimista demais quando os lances sobem. Disparado pelo
 * cliente quando o valor ao vivo chega (a varredura do cron defasa e perde o lote quando o
 * pregão entra ao vivo). O servidor RECONFERE a subida contra `lot_ai.eval_price` (não confia
 * só no cliente), só reavalia lotes que JÁ têm avaliação (não gasta com lote nunca avaliado —
 * isso continua com o cron/"Analisar") e respeita o modo "off". Teto de 10 por chamada.
 */
export const repriceLotAi = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | {
            lots?: {
              id?: string;
              title?: string;
              price?: string;
              house?: string;
              image?: string | null;
            }[];
          }
        | undefined,
    ) => ({
      lots: (Array.isArray(input?.lots) ? input!.lots : [])
        .filter(
          (l) =>
            l &&
            typeof l.id === "string" &&
            l.id &&
            typeof l.title === "string" &&
            l.title &&
            typeof l.price === "string",
        )
        .slice(0, 10)
        .map((l) => ({
          id: l.id as string,
          title: l.title as string,
          price: l.price as string,
          house: typeof l.house === "string" ? l.house : "",
          image: typeof l.image === "string" ? l.image : null,
        })),
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const empty = { rows: [] as import("./lot-ai.server").LotAiRow[] };
    if (!data.lots.length) return empty;
    const { aiConfigured, evalLotsSync } = await import("./ai-eval.server");
    if (!aiConfigured()) return empty;
    const { getAiMode, getAiProvider } = await import("./app-state.server");
    if ((await getAiMode()) === "off") return empty;
    const { getAllLotAi, upsertLotAi } = await import("./lot-ai.server");
    const { priceRoseSinceEval } = await import("./ai-reprice");
    const { parsePrice } = await import("./vinyl-parse");
    const byId = new Map((await getAllLotAi()).map((r) => [r.id, r]));
    const toEval = data.lots.filter((l) => {
      const row = byId.get(l.id);
      return row ? priceRoseSinceEval(row.eval_price, parsePrice(l.price)) : false;
    });
    if (!toEval.length) return empty;
    try {
      const { rows } = await evalLotsSync(toEval, await getAiProvider());
      await upsertLotAi(rows);
      return { rows };
    } catch (error) {
      console.error("[lot-ai] falha ao reavaliar lotes por subida de preço", error);
      return empty;
    }
  });

/** Modo da avaliação por IA da rodada automática: "off" | "all" | "watched". Global. */
export const getAiMode = createServerFn({ method: "GET" })
  .middleware([requireAuth])
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
  .middleware([requireAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAiMode } = await import("./app-state.server");
    return await setAiMode(data.mode);
  });

/** Provedor de IA PADRÃO: "anthropic" (Claude) | "gemini" (Google). Global. */
export const getAiProvider = createServerFn({ method: "GET" })
  .middleware([requireAuth])
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
  .middleware([requireAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAiProvider } = await import("./app-state.server");
    return await setAiProvider(data.provider);
  });

/** Modelo do Gemini escolhido (Flash-Lite/Flash/Pro, do mais barato ao mais caro). Global. */
export const getGeminiModel = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<GeminiModel> => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getGeminiModel } = await import("./app-state.server");
    return await getGeminiModel();
  });

/** Grava o modelo do Gemini escolhido (valida contra os modelos conhecidos). */
export const setGeminiModel = createServerFn({ method: "POST" })
  .inputValidator((input: { model?: string } | undefined) => {
    if (!isGeminiModel(input?.model)) throw new Error("Modelo de Gemini inválido.");
    return { model: input.model };
  })
  .middleware([requireAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setGeminiModel } = await import("./app-state.server");
    return await setGeminiModel(data.model);
  });

/** Modelo do Claude escolhido (Haiku 5.5/4.5). Global. */
export const getAnthropicModel = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<AnthropicModel> => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAnthropicModel } = await import("./app-state.server");
    return await getAnthropicModel();
  });

/** Grava o modelo do Claude escolhido (valida contra os modelos conhecidos). */
export const setAnthropicModel = createServerFn({ method: "POST" })
  .inputValidator((input: { model?: string } | undefined) => {
    if (!isAnthropicModel(input?.model)) throw new Error("Modelo do Claude inválido.");
    return { model: input.model };
  })
  .middleware([requireAuth])
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAnthropicModel } = await import("./app-state.server");
    const result = await setAnthropicModel(data.model);
    const { invalidateAnthropicModelCache } = await import("./ai-provider.server");
    invalidateAnthropicModelCache();
    return result;
  });

/**
 * Análise SOB DEMANDA de um dia (e opcionalmente de UMA casa desse dia): avalia NA HORA,
 * de forma síncrona, só os lotes AINDA NÃO avaliados (reaproveita o cache por título).
 * Roda mesmo com a IA automática desligada. Processa até `max` lotes por chamada e devolve
 * `remaining` (não avaliados que ficaram de fora) para o cliente repetir em laço.
 */
export const analyzeOnDemand = createServerFn({ method: "POST" })
  .inputValidator(
    (
      input:
        | { day?: string; house?: string; max?: number; provider?: string; watched?: boolean }
        | undefined,
    ) => {
      const day = typeof input?.day === "string" ? input.day.trim() : "";
      const watched = input?.watched === true;
      if (!day && !watched) throw new Error("Dia obrigatório.");
      return {
        day,
        watched,
        house: typeof input?.house === "string" && input.house.trim() ? input.house.trim() : null,
        max: Math.min(Math.max(Number(input?.max) || 25, 1), 50),
        // Provedor escolhido na hora (opcional): senão usa o padrão do `app_state`.
        provider: isAiProvider(input?.provider) ? input.provider : null,
      };
    },
  )
  .middleware([requireAuth])
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
    // Modo `watched`: vigiados ∪ lances — inclui os que NÃO estão na varredura geral (casas
    // parceiras/catálogos), que de outro modo nunca receberiam nota.
    let scope: { id: string; title: string; price: string; house: string; image: string | null }[];
    if (data.watched) {
      const { listWatchedFromSite } = await import("./leiloesbr-watch.server");
      const { listMyBidsFromSite } = await import("./leiloesbr-bids.server");
      const [w, b] = await Promise.all([
        listWatchedFromSite().catch((error: unknown) => {
          console.error("[analyzeOnDemand] falha ao listar vigiados", error);
          return [];
        }),
        listMyBidsFromSite().catch((error: unknown) => {
          console.error("[analyzeOnDemand] falha ao listar lances", error);
          return [];
        }),
      ]);
      const byId = new Map(snapshot.lots.map((lot) => [lot.id, lot]));
      const merged = new Map<
        string,
        { id: string; title: string; price: string; house: string; image: string | null }
      >();
      for (const l of [...w, ...b]) {
        merged.set(l.id, byId.get(l.id) ?? { ...l, price: "price" in l ? l.price : "" });
      }
      scope = [...merged.values()];
    } else {
      scope = snapshot.lots.filter(
        (lot) => lot.dayKey === data.day && (!data.house || lot.house === data.house),
      );
    }
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
        attemptErrors: {},
      };
    }

    const { rows, served, switched, failed, error, attemptErrors } = await evalLotsSync(
      toEval,
      provider,
    );
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
      // Motivo de cada provedor pulado/que falhou até o que atendeu (ver `runText`).
      attemptErrors,
    };
  });

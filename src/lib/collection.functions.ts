import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";
import { isAiProvider } from "./ai-provider";

/** Normaliza a entrada dos campos editáveis de um disco (add/update). */
function normalizeInput(input: Record<string, unknown> | undefined) {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const patch: {
    artist?: string;
    album?: string;
    title?: string;
    year?: number | null;
    image?: string | null;
    house?: string;
    uf?: string;
    wonPrice?: string;
    wonDate?: string | null;
    conditionMedia?: string;
    conditionSleeve?: string;
    notes?: string;
    description?: string;
    tags?: string[];
    lotId?: string;
    originLotId?: string;
  } = {};
  if (str(input?.artist) !== undefined) patch.artist = String(input!.artist);
  if (str(input?.album) !== undefined) patch.album = String(input!.album);
  if (str(input?.title) !== undefined) patch.title = String(input!.title);
  if (input?.year !== undefined)
    patch.year = input.year === null ? null : Number(input.year) || null;
  if (input?.image !== undefined)
    patch.image = input.image === null ? null : String(input.image) || null;
  if (str(input?.house) !== undefined) patch.house = String(input!.house);
  if (str(input?.uf) !== undefined) patch.uf = String(input!.uf);
  if (str(input?.wonPrice) !== undefined) patch.wonPrice = String(input!.wonPrice);
  if (input?.wonDate !== undefined)
    patch.wonDate = input.wonDate === null ? null : String(input.wonDate) || null;
  if (str(input?.conditionMedia) !== undefined)
    patch.conditionMedia = String(input!.conditionMedia);
  if (str(input?.conditionSleeve) !== undefined)
    patch.conditionSleeve = String(input!.conditionSleeve);
  if (str(input?.notes) !== undefined) patch.notes = String(input!.notes);
  if (str(input?.description) !== undefined) patch.description = String(input!.description);
  if (Array.isArray(input?.tags))
    patch.tags = input!.tags.filter((t): t is string => typeof t === "string");
  if (str(input?.lotId) !== undefined) patch.lotId = String(input!.lotId);
  if (str(input?.originLotId)) patch.originLotId = String(input!.originLotId);
  return patch;
}

/** Coleção de vinil do usuário (collection_items). Best-effort: [] em erro. */
export const getCollection = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllCollection } = await import("./collection.server");
      return await getAllCollection();
    } catch (error) {
      console.error("[collection] não foi possível ler a coleção", error);
      return [];
    }
  });

/**
 * Re-identificação por IA (opt-in, texto — nunca a capa): define artista/álbum/ano e agrupa
 * coletâneas/lotes. Processa um bloco a partir de `offset` e devolve o cursor `nextOffset` p/ o
 * cliente repetir em laço até `done`. `onlyUnidentified` (padrão) gasta IA só nos discos ainda
 * sem identificação (uso rotineiro, barato); `false` re-normaliza TODA a coleção (mais caro).
 */
export const identifyCollection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | { offset?: number; max?: number; onlyUnidentified?: boolean; provider?: string }
        | undefined,
    ) => ({
      offset: Math.max(Number(input?.offset) || 0, 0),
      max: Math.min(Math.max(Number(input?.max) || 12, 1), 25),
      // Padrão seguro/barato: só os não identificados. `false` só quando o cliente pede.
      onlyUnidentified: input?.onlyUnidentified !== false,
      // Provedor escolhido na hora (opcional): senão usa o padrão do `app_state`.
      provider: isAiProvider(input?.provider) ? input.provider : null,
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { reidentifyCollection } = await import("./collection.server");
    return await reidentifyCollection(provider, data.offset, data.max, data.onlyUnidentified);
  });

/**
 * Reprocessa UM disco pela IA (texto) sob demanda — o botão "reprocessar" do card.
 * SOBRESCREVE artista/álbum/ano e descritivo com o que a IA identificar (sem apagar com vazio).
 */
export const reprocessCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string; provider?: string; mode?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return {
      id: input.id,
      provider: isAiProvider(input?.provider) ? input.provider : null,
      // "image" = identifica pela capa; "text" (padrão) = pelo nome do artista e álbum.
      mode: input?.mode === "image" ? ("image" as const) : ("text" as const),
    };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { reidentifyCollectionItem } = await import("./collection.server");
    return await reidentifyCollectionItem(data.id, provider, data.mode);
  });

/** Busca só a tracklist do disco pela IA (texto) e grava em `collection_items.tracklist`. */
export const fetchCollectionTracklistFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string; provider?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id, provider: isAiProvider(input?.provider) ? input.provider : null };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { fetchCollectionTracklist } = await import("./collection.server");
    return await fetchCollectionTracklist(data.id, provider);
  });

/**
 * Identifica pela IA (texto) um disco que ainda NÃO está na coleção — usado pelo diálogo
 * "Enviar para a coleção" em `/compras` para pré-preencher artista/álbum/ano/descritivo/tags a
 * partir do título da compra antes do usuário confirmar o envio. Não persiste nada.
 */
export const identifyPurchaseDraft = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | {
            title?: string;
            artist?: string;
            album?: string;
            year?: number | null;
            provider?: string;
          }
        | undefined,
    ) => {
      const title = typeof input?.title === "string" ? input.title : "";
      if (!title.trim()) throw new Error("título obrigatório");
      return {
        title,
        artist: typeof input?.artist === "string" ? input.artist : "",
        album: typeof input?.album === "string" ? input.album : "",
        year: input?.year == null ? null : Number(input.year) || null,
        provider: isAiProvider(input?.provider) ? input.provider : null,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { identifyDraftFromTitle } = await import("./collection.server");
    return await identifyDraftFromTitle(data, provider);
  });

/**
 * Adiciona um disco à coleção — manualmente, ou a partir do botão "Enviar para a coleção" em
 * `/compras` (nesse caso o payload traz `lotId`, vinculando à peça arrematada).
 */
export const addCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: Record<string, unknown> | undefined) => normalizeInput(input))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addCollectionItem: add } = await import("./collection.server");
    return await add(data);
  });

/** Importa vários discos de uma vez a partir do texto colado (JSON gerado por IA ou linhas). */
export const importCollectionText = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { text?: string } | undefined) => {
    const text = typeof input?.text === "string" ? input.text : "";
    if (!text.trim()) throw new Error("Cole o texto dos discos.");
    return { text };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { importCollectionText: importText } = await import("./collection.server");
    return await importText(data.text);
  });

/** Atualiza um disco da coleção (patch parcial). */
export const updateCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: (Record<string, unknown> & { id?: string }) | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id, ...normalizeInput(input) };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { updateCollectionItem: update } = await import("./collection.server");
    return await update(data);
  });

/** Remove um disco da coleção. */
export const deleteCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { deleteCollectionItem: remove } = await import("./collection.server");
    return await remove(data.id);
  });

/** Envia uma foto (data URL) ao Storage e devolve a URL pública para gravar em `image`. */
export const uploadCollectionImage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { dataUrl?: string } | undefined) => {
    if (!input?.dataUrl || typeof input.dataUrl !== "string") throw new Error("imagem obrigatória");
    return { dataUrl: input.dataUrl };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { uploadCollectionImage: upload } = await import("./collection.server");
    return await upload(data.dataUrl);
  });

/** Busca capas no Discogs (artista/álbum) para o usuário escolher a melhor. */
export const searchCollectionCovers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { artist?: string; album?: string } | undefined) => ({
    artist: typeof input?.artist === "string" ? input.artist : "",
    album: typeof input?.album === "string" ? input.album : "",
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { discogsConfigured, searchCoverOptions } = await import("./discogs.server");
    if (!discogsConfigured()) {
      throw new Error("Discogs não configurado (DISCOGS_TOKEN ausente).");
    }
    return await searchCoverOptions(data.artist, data.album);
  });

/** Baixa a capa escolhida (Discogs), comprime e grava; devolve a URL pública para `image`. */
export const importCollectionCover = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { url?: string } | undefined) => {
    if (!input?.url || typeof input.url !== "string") throw new Error("url obrigatória");
    return { url: input.url };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { importCollectionCover: run } = await import("./collection.server");
    return await run(data.url);
  });

/** Vínculos manuais lote → disco da Coleção ("já tenho"). Global. */
export const getCollectionLinks = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCollectionLinks } = await import("./app-state.server");
    return await getCollectionLinks();
  });

/** Aprendizado por assinatura (feedback das decisões). Global. */
export const getCollectionFeedback = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCollectionFeedback } = await import("./app-state.server");
    return await getCollectionFeedback();
  });

/** Termos negados como genéricos demais para casar a Coleção (ver `wantlist-match.ts`). */
export const getCollectionKeywordDenylist = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCollectionKeywordDenylist: read } = await import("./app-state.server");
    return await read();
  });

/**
 * Clique num termo do painel de relação → "este termo não deveria contar": nega o(s) termo(s)
 * que causaram um casamento errado com a Coleção (nunca esquece — read-modify-write).
 */
export const dismissCollectionMatchTerms = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { terms?: string[] } | undefined) => {
    const terms = Array.isArray(input?.terms)
      ? input.terms.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];
    if (!terms.length) throw new Error("terms obrigatório");
    return { terms };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addCollectionKeywordDenylist } = await import("./app-state.server");
    return await addCollectionKeywordDenylist(data.terms);
  });

/**
 * Aplica UMA decisão de relação lote↔Coleção e alimenta o aprendizado numa tacada:
 * - `value` = itemId (vincular) | false ("não tenho") | null (reativar automático);
 * - `sig` = como o disco apareceu no lote (para o aprendizado por assinatura).
 * Vincular → feedback `pos`; "não tenho" → feedback `neg`; reativar → remove o
 * feedback originado deste lote.
 */
export const applyCollectionDecision = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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

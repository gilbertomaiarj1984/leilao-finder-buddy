import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  return patch;
}

/** Coleção de vinil do usuário (collection_items). Best-effort: [] em erro. */
export const getCollection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; provider?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id, provider: isAiProvider(input?.provider) ? input.provider : null };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { reidentifyCollectionItem } = await import("./collection.server");
    return await reidentifyCollectionItem(data.id, provider);
  });

/**
 * Identifica pela IA (texto) um disco que ainda NÃO está na coleção — usado pelo diálogo
 * "Enviar para a coleção" em `/compras` para pré-preencher artista/álbum/ano/descritivo/tags a
 * partir do título da compra antes do usuário confirmar o envio. Não persiste nada.
 */
export const identifyPurchaseDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown> | undefined) => normalizeInput(input))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addCollectionItem: add } = await import("./collection.server");
    return await add(data);
  });

/** Importa vários discos de uma vez a partir do texto colado (JSON gerado por IA ou linhas). */
export const importCollectionText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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

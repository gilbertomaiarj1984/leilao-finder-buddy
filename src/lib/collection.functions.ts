import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PendingWonLot } from "@/lib/collection.server";

/** Normaliza um candidato duplicado vindo da UI (round-trip do resultado da varredura). */
function normalizePending(input: Record<string, unknown> | undefined): PendingWonLot {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const sn = (v: unknown) => (typeof v === "string" && v ? v : null);
  const lotId = s(input?.lotId);
  if (!lotId) throw new Error("lote inválido");
  return {
    lotId,
    artist: s(input?.artist),
    album: s(input?.album),
    title: s(input?.title),
    year: input?.year == null ? null : Number(input.year) || null,
    image: sn(input?.image),
    house: s(input?.house),
    uf: s(input?.uf),
    wonPrice: s(input?.wonPrice),
    wonDate: sn(input?.wonDate),
    marketLow: sn(input?.marketLow),
    marketHigh: sn(input?.marketHigh),
    sourceUrl: s(input?.sourceUrl),
    notes: s(input?.notes),
    tags: Array.isArray(input?.tags)
      ? input!.tags.filter((t): t is string => typeof t === "string")
      : [],
    existing: s(input?.existing),
  };
}

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

/** Varre "Minhas compras" (l=6) e acrescenta os vinis arrematados à coleção. */
export const scanCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { importWonLots } = await import("./collection.server");
    return await importWonLots();
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
    (input: { offset?: number; max?: number; onlyUnidentified?: boolean } | undefined) => ({
      offset: Math.max(Number(input?.offset) || 0, 0),
      max: Math.min(Math.max(Number(input?.max) || 12, 1), 25),
      // Padrão seguro/barato: só os não identificados. `false` só quando o cliente pede.
      onlyUnidentified: input?.onlyUnidentified !== false,
    }),
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { reidentifyCollection } = await import("./collection.server");
    return await reidentifyCollection(data.offset, data.max, data.onlyUnidentified);
  });

/** Diagnóstico da varredura (não grava): quantas peças/páginas/logado por aba. */
export const debugScanCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { debugPurchases } = await import("./leiloesbr-purchases.server");
    return await debugPurchases();
  });

/** Confirma um duplicado sinalizado pela varredura ("adicionar mesmo assim"). */
export const addWonLot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown> | undefined) => normalizePending(input))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addPendingWonLot } = await import("./collection.server");
    return await addPendingWonLot(data);
  });

/** Adiciona um disco manualmente à coleção. */
export const addCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown> | undefined) => normalizeInput(input))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addCollectionItem: add } = await import("./collection.server");
    return await add(data);
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

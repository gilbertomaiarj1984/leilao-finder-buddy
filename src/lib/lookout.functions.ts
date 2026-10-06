// Server functions do "Ficar de olho" (`lookout_items`). Ver `lookout.server.ts`.
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

const STATUSES = ["active", "acquired", "dismissed"] as const;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function yearOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? Math.trunc(n) : null;
}

/** Itens de olho (best-effort: [] em erro, para nunca derrubar a home). */
export const getLookout = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllLookout } = await import("./lookout.server");
      return await getAllLookout();
    } catch (error) {
      console.error("[lookout] não foi possível ler os itens", error);
      return [];
    }
  });

/** Vínculos por lote (confirmado/descartado). Best-effort: {}. */
export const getLookoutLinks = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getLookoutLinks: read } = await import("./lookout.server");
    return await read();
  });

/** Página `/olho` e contador do menu: itens + matches futuros + histórico de aparições. */
export const getLookoutOverview = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { history?: boolean } | undefined) => ({
    history: input?.history !== false,
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { computeLookout } = await import("./lookout-matches.server");
    return await computeLookout(data.history);
  });

/** Ficar de olho / desfazer, a partir de um lote (liga/desliga: já existe → remove). */
export const toggleLookout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | {
            lotId?: string;
            artist?: string;
            album?: string;
            year?: number | null;
            title?: string;
            house?: string;
            image?: string | null;
            url?: string;
            dayKey?: string;
            on?: boolean;
            itemId?: string;
          }
        | undefined,
    ) => {
      if (!input?.lotId || typeof input.lotId !== "string") throw new Error("lotId obrigatório");
      return {
        lotId: input.lotId,
        artist: str(input.artist),
        album: str(input.album),
        year: yearOrNull(input.year),
        title: str(input.title),
        house: str(input.house),
        image: typeof input.image === "string" && input.image ? input.image : null,
        url: str(input.url),
        dayKey: str(input.dayKey),
        on: input.on !== false,
        itemId: typeof input.itemId === "string" ? input.itemId : "",
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { addLookoutFromLot, deleteLookoutItem } = await import("./lookout.server");
    if (!data.on) {
      if (data.itemId) await deleteLookoutItem(data.itemId);
      return { item: null };
    }
    const { on: _on, itemId: _itemId, ...input } = data;
    return { item: await addLookoutFromLot(input) };
  });

/** Atualiza identidade, teto, nota ou status de um item. */
export const updateLookout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | {
            id?: string;
            artist?: string;
            album?: string;
            year?: number | null;
            maxPrice?: number | null;
            note?: string;
            status?: string;
          }
        | undefined,
    ) => {
      if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
      const patch: {
        id: string;
        artist?: string;
        album?: string;
        year?: number | null;
        maxPrice?: number | null;
        note?: string;
        status?: (typeof STATUSES)[number];
      } = { id: input.id };
      if (typeof input.artist === "string") patch.artist = input.artist;
      if (typeof input.album === "string") patch.album = input.album;
      if (input.year !== undefined) patch.year = yearOrNull(input.year);
      if (input.maxPrice !== undefined) {
        const n = Number(input.maxPrice);
        patch.maxPrice = input.maxPrice === null || !(n > 0) ? null : n;
      }
      if (typeof input.note === "string") patch.note = input.note;
      if (STATUSES.includes(input.status as (typeof STATUSES)[number])) {
        patch.status = input.status as (typeof STATUSES)[number];
      }
      return patch;
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { updateLookoutItem } = await import("./lookout.server");
    return await updateLookoutItem(data);
  });

/** Remove um item de olho. */
export const deleteLookout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { deleteLookoutItem } = await import("./lookout.server");
    return await deleteLookoutItem(data.id);
  });

/** Confirma (`itemId`), descarta (`false`) ou desfaz (`null`) o vínculo de UM lote com um item. */
export const setLookoutLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { lotId?: string; value?: string | false | null } | undefined) => {
    if (!input?.lotId || typeof input.lotId !== "string") throw new Error("lotId obrigatório");
    const v = input.value;
    if (v !== false && v !== null && typeof v !== "string") throw new Error("valor inválido");
    return { lotId: input.lotId, value: v };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setLookoutLink: save } = await import("./lookout.server");
    await save(data.lotId, data.value);
    return { ok: true as const };
  });

/** Marca matches como vistos (ao abrir a página): zera o contador "novos" do menu. */
export const markLookoutSeen = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { keys?: string[] } | undefined) => ({
    keys: Array.isArray(input?.keys)
      ? input.keys.filter((k): k is string => typeof k === "string").slice(0, 500)
      : [],
  }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    if (!data.keys.length) return { ok: true as const };
    const { markLookoutSeen: save } = await import("./lookout.server");
    await save(data.keys);
    return { ok: true as const };
  });

/**
 * Identifica pela IA (texto + imagem) o artista/álbum/ano de um item de olho — botão sob o lápis.
 * Gasta créditos de IA; só sob demanda. Ver `lookout-ident.server.ts`.
 */
export const identifyLookout = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id obrigatório");
    return { id: input.id };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { identifyLookoutItem } = await import("./lookout-ident.server");
    return await identifyLookoutItem(data.id);
  });

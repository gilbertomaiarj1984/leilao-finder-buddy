// Server functions da Sondagem (obras caçadas, `wantlist_items`).
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

/** Sondagem: rascunho de obras que o usuário caça (wantlist_items). Best-effort: [] em erro. */
export const getWantlist = createServerFn({ method: "GET" })
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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
  .middleware([requireAuth])
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

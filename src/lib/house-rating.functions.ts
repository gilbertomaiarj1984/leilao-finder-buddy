import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

import { EMPTY_RATINGS } from "./house-rating";

async function guard(context: { claims?: Record<string, unknown> }) {
  const { assertAllowed } = await import("./access.server");
  assertAllowed(context.claims?.["email"] as string | undefined);
}

/** Avaliações por compra + semáforo por casa. Best-effort: vazio em erro (feature acessória). */
export const getHouseRatings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await guard(context);
    try {
      const { getHouseRatings: read } = await import("./house-rating.server");
      return await read();
    } catch (error) {
      console.error("[house-rating] não foi possível ler", error);
      return EMPTY_RATINGS;
    }
  });

/** Salva a avaliação de uma compra; `level` ausente remove a avaliação. */
export const savePurchaseRating = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input: { purchaseId?: string; level?: string; tags?: string[]; note?: string } | undefined,
    ) => {
      if (!input?.purchaseId || typeof input.purchaseId !== "string") {
        throw new Error("Compra inválida.");
      }
      return input as { purchaseId: string; level?: string; tags?: string[]; note?: string };
    },
  )
  .handler(async ({ context, data }) => {
    await guard(context);
    const { sanitizeRating } = await import("./house-rating");
    const { setPurchaseRating } = await import("./house-rating.server");
    const rating = data.level ? sanitizeRating(data) : null;
    if (data.level && !rating) throw new Error("Nível inválido.");
    await setPurchaseRating(data.purchaseId, rating);
  });

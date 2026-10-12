import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

import { EMPTY_RATINGS } from "./house-rating";

async function guard(context: { claims?: Record<string, unknown> }) {
  const { assertAllowed } = await import("./access.server");
  assertAllowed(context.claims?.["email"] as string | undefined);
}

/** Avaliações por pregão + semáforo por casa. Best-effort: vazio em erro (feature acessória). */
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

/** Salva a avaliação de um pregão; `level` ausente remove a avaliação. */
export const savePregaoRating = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { idLeilao?: string; level?: string; tags?: string[]; note?: string } | undefined) => {
      if (!input?.idLeilao || typeof input.idLeilao !== "string") {
        throw new Error("Pregão inválido.");
      }
      return input as { idLeilao: string; level?: string; tags?: string[]; note?: string };
    },
  )
  .handler(async ({ context, data }) => {
    await guard(context);
    const { sanitizeRating } = await import("./house-rating");
    const { setPregaoRating } = await import("./house-rating.server");
    const rating = data.level ? sanitizeRating(data) : null;
    if (data.level && !rating) throw new Error("Nível inválido.");
    await setPregaoRating(data.idLeilao, rating);
  });

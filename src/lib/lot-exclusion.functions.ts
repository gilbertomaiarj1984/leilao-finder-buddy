import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Exclui um lote em definitivo (DELETE físico) e registra o aprendizado (keywords). */
export const excludeLot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lotId?: string; reason?: string } | undefined) => {
    if (!input?.lotId || typeof input.lotId !== "string") throw new Error("lotId obrigatório");
    return {
      lotId: input.lotId,
      reason:
        typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined,
    };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    const email = context.claims?.["email"] as string | undefined;
    assertAllowed(email);
    const { excludeLot: run } = await import("./lot-exclusion.server");
    return await run(data.lotId, { reason: data.reason, excludedBy: email });
  });

/** Lotes já excluídos (título + keywords), para o badge "possível lixo" na listagem. */
export const getExcludedLotsForMatching = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAllExcludedLots } = await import("./lot-exclusion.server");
    return await getAllExcludedLots();
  });

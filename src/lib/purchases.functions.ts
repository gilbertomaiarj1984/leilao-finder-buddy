import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Compras (vinil) gravadas em `purchases`, mais recente primeiro. Best-effort: [] em erro. */
export const getPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllPurchases } = await import("./purchases.server");
      return await getAllPurchases();
    } catch (error) {
      console.error("[purchases] não foi possível ler", error);
      return [];
    }
  });

/** Botão "Atualizar": dispara a mesma sync incremental do cron (leilões vencidos via `l=4`). */
export const scanPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { syncPurchasesIncremental } = await import("./purchases.server");
    return await syncPurchasesIncremental();
  });

/** Escape hatch: varredura completa manual de "Minhas compras" — cara, usar com moderação. */
export const scanPurchasesFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { syncPurchasesFull } = await import("./purchases.server");
    return await syncPurchasesFull();
  });

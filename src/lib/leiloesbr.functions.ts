import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { allowedEmail } = await import("./access.server");
    const email = String(context.claims?.["email"] ?? "").trim().toLowerCase();
    return { email, allowed: email === allowedEmail() };
  });

export const getVinylLots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { force?: boolean; day?: string } | undefined) => data ?? {})
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { scrapeVinylLots, invalidateLotsCache, refreshVinylDay } = await import(
      "./leiloesbr-scrape.server"
    );
    // Atualização por data: re-varre somente o dia informado e mescla no cache.
    if (data.force && data.day) return await refreshVinylDay(data.day);
    if (data.force) invalidateLotsCache();
    return await scrapeVinylLots();
  });

export const getLiveAuctions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listLiveAuctions } = await import("./leiloesbr-auctions.server");
    return await listLiveAuctions();
  });



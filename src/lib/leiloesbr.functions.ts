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
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
    return await scrapeVinylLots();
  });

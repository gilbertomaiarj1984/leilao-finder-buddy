import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listWatched = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listWatchedFromSite } = await import("./leiloesbr-watch.server");
    return await listWatchedFromSite();
  });

export const toggleWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { idPeca: string; idLeilao: string; base: string; watch: boolean }) => {
    if (!input?.idPeca || !input?.idLeilao) throw new Error("Lote inválido.");
    return {
      idPeca: String(input.idPeca),
      idLeilao: String(input.idLeilao),
      base: String(input.base ?? "0"),
      watch: Boolean(input.watch),
    };
  })
  .handler(async ({ data, context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { toggleWatchOnSite } = await import("./leiloesbr-watch.server");
    const watched = await toggleWatchOnSite(
      { idPeca: data.idPeca, idLeilao: data.idLeilao, base: data.base },
      data.watch,
    );
    return { watched };
  });

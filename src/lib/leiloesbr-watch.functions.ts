import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

/** Vigiados da conta. Cache de `ACCOUNT_CACHE_MS` no servidor; `force` (botão Atualizar) lê de novo. */
export const listWatched = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { force?: boolean } | undefined) => ({ force: input?.force === true }))
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { listWatchedFromSite } = await import("./leiloesbr-watch.server");
    const { ACCOUNT_CACHE_MS } = await import("./account-cache.server");
    return await listWatchedFromSite({ maxAgeMs: data.force ? 0 : ACCOUNT_CACHE_MS });
  });

export const toggleWatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
    const { toggleWatchOnSite, invalidateWatchedCache } = await import("./leiloesbr-watch.server");
    const { invalidateMyBidsCache } = await import("./leiloesbr-bids.server");
    try {
      const watched = await toggleWatchOnSite(
        { idPeca: data.idPeca, idLeilao: data.idLeilao, base: data.base },
        data.watch,
      );
      return { watched };
    } finally {
      // Senão a próxima leitura (até `ACCOUNT_CACHE_MS`) devolveria a conta de antes do toggle e
      // o acumulador da tela traria de volta o lote recém-desvigiado.
      invalidateWatchedCache();
      invalidateMyBidsCache();
    }
  });

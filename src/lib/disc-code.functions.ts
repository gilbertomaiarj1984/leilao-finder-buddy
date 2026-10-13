import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";
import { isAiProvider } from "./ai-provider";
import { parseDiscCode } from "./disc-code";

/** Consulta o Discogs pelo código (barras/catálogo) e devolve o release para pré-preencher o disco. */
export const lookupDiscCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { code?: string } | undefined) => {
    const code = parseDiscCode(typeof input?.code === "string" ? input.code : "");
    if (!code) throw new Error("Código inválido.");
    return { code };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { discogsConfigured, findReleaseByCode } = await import("./discogs.server");
    if (!discogsConfigured()) return { configured: false as const, info: null };
    return { configured: true as const, info: await findReleaseByCode(data.code) };
  });

/** Lê o código de uma FOTO (IA de visão): código de barras ou texto/número impresso. */
export const readDiscCodePhoto = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { image?: string; provider?: string } | undefined) => {
    if (!input?.image || typeof input.image !== "string") throw new Error("foto obrigatória");
    return { image: input.image, provider: isAiProvider(input?.provider) ? input.provider : null };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiProvider } = await import("./app-state.server");
    const provider = data.provider ?? (await getAiProvider());
    const { readDiscCodeFromPhoto } = await import("./disc-code.server");
    return await readDiscCodeFromPhoto(data.image, provider);
  });

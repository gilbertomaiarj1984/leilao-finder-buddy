import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

import type { PanelConfig } from "./ai-panel-config";

/** Configuração do painel de IA (blocos do prompt, correlação de condições, frete). */
export const getAiPanel = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<PanelConfig> => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getAiPanelConfig } = await import("./app-state.server");
    return await getAiPanelConfig();
  });

/** Grava a configuração (validada e normalizada no servidor). */
export const setAiPanel = createServerFn({ method: "POST" })
  .inputValidator((input: { config?: unknown } | undefined) => ({ config: input?.config ?? null }))
  .middleware([requireAuth])
  .handler(async ({ context, data }): Promise<{ config: PanelConfig; savedAt: string }> => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { setAiPanelConfig } = await import("./app-state.server");
    return await setAiPanelConfig(data.config);
  });

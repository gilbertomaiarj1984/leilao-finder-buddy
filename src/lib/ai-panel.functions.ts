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

/** Compras recebidas + retrato da IA da época + opinião do usuário (aba «Calibração»). */
export const getCalibration = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { getCalibrationRows } = await import("./calibration.server");
    return await getCalibrationRows();
  });

/** Grava a opinião do usuário sobre uma compra recebida (estado real, nota, valeu a pena, nota livre). */
export const saveCalibrationEntry = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (
      input:
        | {
            lotId?: string;
            realMedia?: string;
            realSleeve?: string;
            realScore?: number | null;
            verdict?: string;
            note?: string;
          }
        | undefined,
    ) => {
      if (!input?.lotId || typeof input.lotId !== "string") throw new Error("Lote inválido.");
      return {
        lotId: input.lotId,
        realMedia: typeof input.realMedia === "string" ? input.realMedia : "",
        realSleeve: typeof input.realSleeve === "string" ? input.realSleeve : "",
        realScore: typeof input.realScore === "number" ? input.realScore : null,
        verdict: typeof input.verdict === "string" ? input.verdict : "",
        note: typeof input.note === "string" ? input.note : "",
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { saveCalibration } = await import("./calibration.server");
    await saveCalibration(data);
    return { ok: true as const };
  });

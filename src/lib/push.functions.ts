import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

/** Estado do push para a UI: configurado no servidor? chave pública? quantos aparelhos? */
export const getPushStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { pushEnabled, vapidPublicKey, pushSubscriptionCount } = await import("./push.server");
    if (!pushEnabled()) return { enabled: false as const };
    return {
      enabled: true as const,
      publicKey: vapidPublicKey()!,
      devices: await pushSubscriptionCount(),
    };
  });

type SubscribeInput = { endpoint: string; p256dh: string; auth: string; userAgent?: string };

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: SubscribeInput | undefined) => {
    if (
      !input ||
      typeof input.endpoint !== "string" ||
      !/^https:\/\//.test(input.endpoint) ||
      typeof input.p256dh !== "string" ||
      typeof input.auth !== "string" ||
      !input.p256dh ||
      !input.auth
    ) {
      throw new Error("Inscrição de push inválida");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { saveSubscription } = await import("./push.server");
    await saveSubscription(data);
    return { ok: true as const };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { endpoint?: string } | undefined) => {
    if (!input?.endpoint || typeof input.endpoint !== "string")
      throw new Error("endpoint obrigatório");
    return { endpoint: input.endpoint };
  })
  .handler(async ({ context, data }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { removeSubscription } = await import("./push.server");
    await removeSubscription(data.endpoint);
    return { ok: true as const };
  });

/** Notificação de teste para todos os aparelhos inscritos (botão "Testar" da UI). */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { sendPushToAll } = await import("./push.server");
    return await sendPushToAll({
      title: "Garimpo de Vinil",
      body: "Avisos no aparelho funcionando ✔",
      url: "/",
      tag: "push-test",
    });
  });

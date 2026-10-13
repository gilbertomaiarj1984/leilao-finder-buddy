import webpush from "web-push";

import { db } from "@/lib/db-client.server";

/**
 * Web Push nativo (PWA, v0.138.0). Opcional como a IA/ntfy/e-mail: sem `VAPID_PUBLIC_KEY` +
 * `VAPID_PRIVATE_KEY` no .env do servidor tudo aqui é no-op. Gerar as chaves uma vez com
 * `bunx web-push generate-vapid-keys`. `VAPID_SUBJECT` (mailto:/https:) é opcional — cai no
 * `LEILOESBR_EMAIL`.
 */

type PushPayload = {
  title: string;
  body: string;
  /** Caminho aberto ao tocar na notificação (ex.: "/olho"). */
  url?: string;
  /** Notificações com a mesma tag se substituem (evita empilhar repetidas). */
  tag?: string;
};

type SubRow = { endpoint: string; p256dh: string; auth: string };

export function pushEnabled(): boolean {
  return Boolean(process.env["VAPID_PUBLIC_KEY"] && process.env["VAPID_PRIVATE_KEY"]);
}

export function vapidPublicKey(): string | null {
  return pushEnabled() ? (process.env["VAPID_PUBLIC_KEY"] ?? null) : null;
}

let configured = false;
function configure(): void {
  if (configured) return;
  const subject =
    process.env["VAPID_SUBJECT"] ||
    `mailto:${process.env["LEILOESBR_EMAIL"] || "admin@example.com"}`;
  webpush.setVapidDetails(
    subject,
    process.env["VAPID_PUBLIC_KEY"]!,
    process.env["VAPID_PRIVATE_KEY"]!,
  );
  configured = true;
}

async function listSubscriptions(): Promise<SubRow[]> {
  const { data, error } = await db.from("push_subscriptions").select("endpoint,p256dh,auth");
  if (error) throw error;
  return (data ?? []) as SubRow[];
}

/** Há push configurado E ao menos um aparelho inscrito (só então vale contar como canal). */
export async function pushReady(): Promise<boolean> {
  if (!pushEnabled()) return false;
  try {
    return (await listSubscriptions()).length > 0;
  } catch (error) {
    console.error("[push] falha ao listar inscrições", error);
    return false;
  }
}

export async function pushSubscriptionCount(): Promise<number> {
  return (await listSubscriptions()).length;
}

export async function saveSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<void> {
  const { error } = await db.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: (sub.userAgent ?? "").slice(0, 300),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

/**
 * Envia a todos os aparelhos inscritos. Inscrições expiradas (404/410) são apagadas. Devolve
 * quantos receberam; `sent === 0` com `total > 0` significa que nenhum entregou.
 */
export async function sendPushToAll(
  payload: PushPayload,
): Promise<{ total: number; sent: number; removed: number }> {
  if (!pushEnabled()) return { total: 0, sent: 0, removed: 0 };
  configure();
  const subs = await listSubscriptions();
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 12 * 60 * 60, urgency: "high", timeout: 15_000 },
        );
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.endpoint);
        else console.error("[push] falha ao enviar", status ?? error);
      }
    }),
  );
  if (dead.length) {
    const { error } = await db.from("push_subscriptions").delete().in("endpoint", dead);
    if (error) console.error("[push] falha ao apagar inscrições mortas", error);
  }
  return { total: subs.length, sent, removed: dead.length };
}

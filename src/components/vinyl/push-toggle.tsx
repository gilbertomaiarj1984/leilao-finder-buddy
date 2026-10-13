import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getPushStatus, sendTestPush, subscribePush, unsubscribePush } from "@/lib/push.functions";
import { cn } from "@/lib/utils";

// Liga/desliga o Web Push NESTE aparelho ("Avisos no aparelho"). Só aparece com o push
// configurado no servidor (VAPID_*), em produção (o service worker só registra lá) e em
// navegador com suporte (no iPhone: só com o app instalado na Tela de Início).

const STATUS_KEY = ["push-status"];

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return (
    import.meta.env.PROD &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushToggle({
  withLabel = false,
  className,
}: {
  withLabel?: boolean;
  className?: string;
}) {
  const fetchStatus = useServerFn(getPushStatus);
  const subscribe = useServerFn(subscribePush);
  const unsubscribe = useServerFn(unsubscribePush);
  const test = useServerFn(sendTestPush);
  const queryClient = useQueryClient();

  const [ok, setOk] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOk(supported()), []);

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchStatus(),
    enabled: ok,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      setSubscribed(Boolean(await reg.pushManager.getSubscription()));
    } catch {
      setSubscribed(false);
    }
  }, []);
  useEffect(() => {
    if (ok) void refresh();
  }, [ok, refresh]);

  if (!ok || !status.data?.enabled) return null;
  const publicKey = status.data.publicKey;
  const denied = typeof Notification !== "undefined" && Notification.permission === "denied";

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await unsubscribe({ data: { endpoint: existing.endpoint } });
        await existing.unsubscribe();
        toast("Avisos no aparelho desativados");
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast.error("Permissão de notificação negada — libere nas configurações do navegador.");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const json = sub.toJSON();
        await subscribe({
          data: {
            endpoint: sub.endpoint,
            p256dh: json.keys?.["p256dh"] ?? "",
            auth: json.keys?.["auth"] ?? "",
            userAgent: navigator.userAgent,
          },
        });
        const r = await test();
        toast.success(
          r.sent > 0
            ? "Avisos ativados — enviei um teste."
            : "Avisos ativados (teste não entregue).",
        );
      }
      await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } catch (error) {
      console.error(error);
      toast.error("Não consegui alterar os avisos neste aparelho.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const label = subscribed ? "Avisos no aparelho: ligados" : "Ativar avisos no aparelho";
  const Icon = subscribed ? Bell : BellOff;
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || denied}
      title={denied ? "Notificações bloqueadas no navegador" : label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 text-xs transition-colors hover:text-foreground disabled:opacity-50",
        subscribed ? "text-primary" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className={withLabel ? "h-4 w-4" : "h-3 w-3"} />
      {withLabel ? (denied ? "Notificações bloqueadas" : label) : null}
    </button>
  );
}

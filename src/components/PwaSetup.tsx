import { useEffect } from "react";
import { toast } from "sonner";

// PWA: registra o service worker (`public/sw.js`, só em produção — em `bun run dev` o HMR do
// Vite e o cache brigariam) e oferece a instalação uma única vez por navegador: Android/Chrome
// via `beforeinstallprompt`; iOS (sem esse evento) com a dica "Compartilhar → Tela de Início".

const HINT_KEY = "pwa-install-hint";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // sem localStorage, melhor não insistir a cada visita
  }
}

function markHintSeen() {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // best-effort
  }
}

export function PwaSetup() {
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Falha ao registrar o service worker", err);
      });
    }

    if (isStandalone() || hintSeen()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const ev = e as InstallPromptEvent;
      toast("Instalar o Garimpo no aparelho?", {
        description: "Abre em tela cheia, como um app, direto da tela inicial.",
        duration: 15000,
        action: {
          label: "Instalar",
          onClick: () => {
            void ev.prompt();
          },
        },
        onDismiss: markHintSeen,
        onAutoClose: markHintSeen,
      });
      window.addEventListener("appinstalled", markHintSeen, { once: true });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      toast("Instalar o Garimpo no iPhone/iPad", {
        description: "Toque em Compartilhar e depois em “Adicionar à Tela de Início”.",
        duration: 15000,
        onDismiss: markHintSeen,
        onAutoClose: markHintSeen,
      });
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return null;
}

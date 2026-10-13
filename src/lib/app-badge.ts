import { useEffect } from "react";

/**
 * Selo no ícone do app instalado (Badge API). O app aberto grava o número REAL (lances
 * superados + discos novos do "De olho"); com o app fechado o service worker soma 1 a cada push
 * (`public/sw.js`, mesma chave no cache `garimpo-meta`). Sem suporte do navegador é no-op.
 */
const META = "garimpo-meta";
const BADGE_KEY = "/__badge";

type BadgeNav = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useAppBadge(count: number): void {
  useEffect(() => {
    const nav = navigator as BadgeNav;
    const n = Math.max(0, Math.floor(count));
    if (nav.setAppBadge) {
      const p = n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.();
      p?.catch(() => {});
    }
    if ("caches" in window) {
      caches
        .open(META)
        .then((c) => c.put(BADGE_KEY, new Response(String(n))))
        .catch(() => {});
    }
  }, [count]);
}

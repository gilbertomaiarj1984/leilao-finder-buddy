import { useSyncExternalStore } from "react";

// Mesmo corte do breakpoint `sm` do Tailwind (640px): abaixo dele vale a interface de celular.
// No servidor e na hidratação o snapshot é sempre `false` (desktop), então o HTML inicial é o do
// desktop e a árvore mobile só entra depois da montagem — o desktop nunca é afetado.
const QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

import { useSyncExternalStore } from "react";

// Ponte entre a barra inferior (montada uma vez em `_authenticated/route.tsx`) e a home, que é
// quem sabe trocar de aba (Dias/Vigiados/Lances) e conhece os contadores e os controles de
// configuração (IA, "Atualizar tudo") que moram no Menu. A home registra aqui no efeito e limpa
// ao desmontar; nas demais telas o estado fica `null` e a barra navega por link.

export type HomeTab = "days" | "watched" | "bids";

type HomeNav = {
  tab: HomeTab;
  setTab: (tab: HomeTab) => void;
  watchedCount: number;
  bidsCount: number;
};

type State = { home: HomeNav | null; menuExtraHost: HTMLElement | null };

let state: State = { home: null, menuExtraHost: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function setHomeNav(home: HomeNav | null) {
  const cur = state.home;
  if (
    cur &&
    home &&
    cur.tab === home.tab &&
    cur.watchedCount === home.watchedCount &&
    cur.bidsCount === home.bidsCount
  ) {
    // Mesmo conteúdo visível: só troca o callback sem notificar (evita re-render à toa).
    state = { ...state, home };
    return;
  }
  set({ home });
}

export function setMenuExtraHost(el: HTMLElement | null) {
  if (state.menuExtraHost !== el) set({ menuExtraHost: el });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMobileNavState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

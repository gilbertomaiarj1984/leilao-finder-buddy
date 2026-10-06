import type { HomeTab } from "./mobile-nav-store";

// Funções puras da navegação mobile (testáveis sem DOM).

/** Aba da home (`day-N` | `watched` | `bids`) → item da barra inferior. */
export function homeTabOf(tab: string): HomeTab {
  return tab === "watched" ? "watched" : tab === "bids" ? "bids" : "days";
}

/** Telas acessadas pelo Menu (a barra destaca "Menu" quando uma delas está aberta). */
const MENU_ROUTES = [
  "/ao-vivo",
  "/analise",
  "/olho",
  "/colecao",
  "/compras",
  "/vinil-analytics",
] as const;

export function isMenuRoute(pathname: string): boolean {
  return MENU_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export type SavedHomeNav = { tab: string; dayPage: number; savedOn: string };

/**
 * Valor a gravar em `ui-state:home-nav` para a home abrir na aba pedida ao navegar de outra tela.
 * "Dias" mantém o último dia salvo (se havia um) ou volta para hoje.
 */
export function nextHomeNav(
  saved: SavedHomeNav | null,
  target: HomeTab,
  today: string,
  todayIndex: number,
  todayPage: number,
): SavedHomeNav {
  const dayPage = saved && Number.isInteger(saved.dayPage) ? saved.dayPage : todayPage;
  if (target === "days") {
    const keep = saved && /^day-\d+$/.test(saved.tab) && saved.savedOn === today;
    return keep
      ? { tab: saved.tab, dayPage, savedOn: today }
      : { tab: `day-${todayIndex}`, dayPage: todayPage, savedOn: today };
  }
  return { tab: target, dayPage, savedOn: today };
}

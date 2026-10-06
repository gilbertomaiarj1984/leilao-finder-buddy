import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Binoculars,
  CalendarDays,
  Eye,
  Gavel,
  Library,
  LayoutGrid,
  LogOut,
  Radio,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { TODAY_INDEX, TODAY_PAGE } from "@/lib/day-bar";
import { getAccessStatus } from "@/lib/leiloesbr.functions";
import { localDayKey } from "@/lib/persisted-state";
import { useLookoutOverviewQuery } from "@/lib/queries";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

import { BottomSheet } from "./bottom-sheet";
import { isMenuRoute, nextHomeNav, type SavedHomeNav } from "./mobile-nav-utils";
import { setMenuExtraHost, useMobileNavState, type HomeTab } from "./mobile-nav-store";

const HOME_NAV_KEY = "ui-state:home-nav";

// Telas acessadas pelo Menu (mesmos destinos dos botões do cabeçalho do desktop).
const MENU_TILES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/ao-vivo", label: "Ao vivo", icon: Radio },
  { to: "/analise", label: "Análise", icon: Sparkles },
  { to: "/olho", label: "De olho", icon: Binoculars },
  { to: "/colecao", label: "Coleção", icon: Library },
  { to: "/compras", label: "Compras", icon: ShoppingBag },
  { to: "/vinil-analytics", label: "Analytics", icon: BarChart3 },
];

function readSavedHomeNav(): SavedHomeNav | null {
  try {
    const raw = window.localStorage.getItem(HOME_NAV_KEY);
    return raw ? (JSON.parse(raw) as SavedHomeNav) : null;
  } catch {
    return null;
  }
}

/**
 * Barra de navegação inferior do celular (Dias, Vigiados, Lances, Menu) — montada uma vez em
 * `_authenticated/route.tsx` só na interface mobile. Na home troca de aba direto (a home se
 * registra em `mobile-nav-store`); nas outras telas grava a aba desejada onde a home lê ao
 * montar (`ui-state:home-nav`) e navega para `/`.
 */
export function MobileBottomNav() {
  const { home } = useMobileNavState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const lookoutNew = useLookoutOverviewQuery({ history: false }).data?.newCount ?? 0;

  const onHome = pathname === "/";
  const active: HomeTab | "menu" | null = isMenuRoute(pathname)
    ? "menu"
    : onHome
      ? (home?.tab ?? "days")
      : null;

  function go(target: HomeTab) {
    if (onHome && home) {
      home.setTab(target);
      window.scrollTo({ top: 0 });
      return;
    }
    try {
      const next = nextHomeNav(readSavedHomeNav(), target, localDayKey(), TODAY_INDEX, TODAY_PAGE);
      window.localStorage.setItem(HOME_NAV_KEY, JSON.stringify(next));
    } catch {
      // sem localStorage: a home abre no último estado conhecido.
    }
    void navigate({ to: "/" });
  }

  const items: { id: HomeTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: "days", label: "Dias", icon: CalendarDays },
    { id: "watched", label: "Vigiados", icon: Eye, count: home?.watchedCount },
    { id: "bids", label: "Lances", icon: Gavel, count: home?.bidsCount },
  ];

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 px-1.5 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:hidden"
      >
        {items.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            aria-current={active === id ? "page" : undefined}
            className={cn(
              "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] text-muted-foreground",
              active === id && "font-bold text-primary",
            )}
          >
            {active === id ? (
              <span className="absolute top-0 h-[3px] w-7 rounded-b bg-primary" aria-hidden />
            ) : null}
            <Icon className="h-5 w-5" />
            {label}
            {count ? (
              <span className="absolute top-1 left-[calc(50%+6px)] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {count}
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-current={active === "menu" ? "page" : undefined}
          className={cn(
            "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] text-muted-foreground",
            active === "menu" && "font-bold text-primary",
          )}
        >
          {active === "menu" ? (
            <span className="absolute top-0 h-[3px] w-7 rounded-b bg-primary" aria-hidden />
          ) : null}
          <LayoutGrid className="h-5 w-5" />
          Menu
          {lookoutNew > 0 ? (
            <span className="absolute top-2 left-[calc(50%+8px)] h-2 w-2 rounded-full bg-fuchsia-500" />
          ) : null}
        </button>
      </nav>
      <MobileMenuSheet open={menuOpen} onOpenChange={setMenuOpen} lookoutNew={lookoutNew} />
    </>
  );
}

function MobileMenuSheet({
  open,
  onOpenChange,
  lookoutNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookoutNew: number;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();
  const fetchAccess = useServerFn(getAccessStatus);
  const access = useQuery({
    queryKey: ["access-status"] as const,
    queryFn: () => fetchAccess(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    window.location.href = "/api/auth/logout";
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Menu">
      <div className="overflow-y-auto px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{access.data?.email ?? ""}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex min-h-9 items-center gap-1 px-1 font-medium text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MENU_TILES.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => onOpenChange(false)}
              aria-current={pathname === to ? "page" : undefined}
              className={cn(
                "relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-1 text-center text-xs font-semibold",
                pathname === to && "border-primary bg-primary/10",
              )}
            >
              <Icon className="h-6 w-6 text-primary" />
              {label}
              {to === "/olho" && lookoutNew > 0 ? (
                <span className="absolute top-1.5 right-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-bold text-white">
                  {lookoutNew}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
        {/* Controles que moram na home (modo/provedor de IA, "Atualizar tudo", "Atualizar
        relações", "Atualizado em…") entram aqui via portal — ver `index.tsx`. */}
        <div
          ref={setMenuExtraHost}
          className="mt-4 flex flex-col gap-3 text-xs text-muted-foreground"
        />
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Garimpo de Vinil · v{APP_VERSION}
        </p>
      </div>
    </BottomSheet>
  );
}

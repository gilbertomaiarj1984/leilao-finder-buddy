import { ChevronLeft, Disc3, Loader2, MoreVertical, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bidMatchesSearch, watchedMatchesSearch } from "@/components/vinyl/grouping";
import { DAY_PAGE, TODAY_INDEX, TODAY_PAGE } from "@/lib/day-bar";
import { isManuallyFinished } from "@/lib/manually-finished-auctions";
import { auctionDayPassed } from "@/lib/vinyl-parse";
import { cn } from "@/lib/utils";

import type { DashboardData } from "../dashboard/use-dashboard-data";
import { formatUpdatedAt } from "../dashboard/use-dashboard-data";
import { BottomSheet } from "./bottom-sheet";
import { homeTabOf } from "./mobile-nav-utils";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

/** Rótulo curto do cartão de dia: "Hoje" / "Ontem" / "Amanhã" ou o dia da semana. */
function weekdayLabel(dayKey: string, rel: number): string {
  if (rel === 0) return "Hoje";
  if (rel === 1) return "Amanhã";
  if (rel === -1) return "Ontem";
  const [y, m, d] = dayKey.split("-").map(Number);
  return WEEKDAY.format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))).replace(".", "");
}

/**
 * Cabeçalho do celular da home (substitui `DashboardHeader` abaixo de `sm`): marca + atualizar
 * rolando com a página; uma linha sticky com a faixa de dias em cartões (ou o título de
 * Vigiados/Lances), lupa e "⋯". Mantém os mesmos ganchos do desktop (`tabsBarRef`,
 * `setDayBarHost`, `setFinishedToggleHost`) — a barra de controles do dia (portal do `DayTab`)
 * aparece dentro da folha "⋯".
 */
export function MobileDashboardHeader({
  d,
  onSelectTab,
}: {
  d: DashboardData;
  onSelectTab: (tab: string) => void;
}) {
  const {
    tab,
    lots,
    barDays,
    visitedPages,
    pageLoading,
    setDayPage,
    matchesSearch,
    watched,
    bids,
    searchNorm,
    albumFor,
    search,
    setSearch,
    tabsBarRef,
    setDayBarHost,
    setFinishedToggleHost,
    refreshAll,
    refreshingAll,
    refreshPct,
    watchedViewDay,
    bidsViewDay,
    setWatchedViewDay,
    setBidsViewDay,
  } = d;
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState(search);
  const [actionsOpen, setActionsOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const kind = homeTabOf(tab);
  const loaded = !lots.isError && !lots.isLoading;
  const dayIndex = /^day-(\d+)$/.exec(tab)?.[1];
  const dayIdx = dayIndex === undefined ? null : Number(dayIndex);
  const day = dayIdx !== null ? barDays[dayIdx] : undefined;

  useEffect(() => setDraft(search), [search]);

  // Centraliza o dia escolhido na faixa (também ao voltar para a aba "Dias").
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (strip && el)
      strip.scrollTo({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2 });
  }, [tab, loaded, kind, searching]);

  const commit = (value: string) => setSearch(value);
  const watchedCount = (watched.data ?? []).filter((lot) =>
    watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
  ).length;
  const bidsCount = (bids.data ?? []).filter((bid) =>
    bidMatchesSearch(bid, searchNorm, albumFor(bid)),
  ).length;

  const searchButton = (
    <Button
      variant={search ? "default" : "outline"}
      size="icon"
      className="h-10 w-10 shrink-0 rounded-xl"
      onClick={() => setSearching(true)}
      aria-label="Buscar"
    >
      <Search className="h-5 w-5" />
    </Button>
  );

  return (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <Disc3 className="h-7 w-7 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-base font-bold text-foreground">Garimpo de Vinil</h1>
          {lots.data?.updatedAt ? (
            <p className="truncate text-[11px] text-muted-foreground">
              Atualizado: {formatUpdatedAt(lots.data.updatedAt)}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl"
          onClick={refreshAll}
          disabled={refreshingAll || lots.isFetching}
          aria-label="Atualizar tudo"
        >
          {refreshingAll ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RefreshCw className="h-5 w-5" />
          )}
        </Button>
        {refreshingAll && refreshPct !== null ? (
          <span className="text-xs tabular-nums text-muted-foreground">{refreshPct}%</span>
        ) : null}
      </div>

      <div
        ref={tabsBarRef}
        className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        {searching ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(draft);
                }
              }}
              placeholder="Título, artista, casa ou nº do lote"
              className="h-10 min-w-0 flex-1 rounded-xl text-sm"
              aria-label="Buscar"
              enterKeyHint="search"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl"
              onClick={() => {
                setDraft("");
                commit("");
                setSearching(false);
              }}
              aria-label="Fechar busca"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-2">
            {kind === "days" && loaded ? (
              <div
                ref={stripRef}
                role="tablist"
                aria-label="Dias"
                className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {barDays.map((dayKey, index) => {
                  const rel = index - TODAY_INDEX;
                  const selected = tab === `day-${index}`;
                  const pageVisited = visitedPages.includes(Math.floor(index / DAY_PAGE));
                  const count = !pageVisited
                    ? null
                    : pageLoading && Math.floor(index / DAY_PAGE) !== TODAY_PAGE
                      ? "…"
                      : (lots.data?.lots.filter(
                          (lot) =>
                            lot.dayKey === dayKey &&
                            (index < TODAY_INDEX ||
                              !(
                                auctionDayPassed(lot.dayKey) ||
                                isManuallyFinished(lot.idLeilao, lot.dayKey)
                              )) &&
                            matchesSearch(lot),
                        ).length ?? 0);
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => {
                        setDayPage(Math.floor(index / DAY_PAGE));
                        onSelectTab(`day-${index}`);
                      }}
                      className={cn(
                        "flex min-h-[52px] min-w-[54px] shrink-0 flex-col items-center justify-center rounded-xl border px-2 py-1 leading-tight",
                        rel < 0 &&
                          "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        rel > 0 &&
                          "border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300",
                        rel === 0 && "border-primary bg-card text-primary",
                        selected && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide">
                        {weekdayLabel(dayKey, rel)}
                      </span>
                      <span className="text-base font-bold tabular-nums">
                        {dayKey.slice(8, 10)}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          selected ? "text-primary-foreground/80" : "text-muted-foreground",
                        )}
                      >
                        {count === null ? "·" : `${count} lote${count === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <h2 className="min-w-0 flex-1 truncate pl-1 text-base font-bold text-foreground">
                {kind === "watched"
                  ? `Vigiados · ${watchedCount}`
                  : kind === "bids"
                    ? `Lances · ${bidsCount}`
                    : "Dias"}
              </h2>
            )}
            {searchButton}
            {kind === "days" ? (
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setActionsOpen(true)}
                aria-label="Ações do dia"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {kind === "days" && day ? (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            {
              label: "Todos os lotes",
              on: watchedViewDay !== day && bidsViewDay !== day,
              click: () => {
                setWatchedViewDay(null);
                setBidsViewDay(null);
              },
            },
            {
              label: "Vigiados do dia",
              on: watchedViewDay === day,
              click: () => {
                setBidsViewDay(null);
                setWatchedViewDay(watchedViewDay === day ? null : day);
              },
            },
            {
              label: "Lances do dia",
              on: bidsViewDay === day,
              click: () => {
                setWatchedViewDay(null);
                setBidsViewDay(bidsViewDay === day ? null : day);
              },
            },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={c.on}
              onClick={c.click}
              className={cn(
                "h-9 shrink-0 rounded-full border border-border bg-card px-3.5 text-xs",
                c.on && "border-primary bg-primary/10 font-semibold text-primary",
              )}
            >
              {c.label}
            </button>
          ))}
          {/* Alvo do botão "Incluir/Ocultar finalizados" (portal do DayTab). */}
          <div ref={setFinishedToggleHost} className="shrink-0" />
        </div>
      ) : null}

      <BottomSheet open={actionsOpen} onOpenChange={setActionsOpen} title="Ações do dia">
        <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <h3 className="px-4 pt-1 pb-1 text-sm font-semibold text-foreground">Controles do dia</h3>
          {/* Barra de controles do dia (portal do `DayTab`): vigiados/lances do dia, atualizar,
          "Analisar dia", filtro de artista e de status. */}
          <div ref={setDayBarHost} />
        </div>
      </BottomSheet>

      {kind === "days" && tab !== `day-${TODAY_INDEX}` && !searching ? (
        <button
          type="button"
          onClick={() => {
            setDayPage(TODAY_PAGE);
            onSelectTab(`day-${TODAY_INDEX}`);
          }}
          className="fixed bottom-[88px] left-1/2 z-40 flex h-10 -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-4 text-sm font-semibold text-background shadow-lg"
        >
          <ChevronLeft className="h-4 w-4" />
          Voltar para hoje
        </button>
      ) : null}
    </>
  );
}

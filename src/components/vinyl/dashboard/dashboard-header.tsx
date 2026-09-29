import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Library,
  LogOut,
  Radio,
  ShoppingBag,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { bidMatchesSearch, dayLabel, watchedMatchesSearch } from "@/components/vinyl/grouping";
import { BAR_PAGES, DAY_PAGE, TODAY_INDEX } from "@/lib/day-bar";
import { auctionFinished } from "@/lib/vinyl-parse";

import { LotSearchBox } from "./lot-search-box";
import type { DashboardData } from "./use-dashboard-data";

export function DashboardHeader({
  d,
  email,
  onSignOut,
}: {
  d: DashboardData;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const {
    barsHidden,
    headerRef,
    search,
    setSearch,
    lots,
    setDayBarHost,
    tabsBarRef,
    barDays,
    dayPage,
    setDayPage,
    pageLoading,
    matchesSearch,
    watched,
    searchNorm,
    albumFor,
    bids,
    setFinishedToggleHost,
  } = d;
  // Janela de dias visíveis (5 por vez, página `dayPage`); as setas paginam de 5 em 5 por
  // 2 páginas de histórico, a de hoje e 2 de futuro (`day-bar.ts`).
  const offset = dayPage * DAY_PAGE;
  const canPrev = dayPage > 0;
  const canNext = dayPage < BAR_PAGES - 1;
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      {/* Colapsa com o botão do topo (`MobileTopToggle`) — também no desktop agora.
      A lista de dias/abas (`TabsList`, logo abaixo) fica DE FORA, sempre visível, pra
      sempre dar pra trocar de dia/Vigiados/Lances mesmo com o resto escondido. */}
      <HideableBar hidden={barsHidden} collapseOnDesktop>
        <div ref={headerRef}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1 sm:py-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{email}</span>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut className="h-3 w-3" />
                Sair
              </button>
            </div>
            {/* No mobile a barra de ações rola na horizontal (uma linha), para o header sticky
          ficar baixo e não atrapalhar; no desktop volta a quebrar em linhas (flex-wrap). */}
            <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible">
              <Button
                variant="outline"
                size="sm"
                asChild
                title="Leilões ao vivo (pregão presencial)"
              >
                <Link to="/ao-vivo">
                  <Radio className="mr-2 h-4 w-4" />
                  Ao vivo
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild title="Análise de lotes com IA">
                <Link to="/analise">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Análise
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild title="Minha coleção de vinil">
                <Link to="/colecao">
                  <Library className="mr-2 h-4 w-4" />
                  Coleção
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild title="Minhas compras (vinil)">
                <Link to="/compras">
                  <ShoppingBag className="mr-2 h-4 w-4" />
                  Compras
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                asChild
                title="Preços de venda por artista e álbum"
              >
                <Link to="/vinil-analytics">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Analytics
                </Link>
              </Button>
              <LotSearchBox committed={search} onSearch={setSearch} onClear={() => setSearch("")} />
            </div>
          </div>

          {!lots.isError && !lots.isLoading ? (
            <div className="mx-auto max-w-6xl px-4 pb-1.5 sm:pb-2">
              {/* Alvo da barra de controles do dia (portal) — renderizada aqui, acima da
            lista de dias, em vez de sticky abaixo do header (ver dayBarHost). */}
              <div ref={setDayBarHost} />
            </div>
          ) : null}
        </div>
      </HideableBar>

      {!lots.isError && !lots.isLoading ? (
        <div
          ref={tabsBarRef}
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 pb-1.5 sm:pb-2"
        >
          {/* No mobile a lista de dias rola na horizontal (uma linha), evitando que o
          header sticky cresça por causa da quebra de linha; no desktop volta a
          quebrar em linhas (flex-wrap). Fica sempre visível (fora do HideableBar acima) —
          nunca esconde, mesmo com o resto do topo recolhido. */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!canPrev}
            onClick={() => setDayPage(dayPage - 1)}
            title="5 dias anteriores (histórico)"
            aria-label="5 dias anteriores"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <TabsList className="flex h-auto flex-nowrap justify-start gap-1 overflow-x-auto bg-secondary sm:flex-wrap sm:overflow-visible">
            {barDays.map((day, index) => {
              if (index < offset || index >= offset + DAY_PAGE) return null;
              return (
                <TabsTrigger key={day} value={`day-${index}`} className="shrink-0">
                  {dayLabel(day, index - TODAY_INDEX)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {pageLoading && (index < TODAY_INDEX || index >= TODAY_INDEX + DAY_PAGE)
                      ? "…"
                      : (lots.data?.lots.filter(
                          (lot) =>
                            lot.dayKey === day &&
                            // Dias passados (histórico) contam tudo — o leilão já acabou.
                            (index < TODAY_INDEX || !auctionFinished(lot.dayKey, lot.time)) &&
                            matchesSearch(lot),
                        ).length ?? 0)}
                  </span>
                </TabsTrigger>
              );
            })}
            <TabsTrigger value="watched" className="shrink-0">
              Vigiados
              <span className="ml-2 text-xs text-muted-foreground">
                {
                  (watched.data ?? []).filter((lot) =>
                    watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
                  ).length
                }
              </span>
            </TabsTrigger>
            <TabsTrigger value="bids" className="shrink-0">
              Lances
              <span className="ml-2 text-xs text-muted-foreground">
                {
                  (bids.data ?? []).filter((bid) =>
                    bidMatchesSearch(bid, searchNorm, albumFor(bid)),
                  ).length
                }
              </span>
            </TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!canNext}
            onClick={() => setDayPage(dayPage + 1)}
            title="Próximos 5 dias"
            aria-label="Próximos 5 dias"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* Alvo do portal do botão "Incluir/Ocultar finalizados" — ao final da faixa de
          dias, depois de "Lances" (ver finishedToggleHost). */}
          <div ref={setFinishedToggleHost} className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

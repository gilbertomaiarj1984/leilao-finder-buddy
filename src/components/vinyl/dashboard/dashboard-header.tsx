import { Link } from "@tanstack/react-router";
import { BarChart3, Library, LogOut, Radio, ShoppingBag, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { bidMatchesSearch, dayLabel, watchedMatchesSearch } from "@/components/vinyl/grouping";
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
    days,
    matchesSearch,
    watched,
    searchNorm,
    albumFor,
    bids,
    setFinishedToggleHost,
  } = d;
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
          <TabsList className="flex h-auto flex-nowrap justify-start gap-1 overflow-x-auto bg-secondary sm:flex-wrap sm:overflow-visible">
            {days.map((day, index) => (
              <TabsTrigger key={day} value={`day-${index}`} className="shrink-0">
                {dayLabel(day, index)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {lots.data?.lots.filter(
                    (lot) =>
                      lot.dayKey === day &&
                      !auctionFinished(lot.dayKey, lot.time) &&
                      matchesSearch(lot),
                  ).length ?? 0}
                </span>
              </TabsTrigger>
            ))}
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
          {/* Alvo do portal do botão "Incluir/Ocultar finalizados" — ao final da faixa de
          dias, depois de "Lances" (ver finishedToggleHost). */}
          <div ref={setFinishedToggleHost} className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

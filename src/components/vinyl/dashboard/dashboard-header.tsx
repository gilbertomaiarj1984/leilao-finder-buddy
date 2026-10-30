import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import {
  BarChart3,
  Binoculars,
  ChevronLeft,
  ChevronRight,
  Library,
  ListFilter,
  LogOut,
  PackageOpen,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { countUnsoldHouses } from "@/components/vinyl/use-today-unsold";
import {
  bidMatchesSearch,
  dayLabel,
  shortDayLabel,
  watchedMatchesSearch,
} from "@/components/vinyl/grouping";
import {
  BAR_PAGES,
  DAY_PAGE,
  FUTURE_LABEL,
  FUTURE_TAB,
  TODAY_INDEX,
  TODAY_PAGE,
} from "@/lib/day-bar";
import { useLookoutOverviewQuery } from "@/lib/queries";
import { auctionDayPassed } from "@/lib/vinyl-parse";

import { PushToggle } from "../push-toggle";
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
  // Contador de matches novos do "De olho" (versão leve: sem histórico de vendas). Best-effort —
  // sem itens ou em erro, o botão aparece sem selo.
  const lookoutNew = useLookoutOverviewQuery({ history: false }).data?.newCount ?? 0;
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
    setTab,
    pageLoading,
    matchesSearch,
    watchedList,
    searchNorm,
    albumFor,
    bids,
    setFinishedToggleHost,
    futureCount,
    todayUnsold,
    setUnsoldViewDay,
    setWatchedViewDay,
    setBidsViewDay,
    unsoldViewDay,
    noBidFilter,
    setNoBidFilter,
    tab,
  } = d;
  // Janela de dias visíveis (5 por vez, página `dayPage`); as setas paginam de 5 em 5 por
  // 2 páginas de histórico, a de hoje e 2 de futuro (`day-bar.ts`).
  // Casas de hoje (pregão encerrado ou em andamento) que já têm lote sem lance → contador do ícone.
  const unsoldHouses = countUnsoldHouses(todayUnsold, true);
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
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 py-1">
            {/* Uma linha só (botões compactos + busca + conta); quebra só se a janela for estreita. */}
            <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Análise de lotes com IA"
              >
                <Link to="/analise">
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Análise
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Discos que você quer muito — matches nos leilões por vir"
              >
                <Link to="/olho">
                  <Binoculars className="mr-1 h-3.5 w-3.5" />
                  De olho
                  {lookoutNew > 0 ? (
                    <span className="ml-1 rounded-full bg-fuchsia-500 px-1.5 text-[10px] font-bold leading-4 text-white">
                      {lookoutNew}
                    </span>
                  ) : null}
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Minha coleção de vinil"
              >
                <Link to="/colecao">
                  <Library className="mr-1 h-3.5 w-3.5" />
                  Coleção
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Minhas compras (vinil)"
              >
                <Link to="/compras">
                  <ShoppingBag className="mr-1 h-3.5 w-3.5" />
                  Compras
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Preços de venda por artista e álbum"
              >
                <Link to="/vinil-analytics">
                  <BarChart3 className="mr-1 h-3.5 w-3.5" />
                  Analytics
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                asChild
                title="Painel de IA: contexto, condições e frete"
              >
                <Link to="/ia-painel">
                  <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                  IA
                </Link>
              </Button>
              <LotSearchBox committed={search} onSearch={setSearch} onClear={() => setSearch("")} />
            </div>
            <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="max-w-[10rem] truncate" title={email}>
                {email}
              </span>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <LogOut className="h-3 w-3" />
                Sair
              </button>
              <PushToggle />
            </div>
          </div>

          {!lots.isError && !lots.isLoading ? (
            <div className="mx-auto max-w-6xl px-4 pb-1">
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
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 pb-1"
        >
          {/* No mobile a lista de dias rola na horizontal (uma linha), evitando que o
          header sticky cresça por causa da quebra de linha; no desktop volta a
          quebrar em linhas (flex-wrap). Fica sempre visível (fora do HideableBar acima) —
          nunca esconde, mesmo com o resto do topo recolhido. */}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={!canPrev}
            onClick={() => setDayPage(dayPage - 1)}
            title="5 dias anteriores (histórico)"
            aria-label="5 dias anteriores"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <TabsList className="flex h-auto flex-nowrap justify-start gap-0.5 overflow-x-auto bg-secondary p-0.5 sm:flex-wrap sm:overflow-visible">
            {barDays.map((day, index) => {
              if (index < offset || index >= offset + DAY_PAGE) return null;
              return (
                <Fragment key={day}>
                  <TabsTrigger
                    value={`day-${index}`}
                    title={dayLabel(day, index - TODAY_INDEX)}
                    className={
                      index < TODAY_INDEX
                        ? "shrink-0 px-2 py-0.5 text-xs bg-amber-500/10 text-amber-700 data-[state=active]:bg-amber-500/25 data-[state=active]:text-amber-800 dark:text-amber-300 dark:data-[state=active]:text-amber-200"
                        : index > TODAY_INDEX
                          ? "shrink-0 px-2 py-0.5 text-xs bg-sky-500/10 text-sky-700 data-[state=active]:bg-sky-500/25 data-[state=active]:text-sky-800 dark:text-sky-300 dark:data-[state=active]:text-sky-200"
                          : "shrink-0 px-2 py-0.5 text-xs"
                    }
                  >
                    {shortDayLabel(day, index - TODAY_INDEX)}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {pageLoading && (index < TODAY_INDEX || index >= TODAY_INDEX + DAY_PAGE)
                        ? "…"
                        : (lots.data?.lots.filter(
                            (lot) =>
                              lot.dayKey === day &&
                              // Dias passados (histórico) contam tudo — o leilão já acabou.
                              (index < TODAY_INDEX || !auctionDayPassed(lot.dayKey)) &&
                              matchesSearch(lot),
                          ).length ?? 0)}
                    </span>
                  </TabsTrigger>
                  {index === TODAY_INDEX && unsoldHouses > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setWatchedViewDay(null);
                        setBidsViewDay(null);
                        setUnsoldViewDay(unsoldViewDay === day ? null : day);
                        setTab(`day-${index}`);
                      }}
                      aria-pressed={unsoldViewDay === day}
                      title={`Lotes sem lance de hoje: ${unsoldHouses} casa(s) com pregão encerrado ou em andamento`}
                      aria-label={`Lotes sem lance de hoje (${unsoldHouses} casa(s))`}
                      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-bold outline outline-1 transition-colors ${
                        unsoldViewDay === day
                          ? "bg-primary text-primary-foreground outline-primary"
                          : "bg-card text-primary outline-primary/30 hover:bg-primary hover:text-primary-foreground"
                      }`}
                    >
                      <PackageOpen className="h-3.5 w-3.5" />
                      {unsoldHouses}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const on = noBidFilter && tab === `day-${index}`;
                      setWatchedViewDay(null);
                      setBidsViewDay(null);
                      setUnsoldViewDay(null);
                      setNoBidFilter(!on);
                      setTab(`day-${index}`);
                    }}
                    aria-pressed={noBidFilter && tab === `day-${index}`}
                    title="Filtrar a listagem: só lotes sem lance"
                    aria-label={`Filtrar ${dayLabel(day, index - TODAY_INDEX)}: só lotes sem lance`}
                    className={`inline-flex h-6 shrink-0 items-center rounded-md px-1.5 outline outline-1 transition-colors ${
                      noBidFilter && tab === `day-${index}`
                        ? "bg-emerald-500 text-white outline-emerald-500"
                        : "bg-card text-emerald-500 outline-emerald-500/30 hover:bg-emerald-500 hover:text-white"
                    }`}
                  >
                    <ListFilter className="h-3.5 w-3.5" />
                  </button>
                </Fragment>
              );
            })}
            <TabsTrigger
              value={FUTURE_TAB}
              className="shrink-0 px-2 py-0.5 text-xs bg-sky-500/10 text-sky-700 data-[state=active]:bg-sky-500/25 data-[state=active]:text-sky-800 dark:text-sky-300 dark:data-[state=active]:text-sky-200"
            >
              {FUTURE_LABEL}
              <span className="ml-1.5 text-[11px] text-muted-foreground">{futureCount}</span>
            </TabsTrigger>
            <TabsTrigger value="watched" className="shrink-0 px-2 py-0.5 text-xs">
              Vigiados
              <span className="ml-1.5 text-[11px] text-muted-foreground">
                {
                  watchedList.filter((lot) => watchedMatchesSearch(lot, searchNorm, albumFor(lot)))
                    .length
                }
              </span>
            </TabsTrigger>
            <TabsTrigger value="bids" className="shrink-0 px-2 py-0.5 text-xs">
              Lances
              <span className="ml-1.5 text-[11px] text-muted-foreground">
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
            className="h-7 w-7 shrink-0"
            disabled={!canNext}
            onClick={() => setDayPage(dayPage + 1)}
            title="Próximos 5 dias"
            aria-label="Próximos 5 dias"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => {
              setDayPage(TODAY_PAGE);
              setTab(`day-${TODAY_INDEX}`);
            }}
            title="Voltar para hoje"
            aria-label="Voltar para hoje"
          >
            Hoje
          </Button>
          {/* Alvo do portal do botão "Incluir/Ocultar finalizados" — ao final da faixa de
          dias, depois de "Lances" (ver finishedToggleHost). */}
          <div ref={setFinishedToggleHost} className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

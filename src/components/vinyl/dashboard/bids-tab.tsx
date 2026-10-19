import { ChevronDown, ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { BidStatBadges } from "@/components/vinyl/badges";
import { BidHouseSections, type BidCard } from "@/components/vinyl/bid-house-sections";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import {
  bidMatchesSearch,
  computeBidStats,
  dayLabel,
  groupWatchedByHouse,
} from "@/components/vinyl/grouping";

import { FUTURE_LABEL, FUTURE_TAB, isFutureDay } from "@/lib/day-bar";

import type { DashboardData } from "./use-dashboard-data";

/**
 * `futureOnly`: versão da aba "Dias Futuros" da barra de dias — só os lances de leilões depois
 * do último dia da barra, uma seção por dia. Sem ele (aba Lances), esses dias ficam juntos
 * numa última seção "Dias Futuros".
 */
export function BidsTab({ d, futureOnly = false }: { d: DashboardData; futureOnly?: boolean }) {
  const {
    bids,
    bidsWithHouseUrl,
    searchNorm,
    albumFor,
    bidDayKey,
    days,
    barDays,
    bidsDayOpen,
    barsHidden,
    stickyBelowHeader,
    setBidsDayOpen,
    pending,
    loteById,
    effectivePriceById,
    nextBidById,
    albumById,
    soldById,
    aiFor,
    marketFor,
    conditionFor,
    ownedFor,
    setOwnedPanelLot,
    closedHouseSections,
    toggleHouseSection,
    closeAllHouseSections,
    toggle,
  } = d;
  return (
    <TabsContent value={futureOnly ? FUTURE_TAB : "bids"} className="space-y-4">
      {futureOnly ? <h2 className="text-base font-semibold text-foreground">Lances</h2> : null}
      {bids.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : bids.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível ler os lances: {(bids.error as Error).message}
        </p>
      ) : (bids.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não deu lance em nenhum lote.</p>
      ) : (
        (() => {
          // A busca principal filtra os lances; o resultado é apresentado
          // separado por dia e casa de leilão, igual às abas de dia e vigiados.
          const lastBarDay = barDays[barDays.length - 1];
          const filtered = bidsWithHouseUrl.filter(
            (bid) =>
              (!futureOnly || isFutureDay(bidDayKey(bid), lastBarDay)) &&
              bidMatchesSearch(bid, searchNorm, albumFor(bid)),
          );
          if (filtered.length === 0 && futureOnly) {
            return (
              <p className="text-sm text-muted-foreground">
                Nenhum lance depois de {lastBarDay ? dayLabel(lastBarDay, 99) : "hoje"}.
              </p>
            );
          }
          if (filtered.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">Nenhum lance corresponde à busca.</p>
            );
          }
          const byDay = new Map<string, BidCard[]>();
          for (const bid of filtered) {
            const dayOfBid = bidDayKey(bid);
            const key = !futureOnly && isFutureDay(dayOfBid, lastBarDay) ? FUTURE_TAB : dayOfBid;
            const list = byDay.get(key) ?? [];
            list.push(bid);
            byDay.set(key, list);
          }
          // "Dias Futuros" vem depois do último dia; dias sem data ("") vão para o fim de tudo;
          // os demais em ordem crescente.
          const rank = (key: string) => (!key ? 2 : key === FUTURE_TAB ? 1 : 0);
          const dayKeys = [...byDay.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

          return (
            <div className="space-y-10">
              {dayKeys.map((dayKey) => {
                const dayBids = byDay.get(dayKey) ?? [];
                const idx = days.indexOf(dayKey);
                const label =
                  dayKey === FUTURE_TAB
                    ? FUTURE_LABEL
                    : dayKey
                      ? dayLabel(dayKey, idx >= 0 ? idx : 99)
                      : "Sem data";
                const houses = groupWatchedByHouse(dayBids);
                const isOpen = bidsDayOpen[dayKey] ?? (futureOnly || dayKey === days[0]);
                return (
                  <section key={dayKey || "sem-data"} className="space-y-6">
                    <HideableBar
                      hidden={barsHidden}
                      style={stickyBelowHeader}
                      className="z-10 -mx-4"
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setBidsDayOpen((prev) => ({ ...prev, [dayKey]: !isOpen }))}
                        className="flex w-full flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2 text-left backdrop-blur sm:py-3"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-sm font-semibold text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {dayBids.length} lance(s) em {houses.length} casa(s)
                        </span>
                        <BidStatBadges stats={computeBidStats(dayBids)} />
                      </button>
                    </HideableBar>
                    {isOpen ? (
                      <BidHouseSections
                        houses={houses}
                        pending={pending}
                        loteById={loteById}
                        priceById={effectivePriceById}
                        nextBidById={nextBidById}
                        albumById={albumById}
                        soldById={soldById}
                        aiFor={aiFor}
                        marketFor={marketFor}
                        conditionFor={conditionFor}
                        ownedFor={ownedFor}
                        onOpenOwned={(bid) => setOwnedPanelLot(bid)}
                        isHouseOpen={(house) => !closedHouseSections.has(`bids|${dayKey}|${house}`)}
                        onToggleHouse={(house) => toggleHouseSection(`bids|${dayKey}|${house}`)}
                        onCloseAll={() =>
                          closeAllHouseSections(houses.map((g) => `bids|${dayKey}|${g.house}`))
                        }
                        onToggle={(bid) => toggle.mutate(bid)}
                      />
                    ) : null}
                  </section>
                );
              })}
            </div>
          );
        })()
      )}
    </TabsContent>
  );
}

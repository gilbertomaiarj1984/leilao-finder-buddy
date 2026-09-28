import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, Radio } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { AuctionStatusInline, HouseStatBadges } from "@/components/vinyl/badges";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import {
  computeHouseStats,
  dayLabel,
  groupWatchedByHouse,
  houseAuctionInfo,
  watchedDateToKey,
  watchedMatchesSearch,
} from "@/components/vinyl/grouping";
import { LotCard } from "@/components/vinyl/lot-card";

import type { DashboardData } from "./use-dashboard-data";

export function WatchedTab({ d }: { d: DashboardData }) {
  const {
    watched,
    searchNorm,
    albumFor,
    days,
    watchedDayOpen,
    barsHidden,
    stickyBelowHeader,
    setWatchedDayOpen,
    closeAllHouseSections,
    closedHouseSections,
    toggleHouseSection,
    watchedIds,
    bidStatusById,
    currentPriceFor,
    myBidById,
    nextBidById,
    pending,
    aiFor,
    marketFor,
    conditionFor,
    demandFor,
    ownedFor,
    setOwnedPanelLot,
    editTags,
    soldById,
    toggle,
  } = d;
  return (
    <TabsContent value="watched" className="space-y-4">
      {watched.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : watched.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível ler os vigiados: {(watched.error as Error).message}
        </p>
      ) : (watched.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não está vigiando nenhum lote.</p>
      ) : (
        (() => {
          // A busca principal filtra os vigiados; o resultado é apresentado
          // separado por dia e casa de leilão, igual às abas de dia.
          const filtered = (watched.data ?? []).filter((lot) =>
            watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
          );
          if (filtered.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                Nenhum lote vigiado corresponde à busca.
              </p>
            );
          }
          const byDay = new Map<string, typeof filtered>();
          for (const lot of filtered) {
            const key = watchedDateToKey(lot.date) || lot.date || "";
            const list = byDay.get(key) ?? [];
            list.push(lot);
            byDay.set(key, list);
          }
          // Dias sem data ("") vão para o fim; os demais em ordem crescente.
          const dayKeys = [...byDay.keys()].sort((a, b) => {
            if (!a) return 1;
            if (!b) return -1;
            return a.localeCompare(b);
          });

          return (
            <div className="space-y-10">
              {dayKeys.map((dayKey) => {
                const dayLots = byDay.get(dayKey) ?? [];
                const idx = days.indexOf(dayKey);
                const label = dayKey ? dayLabel(dayKey, idx >= 0 ? idx : 99) : "Sem data";
                const houses = groupWatchedByHouse(dayLots);
                const isOpen = watchedDayOpen[dayKey] ?? dayKey === days[0];
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
                        onClick={() =>
                          setWatchedDayOpen((prev) => ({ ...prev, [dayKey]: !isOpen }))
                        }
                        className="flex w-full flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2 text-left backdrop-blur sm:py-3"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-sm font-semibold text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {dayLots.length} lote(s) vigiado(s) em {houses.length} casa(s)
                        </span>
                      </button>
                    </HideableBar>
                    {!isOpen ? null : (
                      <>
                        {houses.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              closeAllHouseSections(
                                houses.map((g) => `watched|${dayKey}|${g.house}`),
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                            Fechar todas
                          </button>
                        ) : null}
                        {houses.map((houseGroup) => {
                          const auctionInfo = houseAuctionInfo(dayKey, houseGroup.lots[0]);
                          const houseSectionKey = `watched|${dayKey}|${houseGroup.house}`;
                          const isHouseOpen = !closedHouseSections.has(houseSectionKey);
                          return (
                            <section key={houseGroup.house} className="space-y-3">
                              <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                                <button
                                  type="button"
                                  onClick={() => toggleHouseSection(houseSectionKey)}
                                  aria-expanded={isHouseOpen}
                                  className="flex items-center gap-2 text-left"
                                >
                                  {isHouseOpen ? (
                                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="text-xl font-semibold tracking-tight text-foreground">
                                    {houseGroup.house}
                                  </span>
                                </button>
                                <Badge variant="secondary">{houseGroup.lots.length} lote(s)</Badge>
                                <HouseStatBadges
                                  stats={computeHouseStats(
                                    houseGroup.lots,
                                    watchedIds,
                                    bidStatusById,
                                  )}
                                />
                                <AuctionStatusInline info={auctionInfo} />
                                <div className="ml-auto flex flex-wrap items-center gap-3">
                                  {auctionInfo?.presencialUrl ? (
                                    <a
                                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                      href={auctionInfo.presencialUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Acompanhar o pregão presencial desta casa"
                                    >
                                      <Radio className="h-3 w-3" /> pregão presencial
                                    </a>
                                  ) : null}
                                  <a
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                    href={auctionInfo?.catalogUrl ?? houseGroup.houseUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    site da casa <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              </div>
                              {isHouseOpen ? (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                  {houseGroup.lots.map((lot) => (
                                    <LotCard
                                      key={lot.id}
                                      lot={{
                                        ...lot,
                                        price: currentPriceFor(lot.id, lot.price),
                                        dayKey: watchedDateToKey(lot.date) || lot.date,
                                        watched: true,
                                        myBid: myBidById.get(lot.idPeca),
                                        nextBid: nextBidById.get(lot.id),
                                      }}
                                      busy={pending === lot.idPeca}
                                      ai={aiFor(lot)}
                                      market={marketFor(lot)}
                                      album={albumFor(lot)}
                                      condition={conditionFor(lot)}
                                      demand={demandFor(lot)}
                                      owned={ownedFor(lot)}
                                      onOpenOwned={() => setOwnedPanelLot(lot)}
                                      onEditTags={editTags(lot.id)}
                                      bidStatus={bidStatusById.get(lot.idPeca)}
                                      sold={soldById.get(lot.id)}
                                      onToggle={() =>
                                        toggle.mutate({
                                          idPeca: lot.idPeca,
                                          idLeilao: lot.idLeilao,
                                          base: lot.base,
                                          watch: false,
                                        })
                                      }
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </>
                    )}
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

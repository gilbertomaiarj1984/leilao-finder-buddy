import { ChevronDown, ChevronRight, ChevronUp, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { AuctionStatusInline, HouseStatBadges } from "@/components/vinyl/badges";
import {
  catalogAuctionInfo,
  catalogHasDay,
  computeHouseStats,
  dayLabel,
  groupWatchedByArtist,
  groupWatchedByHouseCatalog,
  watchedDateToKey,
  watchedMatchesSearch,
} from "@/components/vinyl/grouping";
import { LotCard } from "@/components/vinyl/lot-card";
import { PresencialOrUnsoldLink } from "@/components/vinyl/presencial-or-unsold-link";

import type { DashboardData } from "./use-dashboard-data";

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
  }`;

const smallButtonClass =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary";

/** "01/10" ou "01/10 a 03/10" (catálogo multi-dia) a partir dos dayKeys yyyy-mm-dd. */
function daysRangeLabel(dayKeys: string[]): string {
  const fmt = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
  if (dayKeys.length === 0) return "";
  const first = dayKeys[0]!;
  const last = dayKeys[dayKeys.length - 1]!;
  return first === last ? fmt(first) : `${fmt(first)} a ${fmt(last)}`;
}

export function WatchedTab({ d }: { d: DashboardData }) {
  const {
    watched,
    searchNorm,
    albumFor,
    days,
    closeAllHouseSections,
    openAllHouseSections,
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
  const [selectedDay, setSelectedDay] = useState<string>("all");
  // Visão: "casa" (padrão, casa → catálogo) ou "artista" (artista → cards com barra de origem).
  const [view, setView] = useState<"casa" | "artista">("casa");
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
          // A busca principal filtra os vigiados; o resultado é agrupado por casa e, dentro
          // dela, por catálogo (idLeilao) — um catálogo multi-dia aparece em todos os dias que
          // atravessa quando o organizador por dia está filtrando.
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
          const houses = groupWatchedByHouseCatalog(filtered);
          const dayKeys = [
            ...new Set(houses.flatMap((h) => h.catalogs.flatMap((c) => c.dayKeys))),
          ].sort();
          const activeDay = dayKeys.includes(selectedDay) ? selectedDay : "all";
          const lotCount = (day: string) =>
            houses.reduce(
              (sum, h) =>
                sum +
                h.catalogs
                  .filter((c) => day === "all" || catalogHasDay(c, day))
                  .reduce((n, c) => n + c.lots.length, 0),
              0,
            );
          const visible = houses
            .map((h) => ({
              ...h,
              multi: h.catalogs.length > 1,
              shown: h.catalogs.filter((c) => activeDay === "all" || catalogHasDay(c, activeDay)),
            }))
            .filter((h) => h.shown.length > 0);
          const catalogCount = visible.reduce((n, h) => n + h.shown.length, 0);
          // Visão por artista: catálogo (casa + idLeilao) → dias, para a barra de origem mostrar
          // o intervalo do catálogo inteiro (multi-dia) e não só o dia do lote.
          const catalogByKey = new Map(
            houses.flatMap((h) => h.catalogs.map((c) => [`${h.house}|${c.idLeilao}`, { h, c }])),
          );
          const catalogDays = new Map(
            houses.flatMap((h) => h.catalogs.map((c) => [`${h.house}|${c.idLeilao}`, c.dayKeys])),
          );
          const artistGroups = groupWatchedByArtist(
            filtered.filter(
              (lot) =>
                activeDay === "all" ||
                (catalogDays.get(`${lot.house}|${lot.idLeilao}`) ?? []).includes(activeDay),
            ),
          );
          const artistKey = (artist: string) => `watched|artista|${artist}`;
          const sectionKeys =
            view === "artista"
              ? artistGroups.map((g) => artistKey(g.artist))
              : visible.flatMap((h) => [
                  `watched|${h.house}`,
                  ...(h.multi ? h.shown.map((c) => `watched|${h.house}|${c.idLeilao}`) : []),
                ]);
          const renderCard = (lot: (typeof filtered)[number], withOrigin: boolean) => {
            const catDays = catalogDays.get(`${lot.house}|${lot.idLeilao}`) ?? [];
            return (
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
                origin={
                  withOrigin
                    ? {
                        house: lot.house,
                        idLeilao: lot.idLeilao,
                        days: catDays.length ? daysRangeLabel(catDays) : lot.date.slice(0, 5),
                        multiDay: catDays.length > 1,
                      }
                    : undefined
                }
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
            );
          };

          return (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visão">
                <span className="text-xs text-muted-foreground">Visão</span>
                <button
                  type="button"
                  aria-pressed={view === "casa"}
                  onClick={() => setView("casa")}
                  className={chipClass(view === "casa")}
                >
                  Por casa
                </button>
                <button
                  type="button"
                  aria-pressed={view === "artista"}
                  onClick={() => setView("artista")}
                  className={chipClass(view === "artista")}
                >
                  Por artista
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dia">
                <button
                  type="button"
                  aria-pressed={activeDay === "all"}
                  onClick={() => setSelectedDay("all")}
                  className={chipClass(activeDay === "all")}
                >
                  Todos
                  <span className="text-xs tabular-nums opacity-80">{lotCount("all")}</span>
                </button>
                {dayKeys.map((dayKey) => {
                  const idx = days.indexOf(dayKey);
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      aria-pressed={activeDay === dayKey}
                      onClick={() => setSelectedDay(dayKey)}
                      className={chipClass(activeDay === dayKey)}
                    >
                      {dayLabel(dayKey, idx >= 0 ? idx : 99)}
                      <span className="text-xs tabular-nums opacity-80">{lotCount(dayKey)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {view === "artista"
                    ? `${artistGroups.length} artista(s)`
                    : `${visible.length} casa(s) · ${catalogCount} catálogo(s)`}{" "}
                  · {lotCount(activeDay)} lote(s) vigiado(s)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openAllHouseSections(sectionKeys)}
                    className={smallButtonClass}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Abrir todas
                  </button>
                  <button
                    type="button"
                    onClick={() => closeAllHouseSections(sectionKeys)}
                    className={smallButtonClass}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    Fechar todas
                  </button>
                </div>
              </div>

              {view === "artista" ? (
                <div className="space-y-8">
                  {artistGroups.map((group) => {
                    const key = artistKey(group.artist);
                    const isOpen = !closedHouseSections.has(key);
                    return (
                      <section key={group.artist} className="space-y-3">
                        <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                          <button
                            type="button"
                            onClick={() => toggleHouseSection(key)}
                            aria-expanded={isOpen}
                            className="flex items-center gap-2 text-left"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="text-xl font-semibold tracking-tight text-foreground">
                              {group.artist}
                            </span>
                          </button>
                          <Badge variant="secondary">{group.lots.length} lote(s)</Badge>
                          <Badge variant="outline">{group.houseCount} casa(s)</Badge>
                          <HouseStatBadges
                            stats={computeHouseStats(group.lots, watchedIds, bidStatusById)}
                          />
                        </div>
                        {isOpen ? (
                          <>
                            <div className="divide-y divide-border rounded-md border border-border bg-card">
                              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Pregões envolvidos
                              </p>
                              {[...new Set(group.lots.map((l) => `${l.house}|${l.idLeilao}`))].map(
                                (ck) => {
                                  const entry = catalogByKey.get(ck);
                                  if (!entry) return null;
                                  const { h, c } = entry;
                                  const info = catalogAuctionInfo(c);
                                  return (
                                    <div
                                      key={ck}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm"
                                    >
                                      <span className="font-semibold text-foreground">
                                        {h.house}
                                      </span>
                                      <span className="font-medium">Pregão {c.idLeilao}</span>
                                      {c.dayKeys.length > 1 ? (
                                        <Badge variant="outline">multi-dia</Badge>
                                      ) : null}
                                      <span className="text-xs text-muted-foreground">
                                        {daysRangeLabel(c.dayKeys)}
                                      </span>
                                      <AuctionStatusInline info={info} />
                                      <div className="ml-auto flex flex-wrap items-center gap-3">
                                        {info?.presencialUrl ? (
                                          <PresencialOrUnsoldLink
                                            presencialUrl={info.presencialUrl}
                                            idLeilao={info.idLeilao}
                                            dayKey={info.dayKey}
                                            status={info.status}
                                          />
                                        ) : null}
                                        <a
                                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                          href={info?.catalogUrl ?? h.houseUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          ver catálogo <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </div>
                                    </div>
                                  );
                                },
                              )}
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {group.lots.map((lot) => renderCard(lot, true))}
                            </div>
                          </>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-8">
                  {visible.map((houseGroup) => {
                    const houseKey = `watched|${houseGroup.house}`;
                    const isHouseOpen = !closedHouseSections.has(houseKey);
                    const houseLots = houseGroup.shown.flatMap((c) => c.lots);
                    const single = houseGroup.multi ? null : houseGroup.shown[0]!;
                    const singleInfo = single ? catalogAuctionInfo(single) : null;
                    const grid = (lots: typeof houseLots) => (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {lots.map((lot) => renderCard(lot, false))}
                      </div>
                    );
                    return (
                      <section key={houseGroup.house} className="space-y-3">
                        <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                          <button
                            type="button"
                            onClick={() => toggleHouseSection(houseKey)}
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
                          <Badge variant="secondary">{houseLots.length} lote(s)</Badge>
                          {houseGroup.multi ? (
                            <Badge variant="outline">{houseGroup.shown.length} catálogos</Badge>
                          ) : null}
                          <HouseStatBadges
                            stats={computeHouseStats(houseLots, watchedIds, bidStatusById)}
                          />
                          {single ? (
                            <>
                              {single.dayKeys.length > 1 ? (
                                <>
                                  <Badge variant="outline">multi-dia</Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {daysRangeLabel(single.dayKeys)}
                                  </span>
                                </>
                              ) : null}
                              <AuctionStatusInline info={singleInfo} />
                              <div className="ml-auto flex flex-wrap items-center gap-3">
                                {singleInfo?.presencialUrl ? (
                                  <PresencialOrUnsoldLink
                                    presencialUrl={singleInfo.presencialUrl}
                                    idLeilao={singleInfo.idLeilao}
                                    dayKey={singleInfo.dayKey}
                                    status={singleInfo.status}
                                  />
                                ) : null}
                                <a
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  href={singleInfo?.catalogUrl ?? houseGroup.houseUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  site da casa <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </>
                          ) : (
                            <a
                              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              href={houseGroup.houseUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              site da casa <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {!isHouseOpen ? null : single ? (
                          grid(single.lots)
                        ) : (
                          <div className="space-y-6 border-l-2 border-border pl-3 sm:pl-5">
                            {houseGroup.shown.map((catalog) => {
                              const catKey = `watched|${houseGroup.house}|${catalog.idLeilao}`;
                              const isCatOpen = !closedHouseSections.has(catKey);
                              const info = catalogAuctionInfo(catalog);
                              return (
                                <div key={catalog.idLeilao} className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => toggleHouseSection(catKey)}
                                      aria-expanded={isCatOpen}
                                      className="flex items-center gap-2 text-left"
                                    >
                                      {isCatOpen ? (
                                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      )}
                                      <span className="text-base font-semibold text-foreground">
                                        Catálogo {catalog.idLeilao}
                                      </span>
                                    </button>
                                    <Badge variant="secondary">{catalog.lots.length} lote(s)</Badge>
                                    {catalog.dayKeys.length > 1 ? (
                                      <Badge variant="outline">multi-dia</Badge>
                                    ) : null}
                                    <span className="text-xs text-muted-foreground">
                                      {daysRangeLabel(catalog.dayKeys)}
                                    </span>
                                    <HouseStatBadges
                                      stats={computeHouseStats(
                                        catalog.lots,
                                        watchedIds,
                                        bidStatusById,
                                      )}
                                    />
                                    <AuctionStatusInline info={info} />
                                    <div className="ml-auto flex flex-wrap items-center gap-3">
                                      {info?.presencialUrl ? (
                                        <PresencialOrUnsoldLink
                                          presencialUrl={info.presencialUrl}
                                          idLeilao={info.idLeilao}
                                          dayKey={info.dayKey}
                                          status={info.status}
                                        />
                                      ) : null}
                                      <a
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                        href={info?.catalogUrl ?? houseGroup.houseUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        ver catálogo <ExternalLink className="h-3 w-3" />
                                      </a>
                                    </div>
                                  </div>
                                  {isCatOpen ? grid(catalog.lots) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()
      )}
    </TabsContent>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  GripVertical,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
  houseStatKind,
  watchedDateToKey,
  watchedMatchesSearch,
} from "@/components/vinyl/grouping";
import { LotCard } from "@/components/vinyl/lot-card";
import { PresencialOrUnsoldLink } from "@/components/vinyl/presencial-or-unsold-link";
import { useDragAutoScroll } from "@/components/vinyl/use-drag-autoscroll";
import {
  clearAnalyticsAlias,
  setAnalyticsArtistAlias,
  setAnalyticsSaleOverrides,
} from "@/lib/analytics.functions";
import { queryKeys, useAnalyticsAliasesQuery } from "@/lib/queries";

import type { DashboardData } from "./use-dashboard-data";
import { ConfirmMoveDialog, WatchedLotDialog, WatchedArtistDialog } from "./watched-artist-dialog";

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
  }`;

/** Intervalo do auto-refresh de vigiados + lances enquanto a aba Vigiados está aberta. */
const AUTO_REFRESH_MS = 60_000;

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
    houseBidFlags,
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
    tab,
    refreshWatchedAndBids,
    refreshingWatchedAndBids,
    statFilter,
    setStatFilter,
    toggleStatFilter,
  } = d;
  // Enquanto a aba Vigiados está aberta, atualiza vigiados + lances a cada minuto (silencioso).
  // A ref evita recriar o intervalo a cada render (a função fecha sobre as queries atuais).
  const refreshRef = useRef(refreshWatchedAndBids);
  refreshRef.current = refreshWatchedAndBids;
  useEffect(() => {
    if (tab !== "watched") return;
    const id = window.setInterval(() => {
      if (!document.hidden) refreshRef.current(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [tab]);
  const [selectedDay, setSelectedDay] = useState<string>("all");
  // Visão: "casa" (padrão, casa → catálogo) ou "artista" (artista → cards com barra de origem).
  const [view, setView] = useState<"casa" | "artista">("casa");
  // Correção do nome do artista (renomear/juntar) — mesmos apelidos do Analytics.
  const [editingArtist, setEditingArtist] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const aliasesQuery = useAnalyticsAliasesQuery();
  const runSetArtistAlias = useServerFn(setAnalyticsArtistAlias);
  const runClearAlias = useServerFn(clearAnalyticsAlias);
  const runSetSaleOverrides = useServerFn(setAnalyticsSaleOverrides);
  const curation = {
    artists: aliasesQuery.data?.artists ?? {},
    sales: aliasesQuery.data?.sales ?? {},
  };
  const artistAliases = curation.artists;
  // Mover lote, arrastar-e-soltar e confirmação do arrastar.
  const [editingLot, setEditingLot] = useState<string | null>(null);
  type DragItem = { kind: "artist"; artist: string } | { kind: "lot"; artist: string; id: string };
  const dragRef = useRef<DragItem | null>(null);
  const autoScroll = useDragAutoScroll();
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ item: DragItem; to: string } | null>(null);
  const patchArtistAliases = (fn: (map: Record<string, string>) => void) => {
    const prev = aliasesQuery.data;
    const artists = { ...(prev?.artists ?? {}) };
    fn(artists);
    queryClient.setQueryData(queryKeys.analyticsAliases, {
      albums: {},
      sales: {},
      excludedSales: {},
      excludedArtists: {},
      ...prev,
      artists,
    });
    return prev;
  };
  const applyArtistAlias = (sourceKeys: string[], name: string) => {
    const prev = patchArtistAliases((m) => {
      for (const k of sourceKeys) m[k] = name;
    });
    void runSetArtistAlias({ data: { sourceKeys, name } })
      .then(() => toast.success(`Artista atualizado: ${name}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.analyticsAliases, prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o artista");
      });
  };
  const clearArtistAlias = (sourceKeys: string[]) => {
    const prev = patchArtistAliases((m) => {
      for (const k of sourceKeys) delete m[k];
    });
    void Promise.all(sourceKeys.map((key) => runClearAlias({ data: { kind: "artist", key } })))
      .then(() => toast.success("Correção desfeita"))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.analyticsAliases, prev);
        toast.error((error as Error)?.message || "Não foi possível desfazer a correção");
      });
  };
  // Leva UM lote para outro artista (correção por lote; preserva o álbum já corrigido, se houver).
  const patchSales = (fn: (sales: Record<string, { artist?: string; album?: string }>) => void) => {
    const prev = aliasesQuery.data;
    const sales = { ...(prev?.sales ?? {}) };
    fn(sales);
    queryClient.setQueryData(queryKeys.analyticsAliases, {
      artists: {},
      albums: {},
      excludedSales: {},
      excludedArtists: {},
      ...prev,
      sales,
    });
    return prev;
  };
  const moveLot = (lotId: string, artistName: string) => {
    const album = curation.sales[lotId]?.album ?? "";
    const prev = patchSales((m) => {
      m[lotId] = { artist: artistName, ...(album ? { album } : {}) };
    });
    void runSetSaleOverrides({ data: { lotIds: [lotId], artist: artistName, album } })
      .then(() => toast.success(`Lote movido para ${artistName}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.analyticsAliases, prev);
        toast.error((error as Error)?.message || "Não foi possível mover o lote");
      });
  };
  const undoLotMove = (lotId: string) => {
    const prev = patchSales((m) => {
      delete m[lotId];
    });
    void runSetSaleOverrides({ data: { lotIds: [lotId], clear: true } })
      .then(() => toast.success("Correção do lote desfeita"))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.analyticsAliases, prev);
        toast.error((error as Error)?.message || "Não foi possível desfazer a correção");
      });
  };
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
          const filtered = (watched.data ?? []).filter(
            (lot) =>
              watchedMatchesSearch(lot, searchNorm, albumFor(lot)) &&
              (!statFilter || houseStatKind(lot.idPeca, watchedIds, bidStatusById) === statFilter),
          );
          if (filtered.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                Nenhum lote vigiado corresponde à busca{statFilter ? " e ao filtro" : ""}.{" "}
                {statFilter ? (
                  <button
                    type="button"
                    onClick={() => setStatFilter(null)}
                    className="text-primary hover:underline"
                  >
                    Limpar filtro
                  </button>
                ) : null}
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
            curation,
          );
          const artistKey = (key: string) => `watched|artista|${key}`;
          const sectionKeys =
            view === "artista"
              ? artistGroups.map((g) => artistKey(g.key))
              : visible.flatMap((h) => [
                  `watched|${h.house}`,
                  ...(h.multi ? h.shown.map((c) => `watched|${h.house}|${c.idLeilao}`) : []),
                ]);
          const renderCard = (
            lot: (typeof filtered)[number],
            withOrigin: boolean,
            fromKey = "",
          ) => {
            const catDays = catalogDays.get(`${lot.house}|${lot.idLeilao}`) ?? [];
            const card = (
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
                dateBar={
                  !withOrigin && catDays.length > 1
                    ? `${lot.date}${lot.time ? ` · ${lot.time}` : ""}`
                    : undefined
                }
                origin={
                  withOrigin
                    ? {
                        house: lot.house,
                        houseWinning: houseBidFlags.get(lot.house)?.winning,
                        houseCovered: houseBidFlags.get(lot.house)?.covered,
                        idLeilao: lot.idLeilao,
                        days: catDays.length ? daysRangeLabel(catDays) : lot.date.slice(0, 5),
                        multiDay: catDays.length > 1,
                        onMove: () => setEditingLot(lot.id),
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
            if (!withOrigin) return card;
            // Visão por artista: o card inteiro pode ser arrastado para outro artista.
            return (
              <div
                key={lot.id}
                draggable
                onDragStart={(e) => {
                  dragRef.current = { kind: "lot", artist: fromKey, id: lot.id };
                  autoScroll.start();
                  e.dataTransfer.setData("text/plain", lot.title);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                  setDropOver(null);
                }}
                className="flex min-w-0 flex-col [&>article]:flex-1"
              >
                {card}
              </div>
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
                <button
                  type="button"
                  onClick={() => refreshWatchedAndBids()}
                  disabled={refreshingWatchedAndBids}
                  title="Atualizar vigiados e lances agora (atualiza sozinho a cada minuto nesta tela)"
                  aria-label="Atualizar vigiados e lances"
                  className={`${chipClass(false)} disabled:opacity-60`}
                >
                  {refreshingWatchedAndBids ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Atualizar
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
                    const key = artistKey(group.key);
                    const isOpen = !closedHouseSections.has(key);
                    return (
                      <section key={group.key} className="space-y-3">
                        <div
                          draggable
                          onDragStart={(e) => {
                            dragRef.current = { kind: "artist", artist: group.key };
                            autoScroll.start();
                            e.dataTransfer.setData("text/plain", group.artist);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragRef.current = null;
                            setDropOver(null);
                          }}
                          onDragOver={(e) => {
                            const d = dragRef.current;
                            if (!d || d.artist === group.key) return;
                            e.preventDefault();
                            setDropOver(group.key);
                          }}
                          onDragLeave={() => setDropOver((cur) => (cur === group.key ? null : cur))}
                          onDrop={(e) => {
                            e.preventDefault();
                            const d = dragRef.current;
                            dragRef.current = null;
                            setDropOver(null);
                            if (d && d.artist !== group.key)
                              setPendingDrop({ item: d, to: group.key });
                          }}
                          className={`flex flex-wrap items-baseline gap-3 border-b pb-2 ${
                            dropOver === group.key
                              ? "rounded-md border-primary bg-primary/10"
                              : "border-border"
                          }`}
                        >
                          <GripVertical
                            className="h-4 w-4 shrink-0 cursor-grab self-center text-muted-foreground"
                            aria-hidden
                          />
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
                          <button
                            type="button"
                            onClick={() => setEditingArtist(group.key)}
                            title="Corrigir o nome do artista ou levá-lo para outro"
                            aria-label={`Corrigir artista ${group.artist}`}
                            className="text-muted-foreground transition-colors hover:text-primary"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <Badge variant="secondary">{group.lots.length} lote(s)</Badge>
                          <Badge variant="outline">{group.houseCount} casa(s)</Badge>
                          <HouseStatBadges
                            stats={computeHouseStats(group.lots, watchedIds, bidStatusById)}
                            active={statFilter}
                            onToggle={toggleStatFilter}
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
                              {group.lots.map((lot) => renderCard(lot, true, group.key))}
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
                            active={statFilter}
                            onToggle={toggleStatFilter}
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
                                      active={statFilter}
                                      onToggle={toggleStatFilter}
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
              {(() => {
                const choice = (g: (typeof artistGroups)[number]) => ({
                  key: g.key,
                  artist: g.artist,
                  sourceKeys: g.sourceKeys,
                  lots: g.lots.length,
                });
                const all = artistGroups.map(choice);
                const editing = artistGroups.find((g) => g.key === editingArtist);
                const lotOwner = artistGroups.find((g) => g.lots.some((l) => l.id === editingLot));
                const lotEdit = lotOwner?.lots.find((l) => l.id === editingLot);
                const pendingText = (() => {
                  if (!pendingDrop) return "";
                  const to = artistGroups.find((g) => g.key === pendingDrop.to);
                  const from = artistGroups.find((g) => g.key === pendingDrop.item.artist);
                  if (!to || !from) return "";
                  if (pendingDrop.item.kind === "artist") {
                    return `Levar o artista «${from.artist}» para «${to.artist}»? Os lotes passam a usar o nome ${to.artist}.`;
                  }
                  const item = pendingDrop.item;
                  const lot = from.lots.find((l) => l.id === item.id);
                  return `Mover o lote ${lot?.lote ?? ""} de ${from.artist} para ${to.artist}?`;
                })();
                return (
                  <>
                    {editing ? (
                      <WatchedArtistDialog
                        key={editing.key}
                        artist={choice(editing)}
                        all={all}
                        hasAlias={editing.sourceKeys.some((k) => k in artistAliases)}
                        onClose={() => setEditingArtist(null)}
                        onApply={applyArtistAlias}
                        onClear={clearArtistAlias}
                      />
                    ) : null}
                    {lotEdit && lotOwner ? (
                      <WatchedLotDialog
                        key={lotEdit.id}
                        lotLabel={`Lote ${lotEdit.lote} — ${lotEdit.title}`}
                        fromArtist={choice(lotOwner)}
                        all={all}
                        moved={curation.sales[lotEdit.id] !== undefined}
                        onClose={() => setEditingLot(null)}
                        onMove={(name) => moveLot(lotEdit.id, name)}
                        onUndo={() => undoLotMove(lotEdit.id)}
                      />
                    ) : null}
                    {pendingDrop && pendingText ? (
                      <ConfirmMoveDialog
                        message={pendingText}
                        onCancel={() => setPendingDrop(null)}
                        onConfirm={() => {
                          const { item, to } = pendingDrop;
                          setPendingDrop(null);
                          const toGroup = artistGroups.find((g) => g.key === to);
                          const fromGroup = artistGroups.find((g) => g.key === item.artist);
                          if (!toGroup || !fromGroup) return;
                          if (item.kind === "artist") {
                            applyArtistAlias(fromGroup.sourceKeys, toGroup.artist);
                          } else {
                            moveLot(item.id, toGroup.artist);
                          }
                        }}
                      />
                    ) : null}
                  </>
                );
              })()}
            </div>
          );
        })()
      )}
    </TabsContent>
  );
}

import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  Gavel,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { AuctionStatusInline, BidStatBadges, HouseStatBadges } from "@/components/vinyl/badges";
import { BidHouseSections } from "@/components/vinyl/bid-house-sections";
import { ArtistFilter, PriceFilter } from "@/components/vinyl/filters";
import {
  artistOptions,
  bidMatchesSearch,
  computeBidStats,
  computeHouseStats,
  dayLabel,
  groupByArtist,
  groupByHouse,
  groupWatchedByHouse,
  houseAnchor,
  houseAuctionInfo,
  matchesPriceRange,
  watchedDateToKey,
  watchedMatchesSearch,
  type HouseGroup,
} from "@/components/vinyl/grouping";
import { LotCard } from "@/components/vinyl/lot-card";
import { PresencialOrUnsoldLink } from "@/components/vinyl/presencial-or-unsold-link";
import { auctionFinished, UNCLASSIFIED_LABEL } from "@/lib/vinyl-parse";

import type { DashboardData } from "./use-dashboard-data";

export function DayTab({ d, day, index }: { d: DashboardData; day: string; index: number }) {
  // Aba de dia inativa: o Radix não renderiza o conteúdo (nem os portais lá dentro) de uma
  // `TabsContent` fora da aba ativa, então pula todo o filtro/agrupamento dos lotes dela —
  // antes os 5 dias eram recalculados a cada render da tela.
  if (d.tab !== `day-${index}`) return <TabsContent value={`day-${index}`} className="space-y-6" />;
  const {
    lots,
    watchedIds,
    effectiveArtist,
    bidStatusById,
    showFinishedDays,
    matchesSearch,
    artistFilter,
    watchedViewDay,
    watched,
    searchNorm,
    albumFor,
    bidsViewDay,
    bidsWithHouseUrl,
    bidDayKey,
    dayBarHost,
    refreshDay,
    refreshingDay,
    setBidsViewDay,
    setWatchedViewDay,
    refreshWatched,
    refreshingWatched,
    refreshBids,
    refreshingBids,
    analyzeScope,
    analyzing,
    setArtistFilter,
    finishedToggleHost,
    toggleShowFinished,
    closeAllHouseSections,
    closedHouseSections,
    toggleHouseSection,
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
    bids,
    loteById,
    effectivePriceById,
    albumById,
    searchScore,
    search,
    possibleTrashFor,
    setExcludeTarget,
    dismissTrashMutation,
    openHouses,
    verifiedHouses,
    houseArtist,
    housePrice,
    toggleVerified,
    toggleHouse,
    setHouseArtistFor,
    setHousePriceFor,
    closeAllHouses,
  } = d;
  const rawDay = (lots.data?.lots ?? [])
    .map((lot) => ({
      ...lot,
      watched: watchedIds.size ? watchedIds.has(lot.idPeca) : lot.watched,
      // Prioriza o artista identificado pela IA no agrupamento/filtro por artista.
      artist: effectiveArtist(lot),
    }))
    .filter((lot) => lot.dayKey === day);
  // "Finalizado" pra fins do toggle "Mostrar finalizados" NÃO conta vigiado/com
  // lance — esses o usuário está ativamente acompanhando (quer ver se vendeu,
  // valor final etc.), então continuam aparecendo na grade geral mesmo depois do
  // leilão encerrar, sem precisar abrir "Mostrar finalizados". Só o "resto" (sem
  // relação com o usuário) some por padrão.
  const isTracked = (lot: { idPeca: string; watched: boolean }) =>
    lot.watched || bidStatusById.has(lot.idPeca);
  const finishedCount = rawDay.filter(
    (lot) => auctionFinished(lot.dayKey, lot.time) && !isTracked(lot),
  ).length;
  const showFinished = showFinishedDays.has(day);
  // Por padrão esconde os finalizados (3h após o início); o usuário pode incluí-los.
  // A busca geral (searchNorm) filtra por título/artista/casa/nº do lote.
  const dayLots = (
    showFinished
      ? rawDay
      : rawDay.filter((lot) => isTracked(lot) || !auctionFinished(lot.dayKey, lot.time))
  ).filter(matchesSearch);
  const artists = artistOptions(dayLots);
  const globalActive = artistFilter !== "";
  const visibleLots = globalActive
    ? dayLots.filter((lot) => (lot.artist || UNCLASSIFIED_LABEL) === artistFilter)
    : dayLots;
  const groups = groupByHouse(visibleLots);
  const isWatchedView = watchedViewDay === day;
  // Vigiados do dia: a busca principal também filtra aqui.
  const watchedForDay = (watched.data ?? []).filter(
    (lot) =>
      watchedDateToKey(lot.date) === day && watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
  );
  // Vigiados do dia agrupados por casa e ordenados por nº do lote.
  const watchedByHouse = groupWatchedByHouse(watchedForDay);
  const isBidsView = bidsViewDay === day;
  // Lances do dia: a busca principal também filtra aqui.
  const bidsForDay = bidsWithHouseUrl.filter(
    (bid) => bidDayKey(bid) === day && bidMatchesSearch(bid, searchNorm, albumFor(bid)),
  );
  // Lances do dia agrupados por casa e ordenados por nº do lote.
  const bidsByHouse = groupWatchedByHouse(bidsForDay);

  return (
    <TabsContent value={`day-${index}`} className="space-y-6">
      {dayBarHost &&
        createPortal(
          <div className="space-y-3 border-t border-border px-4 py-2 sm:py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-foreground">{dayLabel(day, index)}</span>
              <button
                type="button"
                onClick={() => refreshDay(day)}
                disabled={refreshingDay === day}
                title="Forçar atualização deste dia"
                aria-label={`Forçar atualização de ${dayLabel(day, index)}`}
                className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
              >
                {refreshingDay === day ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBidsViewDay(null);
                  setWatchedViewDay((cur) => (cur === day ? null : day));
                }}
                title="Ver vigiados deste dia"
                aria-label={`Ver vigiados de ${dayLabel(day, index)}`}
                aria-pressed={isWatchedView}
                className={
                  isWatchedView
                    ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                    : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                }
              >
                <Eye className="h-3.5 w-3.5" />
                Vigiados do dia
                {watchedForDay.length ? (
                  <span className="ml-0.5 text-muted-foreground">{watchedForDay.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={refreshWatched}
                disabled={refreshingWatched}
                title="Forçar atualização dos vigiados (inclui status Vendido)"
                aria-label="Forçar atualização dos vigiados"
                className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
              >
                {refreshingWatched ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWatchedViewDay(null);
                  setBidsViewDay((cur) => (cur === day ? null : day));
                }}
                title="Ver lances deste dia"
                aria-label={`Ver lances de ${dayLabel(day, index)}`}
                aria-pressed={isBidsView}
                className={
                  isBidsView
                    ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                    : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                }
              >
                <Gavel className="h-3.5 w-3.5" />
                Lances do dia
                {bidsForDay.length ? (
                  <span className="ml-0.5 text-muted-foreground">{bidsForDay.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={refreshBids}
                disabled={refreshingBids}
                title="Forçar atualização dos lances (inclui status Vendido)"
                aria-label="Forçar atualização dos lances"
                className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
              >
                {refreshingBids ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => analyzeScope({ day })}
                disabled={analyzing !== null}
                title="Analisar com IA os lotes ainda não avaliados deste dia (sob demanda)"
                aria-label={`Analisar com IA ${dayLabel(day, index)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
              >
                {analyzing === day ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Analisar dia
              </button>
              {!isWatchedView && !isBidsView ? (
                <>
                  <ArtistFilter artists={artists} value={artistFilter} onChange={setArtistFilter} />
                  {artistFilter ? (
                    <Button variant="ghost" size="sm" onClick={() => setArtistFilter("")}>
                      Limpar filtro
                    </Button>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {visibleLots.length} lote(s) em {groups.length} casa(s)
                  </span>
                </>
              ) : isWatchedView ? (
                <span className="text-xs text-muted-foreground">
                  {watchedForDay.length} lote(s) vigiado(s) neste dia
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {bidsForDay.length} lance(s) neste dia
                  <BidStatBadges stats={computeBidStats(bidsForDay)} />
                </span>
              )}
            </div>
          </div>,
          dayBarHost,
        )}
      {finishedToggleHost &&
        !isWatchedView &&
        !isBidsView &&
        finishedCount > 0 &&
        createPortal(
          <Button variant="ghost" size="sm" onClick={() => toggleShowFinished(day)}>
            {showFinished
              ? `Ocultar finalizados (${finishedCount})`
              : `Incluir finalizados (${finishedCount})`}
          </Button>,
          finishedToggleHost,
        )}
      {isWatchedView ? (
        watched.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : watchedForDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lote vigiado neste dia.</p>
        ) : (
          <div className="space-y-8">
            {watchedByHouse.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  closeAllHouseSections(watchedByHouse.map((g) => `watched-day|${day}|${g.house}`))
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <ChevronUp className="h-3.5 w-3.5" />
                Fechar todas
              </button>
            ) : null}
            {watchedByHouse.map((houseGroup) => {
              const auctionInfo = houseAuctionInfo(day, houseGroup.lots[0]);
              const houseSectionKey = `watched-day|${day}|${houseGroup.house}`;
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
                      stats={computeHouseStats(houseGroup.lots, watchedIds, bidStatusById)}
                    />
                    <AuctionStatusInline info={auctionInfo} />
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      {auctionInfo?.presencialUrl ? (
                        <PresencialOrUnsoldLink
                          presencialUrl={auctionInfo.presencialUrl}
                          idLeilao={auctionInfo.idLeilao}
                        />
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
          </div>
        )
      ) : isBidsView ? (
        bids.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : bidsForDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lance neste dia.</p>
        ) : (
          <BidHouseSections
            houses={bidsByHouse}
            pending={pending}
            loteById={loteById}
            priceById={effectivePriceById}
            nextBidById={nextBidById}
            albumById={albumById}
            soldById={soldById}
            ownedFor={ownedFor}
            onOpenOwned={(bid) => setOwnedPanelLot(bid)}
            isHouseOpen={(house) => !closedHouseSections.has(`bids-day|${day}|${house}`)}
            onToggleHouse={(house) => toggleHouseSection(`bids-day|${day}|${house}`)}
            onCloseAll={() =>
              closeAllHouseSections(bidsByHouse.map((g) => `bids-day|${day}|${g.house}`))
            }
            onToggle={(bid) => toggle.mutate(bid)}
          />
        )
      ) : groups.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {searchNorm
              ? "Nenhum lote corresponde à busca neste dia."
              : artistFilter
                ? "Nenhum lote deste artista neste dia."
                : rawDay.length === 0
                  ? "Nenhum disco de vinil na varredura para este dia. Leilões que já estão ao vivo somem da listagem pública — tente “Atualizar tudo”."
                  : `Todos os ${finishedCount} leilão(ões) deste dia já começaram há mais de 3h.`}
          </p>
          {!artistFilter && rawDay.length > 0 && !showFinished ? (
            <Button variant="outline" size="sm" onClick={() => toggleShowFinished(day)}>
              Mostrar finalizados ({finishedCount})
            </Button>
          ) : null}
        </div>
      ) : searchNorm ? (
        // Busca ativa: lista única ordenada por relevância (mais exato →
        // parecido), em vez do agrupamento por casa, para o topo bater com o
        // que foi digitado.
        (() => {
          const ranked = [...visibleLots].sort((a, b) => searchScore(b) - searchScore(a));
          return (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {ranked.length} resultado(s) para “{search.trim()}”, dos mais parecidos aos menos.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ranked.map((lot) => (
                  <LotCard
                    key={lot.id}
                    lot={{
                      ...lot,
                      price: currentPriceFor(lot.id, lot.price),
                      lote: lot.lote || loteById.get(lot.idPeca) || "",
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
                    possibleTrash={possibleTrashFor(lot)}
                    onExclude={() => setExcludeTarget({ id: lot.id, title: lot.title })}
                    onDismissTrash={() => {
                      const signal = possibleTrashFor(lot);
                      if (signal) dismissTrashMutation.mutate(signal.matchedTerms);
                    }}
                    onToggle={() =>
                      toggle.mutate({
                        idPeca: lot.idPeca,
                        idLeilao: lot.idLeilao,
                        base: lot.base,
                        watch: !lot.watched,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          );
        })()
      ) : (
        (() => {
          const renderHouse = (group: HouseGroup) => {
            const houseKey = `${day}|${group.house}`;
            const isOpen = openHouses.has(houseKey);
            const isVerified = verifiedHouses.has(houseKey);
            const perArtist = globalActive ? "" : (houseArtist[houseKey] ?? "");
            const perPrice = housePrice[houseKey] ?? "";
            let houseLots = group.lots;
            if (perArtist)
              houseLots = houseLots.filter(
                (lot) => (lot.artist || UNCLASSIFIED_LABEL) === perArtist,
              );
            if (perPrice)
              houseLots = houseLots.filter((lot) => matchesPriceRange(lot.price, perPrice));
            const artistGroups = groupByArtist(houseLots);
            const auctionInfo = houseAuctionInfo(day, group.lots[0]);

            return (
              <section
                key={group.house}
                id={houseAnchor(group.house, index)}
                className="scroll-mt-32 space-y-4"
              >
                <div className="space-y-3 border-b border-border pb-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleVerified(houseKey)}
                      aria-pressed={isVerified}
                      title={
                        isVerified
                          ? "Casa verificada — clique para desmarcar"
                          : "Marcar casa como verificada"
                      }
                      aria-label={
                        isVerified
                          ? `Desmarcar ${group.house} como verificada`
                          : `Marcar ${group.house} como verificada`
                      }
                      className={
                        isVerified
                          ? "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-green-600 bg-green-600 text-white"
                          : "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-green-600 hover:text-green-600"
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => analyzeScope({ day, house: group.house })}
                      disabled={analyzing !== null}
                      title="Analisar com IA os lotes ainda não avaliados desta casa (sob demanda)"
                      aria-label={`Analisar com IA ${group.house}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                    >
                      {analyzing === houseKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Analisar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleHouse(houseKey)}
                      aria-expanded={isOpen}
                      className="flex items-center gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-2xl font-semibold tracking-tight text-foreground">
                        {group.house}
                      </span>
                    </button>
                    <Badge variant="secondary">{houseLots.length} lotes</Badge>
                    <HouseStatBadges
                      stats={computeHouseStats(houseLots, watchedIds, bidStatusById)}
                    />
                    <AuctionStatusInline info={auctionInfo} />
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      {auctionInfo?.presencialUrl ? (
                        <PresencialOrUnsoldLink
                          presencialUrl={auctionInfo.presencialUrl}
                          idLeilao={auctionInfo.idLeilao}
                        />
                      ) : null}
                      <a
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        href={auctionInfo?.catalogUrl ?? group.houseUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        site da casa <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  {isOpen ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <ArtistFilter
                        artists={artistOptions(group.lots)}
                        value={perArtist}
                        onChange={(next) => setHouseArtistFor(houseKey, next)}
                        disabled={globalActive}
                      />
                      <PriceFilter
                        value={perPrice}
                        onChange={(next) => setHousePriceFor(houseKey, next)}
                      />
                      {globalActive ? (
                        <span className="text-xs text-muted-foreground">
                          filtro de artista global ativo
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {isOpen ? (
                  <>
                    {artistGroups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum lote com esses filtros nesta casa.
                      </p>
                    ) : (
                      artistGroups.map((artistGroup) => (
                        <div key={artistGroup.artist} className="space-y-3">
                          <h3
                            className={
                              artistGroup.artist === UNCLASSIFIED_LABEL
                                ? "text-sm font-medium uppercase tracking-wider text-muted-foreground"
                                : "text-sm font-semibold uppercase tracking-wider text-primary"
                            }
                          >
                            {artistGroup.artist}
                            <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                              {artistGroup.lots.length}
                            </span>
                          </h3>
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {artistGroup.lots.map((lot) => (
                              <LotCard
                                key={lot.id}
                                lot={{
                                  ...lot,
                                  price: currentPriceFor(lot.id, lot.price),
                                  lote: lot.lote || loteById.get(lot.idPeca) || "",
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
                                possibleTrash={possibleTrashFor(lot)}
                                onExclude={() => setExcludeTarget({ id: lot.id, title: lot.title })}
                                onDismissTrash={() => {
                                  const signal = possibleTrashFor(lot);
                                  if (signal) dismissTrashMutation.mutate(signal.matchedTerms);
                                }}
                                onToggle={() =>
                                  toggle.mutate({
                                    idPeca: lot.idPeca,
                                    idLeilao: lot.idLeilao,
                                    base: lot.base,
                                    watch: !lot.watched,
                                  })
                                }
                              />
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          toggleHouse(houseKey);
                          requestAnimationFrame(() =>
                            document
                              .getElementById(houseAnchor(group.house, index))
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              }),
                          );
                        }}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        <ChevronUp className="h-4 w-4" />
                        Fechar {group.house}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            );
          };
          const verifiedGroups = groups.filter((group) =>
            verifiedHouses.has(`${day}|${group.house}`),
          );
          const unverifiedGroups = groups.filter(
            (group) => !verifiedHouses.has(`${day}|${group.house}`),
          );
          return (
            <>
              {groups.length > 1 ? (
                <button
                  type="button"
                  onClick={() => closeAllHouses(day)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  Fechar todas
                </button>
              ) : null}
              {unverifiedGroups.map(renderHouse)}
              {verifiedGroups.length ? (
                <div className="space-y-6 pt-4">
                  <h2 className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    <Check className="h-4 w-4 text-green-600" />
                    Já verificadas
                    <span className="font-normal normal-case tracking-normal">
                      {verifiedGroups.length} casa(s)
                    </span>
                  </h2>
                  {verifiedGroups.map(renderHouse)}
                </div>
              ) : null}
            </>
          );
        })()
      )}
    </TabsContent>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Binoculars,
  Disc3,
  Eye,
  Gavel,
  Building2,
  LayoutGrid,
  List,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoverageBar } from "@/components/vinyl/analise/coverage-bar";
import { AnaliseLotRow } from "@/components/vinyl/analise/lot-row";
import { useAnalyzeScope, useRepriceLots } from "@/components/vinyl/use-ai-actions";
import { useAuctionProgress, useNow } from "@/components/vinyl/use-auction-progress";
import { HouseLight } from "@/components/vinyl/house-light";
import { HouseUf } from "@/components/vinyl/house-uf";
import { RarityLegend } from "@/components/vinyl/ai-score";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { RARITY_LEGEND, lotEconomics } from "@/components/vinyl/ai-score-utils";
import { dayLabel } from "@/components/vinyl/grouping";
import { setLotTags } from "@/lib/ai.functions";
import {
  compareBy,
  gradeAtLeast,
  isPresetKey,
  isSortKey,
  PRESETS,
  SORT_KEYS,
  type PresetInput,
  type PresetKey,
  type RankInput,
  type SortKey,
} from "@/lib/analise-rank";
import { priceRoseSinceEval } from "@/lib/ai-reprice";
import { auctionChip, startsInMinutes } from "@/lib/analise-time";
import { useBidCoveredAlerts } from "@/lib/bid-alerts";
import { FUTURE_LABEL, FUTURE_TAB, isFutureDay } from "@/lib/day-bar";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import {
  queryKeys,
  useBidsQuery,
  useLotsQuery,
  usePastSalesBulk,
  useWatchedQuery,
} from "@/lib/queries";
import { useLotInsights, type LotInsight } from "@/lib/use-lot-insights";
import { bidIsWinning, normalizeForMatch, parsePrice, type VinylLot } from "@/lib/vinyl-parse";
import { saveAccum, WATCHED_ACCUM_STORAGE_KEY } from "@/lib/watched-accum";
import { OWNED_CONFIDENT_MIN } from "@/lib/wantlist-match";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise de Lotes — Garimpo de Vinil" }] }),
  component: AnalisePage,
});

/** Quantos lotes aparecem de uma vez; "Mostrar mais" soma outro bloco. */
const PAGE_SIZE = 30;

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Chip de filtro (liga/desliga) no mesmo formato dos botões da parte principal do site. */
function filterChipClass(active: boolean): string {
  return active
    ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
    : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50";
}

/** Um lote avaliado, com a conta do lance e o estado do acompanhamento já resolvidos. */
type AnaliseItem = RankInput &
  PresetInput & {
    score: number;
    /** A nota foi dada a um preço bem menor que o de hoje (`priceRoseSinceEval`). */
    stale: boolean;
    lot: VinylLot;
    insight: LotInsight;
    currentPrice: string;
    watched: boolean;
    bidStatus: string | null;
  };

function AnalisePage() {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle`, só no mobile — desde que a
  // versão anterior por scroll (`useHideOnScroll`) ficava piscando.
  const [barsHidden, setBarsHidden] = usePersistedState("analise-bars-hidden", false);
  usePersistedScroll("analise", true);

  const queryClient = useQueryClient();
  const runToggle = useServerFn(toggleWatch);
  const saveTags = useServerFn(setLotTags);

  // Filtros. O dia vem da barra de dias ("" = todos).
  const [search, setSearch] = usePersistedState("analise-search", "");
  const [houseFilter, setHouseFilter] = usePersistedState("analise-house", "");
  const [dayFilter, setDayFilter] = usePersistedState("analise-day", "");
  const [scoreMin, setScoreMin] = usePersistedState("analise-score-min", "");
  const [scoreMax, setScoreMax] = usePersistedState("analise-score-max", "");
  const [rarityFilter, setRarityFilter] = usePersistedState("analise-rarity", "");
  const [onlyLookout, setOnlyLookout] = usePersistedState("analise-only-lookout", false);
  const [onlyBid, setOnlyBid] = usePersistedState("analise-only-bid", false);
  const [onlyWatched, setOnlyWatched] = usePersistedState("analise-only-watched", false);
  const [dealFilter, setDealFilter] = usePersistedState("analise-deal", "");
  const [minCond, setMinCond] = usePersistedState("analise-min-cond", "");
  const [maxCost, setMaxCost] = usePersistedState("analise-max-cost", "");
  const [hideOwned, setHideOwned] = usePersistedState("analise-hide-owned", false);
  const [hideBadHouse, setHideBadHouse] = usePersistedState("analise-hide-bad-house", false);
  const [onlyPriced, setOnlyPriced] = usePersistedState("analise-only-priced", false);
  // Ordenação e visualização: o que o usuário deixou por último vira o padrão da próxima visita.
  const [sortRaw, setSort] = usePersistedState<string>("analise-sort", "score");
  const sort: SortKey = isSortKey(sortRaw) ? sortRaw : "score";
  const [viewRaw, setView] = usePersistedState<string>("analise-view", "list");
  const view: "list" | "cards" | "house" =
    viewRaw === "cards" ? "cards" : viewRaw === "house" ? "house" : "list";
  // Visão pronta (Garimpo do dia, Pechinchas…): também lembrada entre visitas.
  const [presetRaw, setPreset] = usePersistedState<string>("analise-preset", "");
  const preset: PresetKey | "" = isPresetKey(presetRaw) ? presetRaw : "";
  const [filtersOpen, setFiltersOpen] = usePersistedState("analise-filters-open", false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const onToggleOpen = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pending, setPending] = useState<string | null>(null);

  const lots = useLotsQuery();
  // Vigiados + meus lances: alimentam o filtro "Vigiados"/"Com lance", a borda
  // colorida das linhas, o status do lance e o botão de vigiar (mesma mecânica da página
  // principal). MESMO acumulador local de `index.tsx` (`@/lib/watched-accum`, MESMA chave de
  // `localStorage` e de query, `queryKeys.watched`/`queryKeys.bids`) — essas duas rotas
  // compartilham o `QueryClient` do app inteiro, então um `queryFn` aqui que apenas
  // SUBSTITUÍSSE (sem mesclar) sobrescreveria o acumulado da outra rota ao navegar entre elas,
  // fazendo os vigiados "sumirem depois de um tempo" mesmo sem o usuário ter desvigiado nada.
  const { query: watchedQuery, accumRef: watchedAccumRef } = useWatchedQuery();
  const { query: bidsQuery } = useBidsQuery();

  // Vigiar/desvigiar direto na lista — sincroniza com o LeilõesBR (igual aos cards).
  const toggle = useMutation({
    mutationFn: (lot: { idPeca: string; idLeilao: string; base: string; watch: boolean }) =>
      runToggle({ data: lot }),
    onMutate: (lot) => setPending(lot.idPeca),
    onSuccess: (result: { watched: boolean }, lot) => {
      // Desvigiar é a ÚNICA saída explícita do acumulador (mesma lógica de `index.tsx`) —
      // remove na hora, sem esperar o refetch, senão o card ficaria vigiado na tela mesmo
      // depois do usuário desvigiar.
      if (!result.watched) {
        watchedAccumRef.current!.delete(`${lot.idLeilao}-${lot.idPeca}`);
        saveAccum(WATCHED_ACCUM_STORAGE_KEY, watchedAccumRef.current!);
        queryClient.setQueryData(queryKeys.watched, [...watchedAccumRef.current!.values()]);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.watched });
      toast.success(result.watched ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível sincronizar a vigia"),
    onSettled: () => setPending(null),
  });

  // Edição manual de tags: atualiza o cache queryKeys.lotAi de forma otimista e persiste.
  const patchTags = (id: string, tags: string[]) =>
    queryClient.setQueriesData({ queryKey: queryKeys.lotAi }, (old: unknown) =>
      Array.isArray(old)
        ? old.map((r) => (r && (r as { id: string }).id === id ? { ...r, tags } : r))
        : old,
    );
  const saveTagsMut = useMutation({
    mutationFn: (v: { id: string; tags: string[] }) => saveTags({ data: v }),
    onMutate: (v: { id: string; tags: string[] }) => patchTags(v.id, v.tags),
    onSuccess: (res: { id: string; tags: string[] }) => {
      patchTags(res.id, res.tags);
      toast.success("Tags atualizadas");
    },
    onError: (e: Error) => {
      toast.error(e.message || "Não foi possível salvar as tags");
      void queryClient.invalidateQueries({ queryKey: queryKeys.lotAi });
    },
  });

  const allLots = useMemo(() => lots.data?.lots ?? [], [lots.data]);
  // Relógio da tela: o "começa em N min" e a visão "Começando logo" andam sozinhos.
  const nowMs = useNow();
  const nowMin = Math.floor(nowMs / 60_000);
  const { analyzing, analyzeDays } = useAnalyzeScope();
  const { repricing, repriceLots } = useRepriceLots();
  // Tudo que o app sabe de cada lote (nota, mercado, estado, Coleção, De olho, casa…).
  const { insightById, albumById, evaluated, lookoutCount, lookoutActiveItems } =
    useLotInsights(allLots);
  // Aviso (toast) quando um lote com lance vira "Coberto" — só com o app aberto, ver
  // `@/lib/bid-alerts`.
  useBidCoveredAlerts(bidsQuery.data, (id) => albumById.get(id) ?? null);

  const watchedIds = useMemo(
    () => new Set((watchedQuery.data ?? []).map((w) => w.idPeca)),
    [watchedQuery.data],
  );
  // Status do meu lance por peça (verde = ganhando, vermelho = coberto).
  const bidStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bidsQuery.data ?? []) map.set(b.idPeca, b.status);
    return map;
  }, [bidsQuery.data]);
  // Meu lance por peça: corrige o "Atual" quando estou vencendo (a listagem pública traz o
  // valor defasado — quem vence detém o maior lance).
  const myBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bidsQuery.data ?? []) if (b.myBid) map.set(b.idPeca, b.myBid);
    return map;
  }, [bidsQuery.data]);

  const onToggleWatch = (lot: VinylLot) =>
    toggle.mutate({
      idPeca: lot.idPeca,
      idLeilao: lot.idLeilao,
      base: lot.base,
      watch: !watchedIds.has(lot.idPeca),
    });
  const onEditTags = (id: string, tags: string[]) => saveTagsMut.mutate({ id, tags });

  const days = useMemo(() => lots.data?.days ?? [], [lots.data]);
  // Dia salvo que saiu da janela vira "Todos" (senão a lista ficaria vazia sem aba ativa).
  // Último dia da janela: o que vier depois cai no último botão, "Dias Futuros".
  const lastDay = days[days.length - 1];
  const activeDay = days.includes(dayFilter) || dayFilter === FUTURE_TAB ? dayFilter : "";

  const houses = useMemo(
    () =>
      [...new Set(allLots.map((l) => l.house).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [allLots],
  );

  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  // Vendas passadas (Analytics) dos lotes avaliados, numa chamada só.
  const evaluatedIds = useMemo(
    () => allLots.filter((l) => insightById.get(l.id)?.ai?.score != null).map((l) => l.id),
    [allLots, insightById],
  );
  const pastQuery = usePastSalesBulk(evaluatedIds);
  const pastById = pastQuery.data;

  // Um item por lote já avaliado, com a conta do lance feita sobre o valor ATUAL.
  const items = useMemo(() => {
    const out: AnaliseItem[] = [];
    for (const lot of allLots) {
      const insight = insightById.get(lot.id);
      const score = insight?.ai?.score ?? null;
      if (!insight || score === null) continue;
      const status = bidStatusById.get(lot.idPeca) ?? null;
      const myBid = myBidById.get(lot.idPeca);
      const currentPrice = status && bidIsWinning(status) && myBid ? myBid : lot.price;
      out.push({
        lot,
        insight,
        score,
        eco: lotEconomics(currentPrice, insight.market),
        dayKey: lot.dayKey,
        time: lot.time,
        want: insight.market?.want ?? null,
        have: insight.market?.have ?? null,
        currentPrice,
        watched: watchedIds.has(lot.idPeca),
        bidStatus: status,
        rarity: insight.ai?.rarity ?? null,
        radar: Boolean(insight.lookout) || Boolean(insight.ai?.matchesInterests),
        hasBid: status !== null,
        weakDisc: insight.condition.media !== null && !gradeAtLeast(insight.condition.media, "VG"),
        ownedConfident: Boolean(insight.owned && insight.owned.score >= OWNED_CONFIDENT_MIN),
        startsInMin: startsInMinutes(lot.dayKey, lot.time, nowMin * 60_000),
        // Só avisa quando a nota TEM preço gravado (nota antiga sem `eval_price` reavalia 1× pelo cron).
        stale:
          insight.ai?.evalPrice != null &&
          priceRoseSinceEval(insight.ai.evalPrice, parsePrice(currentPrice)),
      });
    }
    return out;
  }, [allLots, insightById, bidStatusById, myBidById, watchedIds, nowMin]);

  // Aplica os filtros SEM o dia — a barra de dias mostra a contagem de cada dia sobre este conjunto.
  const filteredAnyDay = useMemo(() => {
    const q = normalizeForMatch(search);
    const min = scoreMin.trim() ? Number(scoreMin) : null;
    const max = scoreMax.trim() ? Number(scoreMax) : null;
    const costMax = maxCost.trim() ? Number(maxCost) : null;
    const presetDef = PRESETS.find((p) => p.key === preset);
    return items.filter((it) => {
      const { lot, insight } = it;
      if (presetDef && !presetDef.test(it, todayKey)) return false;
      if (q && !normalizeForMatch(`${lot.title} ${insight.album ?? ""}`).includes(q)) return false;
      if (houseFilter && lot.house !== houseFilter) return false;
      if (onlyLookout && !insight.lookout) return false;
      if (onlyBid && !it.bidStatus) return false;
      if (onlyWatched && !it.watched) return false;
      if (rarityFilter && (insight.ai?.rarity ?? null) !== rarityFilter) return false;
      if (min !== null && it.score < min) return false;
      if (max !== null && it.score > max) return false;
      if (dealFilter && it.eco.deal !== dealFilter) return false;
      if (minCond && !gradeAtLeast(insight.condition.media, minCond)) return false;
      if (costMax !== null && Number.isFinite(costMax) && (it.eco.total ?? Infinity) > costMax)
        return false;
      if (hideOwned && insight.owned && insight.owned.score >= OWNED_CONFIDENT_MIN) return false;
      if (hideBadHouse && (insight.houseLevel === "vermelho" || insight.houseLevel === "laranja"))
        return false;
      if (onlyPriced && it.eco.ref === null) return false;
      return true;
    });
  }, [
    items,
    preset,
    todayKey,
    search,
    houseFilter,
    onlyLookout,
    onlyBid,
    onlyWatched,
    rarityFilter,
    scoreMin,
    scoreMax,
    dealFilter,
    minCond,
    maxCost,
    hideOwned,
    hideBadHouse,
    onlyPriced,
  ]);
  const sorted = useMemo(() => {
    const byDay = !activeDay
      ? filteredAnyDay
      : activeDay === FUTURE_TAB
        ? filteredAnyDay.filter((it) => isFutureDay(it.dayKey, lastDay))
        : filteredAnyDay.filter((it) => it.dayKey === activeDay);
    return [...byDay].sort(compareBy<AnaliseItem>(sort));
  }, [filteredAnyDay, activeDay, lastDay, sort]);

  // Mudou filtro, dia ou ordenação: volta para o primeiro bloco da lista.
  const listKey = `${filteredAnyDay.length}|${activeDay}|${sort}|${preset}`;
  useEffect(() => setLimit(PAGE_SIZE), [listKey]);
  const shown = sorted.slice(0, limit);

  const filtersActive = Boolean(
    preset ||
    search ||
    houseFilter ||
    activeDay ||
    scoreMin ||
    scoreMax ||
    rarityFilter ||
    onlyLookout ||
    onlyBid ||
    onlyWatched ||
    dealFilter ||
    minCond ||
    maxCost ||
    hideOwned ||
    hideBadHouse ||
    onlyPriced,
  );
  const resetFilters = () => {
    setPreset("");
    setSearch("");
    setHouseFilter("");
    setDayFilter("");
    setScoreMin("");
    setScoreMax("");
    setRarityFilter("");
    setOnlyLookout(false);
    setOnlyBid(false);
    setOnlyWatched(false);
    setDealFilter("");
    setMinCond("");
    setMaxCost("");
    setHideOwned(false);
    setHideBadHouse(false);
    setOnlyPriced(false);
  };
  const presetCounts = useMemo(
    () => new Map(PRESETS.map((p) => [p.key, items.filter((it) => p.test(it, todayKey)).length])),
    [items, todayKey],
  );
  // Cobertura da IA na janela do app + o que o botão "Analisar pendentes" avalia: o dia escolhido,
  // os dias depois do último da barra ("Dias Futuros") ou, em "Todos", os dias de hoje em diante.
  const pendingByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const lot of allLots) {
      if (insightById.get(lot.id)?.ai?.score != null) continue;
      map.set(lot.dayKey, (map.get(lot.dayKey) ?? 0) + 1);
    }
    return map;
  }, [allLots, insightById]);
  const analyzeDaysScope = useMemo(
    () =>
      [...pendingByDay.keys()]
        .filter((d) =>
          activeDay === FUTURE_TAB
            ? isFutureDay(d, lastDay)
            : activeDay
              ? d === activeDay
              : d >= todayKey,
        )
        .sort(),
    [pendingByDay, activeDay, lastDay, todayKey],
  );
  const pendingInScope = analyzeDaysScope.reduce((n, d) => n + (pendingByDay.get(d) ?? 0), 0);
  const scopeLabel = activeDay
    ? activeDay === FUTURE_TAB
      ? "nos dias futuros"
      : "neste dia"
    : "de hoje em diante";
  const staleItems = items.filter((it) => it.stale && it.dayKey >= todayKey);
  const bidCount = bidStatusById.size;
  const watchedCount = items.filter((it) => it.watched).length;

  // Barra de dias no formato da home: passados em âmbar, futuros em azul, hoje neutro.
  const relDay = (d: string) =>
    Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of filteredAnyDay) counts.set(it.dayKey, (counts.get(it.dayKey) ?? 0) + 1);
    return counts;
  }, [filteredAnyDay]);

  const coverageBar = (
    <CoverageBar
      rated={allLots.length - [...pendingByDay.values()].reduce((n, c) => n + c, 0)}
      total={allLots.length}
      pendingInScope={pendingInScope}
      scopeLabel={scopeLabel}
      analyzing={analyzing !== null}
      onAnalyze={() => analyzeDays(analyzeDaysScope)}
      staleCount={staleItems.length}
      repricing={repricing}
      onReprice={() =>
        repriceLots(
          staleItems.map((it) => ({
            id: it.lot.id,
            title: it.lot.title,
            price: it.currentPrice,
            house: it.lot.house,
            image: it.lot.image,
          })),
        )
      }
    />
  );

  // Agrupa o bloco visível por casa, na ordem em que cada casa aparece (a melhor posição manda).
  const houseGroups = useMemo(() => {
    const groups = new Map<string, { house: string; items: AnaliseItem[] }>();
    for (const it of shown) {
      const g = groups.get(it.lot.house) ?? { house: it.lot.house, items: [] };
      g.items.push(it);
      groups.set(it.lot.house, g);
    }
    return [...groups.values()];
  }, [shown]);
  const rankOf = new Map(shown.map((it, i) => [it.lot.id, i + 1]));
  const progressByAuction = useAuctionProgress(
    useMemo(() => shown.map((it) => it.lot), [shown]),
    todayKey,
    nowMs,
  );
  const renderRow = (it: AnaliseItem, variant: "list" | "cards") => (
    <AnaliseLotRow
      key={it.lot.id}
      lot={it.lot}
      insight={it.insight}
      eco={it.eco}
      currentPrice={it.currentPrice}
      rank={rankOf.get(it.lot.id) ?? 0}
      past={pastById?.[it.lot.id] ?? null}
      chip={auctionChip({
        dayKey: it.lot.dayKey,
        time: it.lot.time,
        lote: it.lot.lote,
        nowMs,
        progress: progressByAuction.get(`${it.lot.idLeilao}|${it.lot.dayKey}`) ?? null,
      })}
      stale={it.stale}
      open={openIds.has(it.lot.id)}
      onToggleOpen={onToggleOpen}
      days={days}
      watched={it.watched}
      bidStatus={it.bidStatus}
      busy={pending === it.lot.idPeca}
      variant={variant}
      onToggleWatch={onToggleWatch}
      onEditTags={onEditTags}
    />
  );

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <HideableBar hidden={barsHidden} className="top-0 z-30">
        <header className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild className="max-sm:hidden">
                  <Link to="/">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Link>
                </Button>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Análise de Lotes
                </h1>
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Todos os lotes avaliados em uma lista, com a conta do lance (lance + frete, teto e
                potencial contra o Discogs), estado do disco, “já tenho” e a situação da casa.
                Ordene por nota ou por melhor negócio. ⭐ = combina com seus interesses; 🎯 = está
                no De olho.{" "}
                {evaluated ? `${evaluated} lote(s) avaliado(s).` : "Ainda sem avaliações."}
              </p>
            </div>
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
              <Button variant="outline" size="sm" asChild>
                <Link to="/olho" title="De olho e meus interesses (perfil do colecionador)">
                  <Binoculars className="mr-2 h-4 w-4" />
                  De olho e interesses
                </Link>
              </Button>
            </div>
          </div>
        </header>
      </HideableBar>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {lots.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : lots.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
            Não foi possível ler os lotes: {(lots.error as Error).message}
          </p>
        ) : evaluated === 0 ? (
          <div className="space-y-4">
            {coverageBar}
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhum lote avaliado ainda. A avaliação roda em segundo plano (atualização periódica);
              use “Analisar pendentes” acima para avaliar agora, sob demanda.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {coverageBar}

            {/* ------- Visões prontas (contam sobre todos os lotes avaliados) ------- */}
            <section
              aria-label="Visões prontas"
              className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6"
            >
              {PRESETS.map((p) => {
                const active = preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPreset(active ? "" : p.key)}
                    aria-pressed={active}
                    title={p.hint}
                    className={`rounded-md border p-2.5 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary"
                    }`}
                  >
                    <span className="block text-xl font-bold tabular-nums">
                      {presetCounts.get(p.key) ?? 0}
                    </span>
                    <span
                      className={`text-xs ${active ? "font-semibold text-primary" : "text-muted-foreground"}`}
                    >
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </section>

            {/* ------- Filtros (barra de pesquisa) ------- */}
            <section className="rounded-md border border-border bg-card/40 p-3">
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                className="mb-2 flex w-full items-center gap-2 text-sm font-medium sm:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filtros{filtersActive ? " (ativos)" : ""}
                <span className="ml-auto text-xs text-muted-foreground">
                  {filtersOpen ? "recolher" : "mostrar"}
                </span>
              </button>
              <div
                className={`flex flex-wrap items-end gap-3 ${filtersOpen ? "" : "max-sm:hidden"}`}
              >
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Buscar título
                  </label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ex.: Tim Maia"
                    className="h-9 w-48"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Casa
                  </label>
                  <select
                    value={houseFilter}
                    onChange={(e) => setHouseFilter(e.target.value)}
                    className={`${selectClass} max-w-[16rem]`}
                  >
                    <option value="">Todas</option>
                    {houses.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Oportunidade
                  </label>
                  <select
                    value={dealFilter}
                    onChange={(e) => setDealFilter(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Qualquer</option>
                    <option value="barato">Barato</option>
                    <option value="justo">Justo</option>
                    <option value="caro">Caro</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Raridade
                  </label>
                  <select
                    value={rarityFilter}
                    onChange={(e) => setRarityFilter(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Todas</option>
                    {RARITY_LEGEND.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Disco mínimo
                  </label>
                  <select
                    value={minCond}
                    onChange={(e) => setMinCond(e.target.value)}
                    className={selectClass}
                    title="Só lotes com o estado do disco igual ou melhor (lote sem estado conhecido fica de fora)"
                  >
                    <option value="">Qualquer</option>
                    {["G+", "VG", "VG+", "NM"].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Nota (0–100)
                  </label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={scoreMin}
                      onChange={(e) => setScoreMin(e.target.value)}
                      placeholder="mín"
                      inputMode="numeric"
                      className="h-9 w-16"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      value={scoreMax}
                      onChange={(e) => setScoreMax(e.target.value)}
                      placeholder="máx"
                      inputMode="numeric"
                      className="h-9 w-16"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Custo total até
                  </label>
                  <Input
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                    placeholder="R$ (lance + frete)"
                    inputMode="numeric"
                    className="h-9 w-36"
                  />
                </div>
              </div>

              {/* Filtros liga/desliga no mesmo formato dos botões da página principal. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div
                  className={`flex flex-wrap items-center gap-2 ${filtersOpen ? "" : "max-sm:hidden"}`}
                >
                  <button
                    type="button"
                    onClick={() => setOnlyWatched((v) => !v)}
                    disabled={watchedCount === 0}
                    aria-pressed={onlyWatched}
                    className={filterChipClass(onlyWatched)}
                    title="Só os lotes que você está vigiando"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Vigiados
                    {watchedCount ? (
                      <span className="ml-0.5 text-muted-foreground">{watchedCount}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyBid((v) => !v)}
                    disabled={bidCount === 0}
                    aria-pressed={onlyBid}
                    className={filterChipClass(onlyBid)}
                  >
                    <Gavel className="h-3.5 w-3.5" />
                    Com lance
                    {bidCount ? (
                      <span className="ml-0.5 text-muted-foreground">{bidCount}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyLookout((v) => !v)}
                    disabled={lookoutActiveItems === 0}
                    aria-pressed={onlyLookout}
                    className={filterChipClass(onlyLookout)}
                  >
                    <Target className="h-3.5 w-3.5" />
                    Só De olho
                    {lookoutCount ? (
                      <span className="ml-0.5 text-muted-foreground">{lookoutCount}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHideOwned((v) => !v)}
                    aria-pressed={hideOwned}
                    className={filterChipClass(hideOwned)}
                    title="Esconde os discos que já estão na sua Coleção"
                  >
                    <Disc3 className="h-3.5 w-3.5" />
                    Ocultar já tenho
                  </button>
                  <button
                    type="button"
                    onClick={() => setHideBadHouse((v) => !v)}
                    aria-pressed={hideBadHouse}
                    className={filterChipClass(hideBadHouse)}
                    title="Esconde lotes de casas com semáforo laranja ou vermelho"
                  >
                    Ocultar casas ruins
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyPriced((v) => !v)}
                    aria-pressed={onlyPriced}
                    className={filterChipClass(onlyPriced)}
                    title="Só lotes com preço de referência no Discogs"
                  >
                    Só com mercado
                  </button>
                  {filtersActive ? (
                    <Button variant="ghost" size="sm" onClick={resetFilters}>
                      <X className="mr-1 h-4 w-4" />
                      Limpar
                    </Button>
                  ) : null}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Ordenar por
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      className={selectClass}
                      aria-label="Ordenar por"
                    >
                      {SORT_KEYS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    className="inline-flex overflow-hidden rounded-md border border-border"
                    role="group"
                    aria-label="Visualização"
                  >
                    <button
                      type="button"
                      onClick={() => setView("list")}
                      aria-pressed={view === "list"}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <List className="h-3.5 w-3.5" /> Lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("cards")}
                      aria-pressed={view === "cards"}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium ${view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" /> Cards
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("house")}
                      aria-pressed={view === "house"}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium ${view === "house" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <Building2 className="h-3.5 w-3.5" /> Por casa
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {sorted.length} lote(s) no filtro, ordenados por{" "}
                  {SORT_KEYS.find((s) => s.key === sort)?.label.toLowerCase()}.
                  {lookoutActiveItems
                    ? ` ${lookoutCount} casam com o De olho (${lookoutActiveItems} disco(s) na lista).`
                    : ""}
                </p>
                <RarityLegend />
              </div>
            </section>

            {/* ------- Barra de dias (mesmo formato da página principal) ------- */}
            <Tabs
              value={activeDay || "all"}
              onValueChange={(v) => setDayFilter(v === "all" ? "" : v)}
            >
              <TabsList className="flex h-auto flex-nowrap justify-start gap-1 overflow-x-auto bg-secondary sm:flex-wrap sm:overflow-visible">
                <TabsTrigger value="all" className="shrink-0">
                  Todos
                  <span className="ml-2 text-xs text-muted-foreground">
                    {filteredAnyDay.length}
                  </span>
                </TabsTrigger>
                {days.map((day) => {
                  const rel = relDay(day);
                  return (
                    <TabsTrigger
                      key={day}
                      value={day}
                      className={
                        rel < 0
                          ? "shrink-0 bg-amber-500/10 text-amber-700 data-[state=active]:bg-amber-500/25 data-[state=active]:text-amber-800 dark:text-amber-300 dark:data-[state=active]:text-amber-200"
                          : rel > 0
                            ? "shrink-0 bg-sky-500/10 text-sky-700 data-[state=active]:bg-sky-500/25 data-[state=active]:text-sky-800 dark:text-sky-300 dark:data-[state=active]:text-sky-200"
                            : "shrink-0"
                      }
                    >
                      {dayLabel(day, rel)}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dayCounts.get(day) ?? 0}
                      </span>
                    </TabsTrigger>
                  );
                })}
                <TabsTrigger
                  value={FUTURE_TAB}
                  className="shrink-0 bg-sky-500/10 text-sky-700 data-[state=active]:bg-sky-500/25 data-[state=active]:text-sky-800 dark:text-sky-300 dark:data-[state=active]:text-sky-200"
                >
                  {FUTURE_LABEL}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {filteredAnyDay.filter((it) => isFutureDay(it.dayKey, lastDay)).length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* ------- Lista única ------- */}
            {shown.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                Nenhum lote avaliado no filtro atual.
              </p>
            ) : view === "house" ? (
              <div className="space-y-5">
                {houseGroups.map((g) => (
                  <section key={g.house} className="space-y-3">
                    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
                      <HouseLight house={g.house} />
                      <h2 className="text-lg font-semibold tracking-tight">{g.house}</h2>
                      <HouseUf house={g.house} uf={g.items[0]?.lot.uf} className="text-sm" />
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                        {g.items.length} lote(s)
                      </span>
                      <span className="text-xs text-muted-foreground">
                        melhor nota {Math.max(...g.items.map((it) => it.score))}
                      </span>
                    </header>
                    <div className="space-y-3">{g.items.map((it) => renderRow(it, "list"))}</div>
                  </section>
                ))}
              </div>
            ) : (
              <div
                className={
                  view === "cards" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-3"
                }
              >
                {shown.map((it) => renderRow(it, view))}
              </div>
            )}
            {sorted.length > shown.length ? (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                  Mostrar mais ({sorted.length - shown.length} restantes)
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

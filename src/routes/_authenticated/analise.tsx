import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Binoculars,
  ChevronLeft,
  ChevronRight,
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
import { auctionFreight } from "@/lib/auction-freight";
import { garimpoIndex, type Garimpo } from "@/lib/lot-score";
import { auctionChip, lotIsClosed, startsInMinutes } from "@/lib/analise-time";
import { useBidCoveredAlerts } from "@/lib/bid-alerts";
import { DAY_PAGE, FUTURE_LABEL, FUTURE_TAB, isFutureDay } from "@/lib/day-bar";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import {
  patchLotsCaches,
  queryKeys,
  useBidsQuery,
  usePastSalesBulk,
  useWatchedQuery,
} from "@/lib/queries";
import { ANALISE_PAGES, useAnaliseLots } from "@/lib/use-analise-lots";
import { useLotInsights, type LotInsight } from "@/lib/use-lot-insights";
import { excludeLot, dismissPossibleTrash } from "@/lib/lot-exclusion.functions";
import { ExcludeLotDialog } from "@/components/vinyl/exclude-lot-dialog";
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
    garimpoFull: Garimpo;
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
  const [hideTrash, setHideTrash] = usePersistedState("analise-hide-trash", false);
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

  // Exclusão definitiva de lote (DELETE físico + aprendizado de "possível lixo"): um diálogo só.
  const runExclude = useServerFn(excludeLot);
  const runDismissTrash = useServerFn(dismissPossibleTrash);
  const [excludeTarget, setExcludeTarget] = useState<{ id: string; title: string } | null>(null);
  const excludeMutation = useMutation({
    mutationFn: async (input: { lotId: string; reason?: string }) =>
      await runExclude({ data: input }),
    onSuccess: (result, input) => {
      if (!result.ok) {
        toast.error("Este lote já não estava mais na listagem");
        return;
      }
      patchLotsCaches(queryClient, (list) => list.filter((item) => item.id !== input.lotId));
      void queryClient.invalidateQueries({ queryKey: ["excluded-lots"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lots });
      toast.success("Lote excluído — não volta a aparecer");
      setExcludeTarget(null);
    },
    onError: (error: unknown) => {
      toast.error((error as Error)?.message || "Não foi possível excluir o lote");
    },
  });
  // "Isto não é lixo": nega os termos que causaram o sinal (vale para qualquer lote futuro).
  const dismissTrash = useMutation({
    mutationFn: async (terms: string[]) => await runDismissTrash({ data: { terms } }),
    onMutate: (terms) => {
      const prev = queryClient.getQueryData<string[]>(["trash-keyword-denylist"]) ?? [];
      queryClient.setQueryData(["trash-keyword-denylist"], [...new Set([...prev, ...terms])]);
      return { prev };
    },
    onError: (error: unknown, _terms, ctx) => {
      if (ctx) queryClient.setQueryData(["trash-keyword-denylist"], ctx.prev);
      toast.error((error as Error)?.message || "Não foi possível salvar");
    },
    onSuccess: () => toast.success('Marcado como "não é lixo" — o sistema aprendeu'),
  });

  // Hoje + 14 dias (a mesma quantidade da barra da home, sem histórico); lotes vigiados, com lance
  // ou do De olho entram sempre, mesmo futuros.
  const {
    lots: allLots,
    todayKey: serverToday,
    barDays,
    windowDays,
    isLoading: lotsLoading,
    isError: lotsError,
    error: lotsErr,
  } = useAnaliseLots(watchedQuery.data, bidsQuery.data);
  const todayKey = serverToday ?? "";
  // Relógio da tela: o "começa em N min" e a visão "Começando logo" andam sozinhos.
  const nowMs = useNow();
  const nowMin = Math.floor(nowMs / 60_000);
  const { analyzing, analyzeDays } = useAnalyzeScope();
  const { repricing, repriceLots } = useRepriceLots();
  // Tudo que o app sabe de cada lote (nota, mercado, estado, Coleção, De olho, casa…).
  const { insightById, albumById, evaluated, lookoutCount, lookoutActiveItems, aiPanelConfig } =
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

  // Barra de dias: hoje + 14, em páginas de 5 (como na home); o que vier depois do último dia cai
  // no botão "Dias Futuros". Dia salvo que saiu da barra vira "Todos".
  const days = barDays;
  const lastDay = barDays[barDays.length - 1];
  const activeDay = barDays.includes(dayFilter) || dayFilter === FUTURE_TAB ? dayFilter : "";
  const [dayPageRaw, setDayPage] = usePersistedState<number>("analise-day-page", 0);
  const dayPage = Number.isInteger(dayPageRaw)
    ? Math.min(Math.max(dayPageRaw, 0), ANALISE_PAGES - 1)
    : 0;
  // Escolheu um dia de outra página (ex.: pelo filtro salvo): a barra vai até a página dele.
  useEffect(() => {
    const idx = barDays.indexOf(activeDay);
    if (idx >= 0) setDayPage(Math.floor(idx / DAY_PAGE));
  }, [activeDay, barDays, setDayPage]);
  const pageDays = barDays.slice(dayPage * DAY_PAGE, dayPage * DAY_PAGE + DAY_PAGE);

  const houses = useMemo(
    () =>
      [...new Set(allLots.map((l) => l.house).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [allLots],
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
      const eco = lotEconomics(currentPrice, insight.market);
      const ownedConfident = Boolean(insight.owned && insight.owned.score >= OWNED_CONFIDENT_MIN);
      const garimpoFull = garimpoIndex({
        eco,
        score,
        conditionScore: insight.condition.score,
        want: insight.market?.want ?? null,
        have: insight.market?.have ?? null,
        houseLevel: insight.houseLevel,
        ownedConfident,
      });
      out.push({
        lot,
        insight,
        score,
        eco,
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
        ownedConfident,
        garimpoFull,
        garimpo: garimpoFull.index,
        startsInMin: startsInMinutes(lot.dayKey, lot.time, nowMin * 60_000),
        // Só avisa quando a nota TEM preço gravado (nota antiga sem `eval_price` reavalia 1× pelo cron).
        stale:
          insight.ai?.evalPrice != null &&
          priceRoseSinceEval(insight.ai.evalPrice, parsePrice(currentPrice)),
      });
    }
    return out;
  }, [allLots, insightById, bidStatusById, myBidById, watchedIds, nowMin]);

  // Andamento do pregão por casa (uma consulta por pregão de hoje já iniciado): alimenta os chips
  // e decide quais lotes já acabaram.
  const progressByAuction = useAuctionProgress(
    useMemo(
      () => items.filter((it) => it.dayKey === todayKey).map((it) => it.lot),
      [items, todayKey],
    ),
    todayKey,
    nowMs,
  );
  // Só fazem sentido lotes que ainda podem receber lance — nem vigiados que já acabaram.
  const [showClosed, setShowClosed] = usePersistedState("analise-show-closed", false);
  const closedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items)
      if (
        lotIsClosed({
          dayKey: it.dayKey,
          todayKey,
          lote: it.lot.lote,
          bidStatus: it.bidStatus,
          progress: progressByAuction.get(`${it.lot.idLeilao}|${it.lot.dayKey}`) ?? null,
        })
      )
        ids.add(it.lot.id);
    return ids;
  }, [items, todayKey, progressByAuction]);
  const openItems = useMemo(
    () => (showClosed ? items : items.filter((it) => !closedIds.has(it.lot.id))),
    [items, closedIds, showClosed],
  );

  // Aplica os filtros SEM o dia — a barra de dias mostra a contagem de cada dia sobre este conjunto.
  const filteredAnyDay = useMemo(() => {
    const q = normalizeForMatch(search);
    const min = scoreMin.trim() ? Number(scoreMin) : null;
    const max = scoreMax.trim() ? Number(scoreMax) : null;
    const costMax = maxCost.trim() ? Number(maxCost) : null;
    const presetDef = PRESETS.find((p) => p.key === preset);
    return openItems.filter((it) => {
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
      if (hideTrash && insight.possibleTrash) return false;
      return true;
    });
  }, [
    openItems,
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
    hideTrash,
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
    onlyPriced ||
    hideTrash,
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
    setHideTrash(false);
  };
  const presetCounts = useMemo(
    () =>
      new Map(PRESETS.map((p) => [p.key, openItems.filter((it) => p.test(it, todayKey)).length])),
    [openItems, todayKey],
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
        .filter((d) => windowDays.includes(d))
        .filter((d) =>
          activeDay === FUTURE_TAB
            ? isFutureDay(d, lastDay)
            : activeDay
              ? d === activeDay
              : d >= todayKey,
        )
        .sort(),
    [pendingByDay, activeDay, lastDay, todayKey, windowDays],
  );
  const pendingInScope = analyzeDaysScope.reduce((n, d) => n + (pendingByDay.get(d) ?? 0), 0);
  // A análise sob demanda enxerga só a janela da varredura (5 dias); os demais dias entram na
  // rodada automática da IA.
  const outsideWindow =
    activeDay !== "" && (activeDay === FUTURE_TAB || !windowDays.includes(activeDay));
  const scopeLabel = outsideWindow
    ? "neste escopo (a análise sob demanda cobre só os 5 primeiros dias; os demais entram na rodada automática)"
    : activeDay
      ? "neste dia"
      : "nos 5 primeiros dias";
  const staleItems = openItems.filter((it) => it.stale && !closedIds.has(it.lot.id));
  const bidCount = bidStatusById.size;
  const watchedCount = openItems.filter((it) => it.watched).length;
  const closedCount = closedIds.size;

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
  const renderRow = (it: AnaliseItem, variant: "list" | "cards") => (
    <AnaliseLotRow
      key={it.lot.id}
      lot={it.lot}
      insight={it.insight}
      eco={it.eco}
      freight={auctionFreight(it.lot.uf, aiPanelConfig?.freight)}
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
      garimpo={it.garimpoFull}
      open={openIds.has(it.lot.id)}
      onToggleOpen={onToggleOpen}
      days={days}
      watched={it.watched}
      bidStatus={it.bidStatus}
      busy={pending === it.lot.idPeca}
      variant={variant}
      onToggleWatch={onToggleWatch}
      onExclude={(lot) => setExcludeTarget({ id: lot.id, title: lot.title })}
      onDismissTrash={(terms) => dismissTrash.mutate(terms)}
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
                Todos os lotes avaliados em uma lista, com a conta do lance (valor do lote, teto e
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
        {lotsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : lotsError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
            Não foi possível ler os lotes: {(lotsErr as Error).message}
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
                    Valor do lote até
                  </label>
                  <Input
                    value={maxCost}
                    onChange={(e) => setMaxCost(e.target.value)}
                    placeholder="R$ (valor do lote)"
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
                  <button
                    type="button"
                    onClick={() => setHideTrash((v) => !v)}
                    aria-pressed={hideTrash}
                    className={filterChipClass(hideTrash)}
                    title="Esconde lotes parecidos com os que você já excluiu (possível lixo)"
                  >
                    Ocultar possível lixo
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
              {closedCount > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {showClosed
                    ? `Mostrando também ${closedCount} lote(s) que já acabaram (pregão encerrado, passou do lote ou lance com resultado final).`
                    : `${closedCount} lote(s) já encerrado(s) ficam fora da lista, mesmo vigiados.`}{" "}
                  <button
                    type="button"
                    onClick={() => setShowClosed((v) => !v)}
                    className="font-medium text-primary hover:underline"
                  >
                    {showClosed ? "ocultar" : "mostrar"}
                  </button>
                </p>
              ) : null}
            </section>

            {/* ------- Barra de dias (mesmo formato da página principal) ------- */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={dayPage <= 0}
                onClick={() => setDayPage(dayPage - 1)}
                title="5 dias anteriores"
                aria-label="5 dias anteriores"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Tabs
                className="min-w-0 flex-1"
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
                  {pageDays.map((day) => {
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
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={dayPage >= ANALISE_PAGES - 1}
                onClick={() => setDayPage(dayPage + 1)}
                title="Próximos 5 dias"
                aria-label="Próximos 5 dias"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

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
      <ExcludeLotDialog
        target={excludeTarget}
        busy={excludeMutation.isPending}
        onClose={() => setExcludeTarget(null)}
        onConfirm={(reason) =>
          excludeMutation.mutate({ lotId: excludeTarget!.id, reason: reason || undefined })
        }
      />
    </main>
  );
}

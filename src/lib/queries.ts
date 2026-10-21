// Queries do React Query compartilhadas entre telas: UMA definição por chave (key + queryFn +
// staleTime). Antes cada rota repetia o `useQuery` — e a mesma chave chegou a ter `queryFn`
// diferentes (ex.: `["collection-links"]` best-effort na home e sem tratamento em /compras),
// valendo a de quem montasse primeiro. Use `queryKeys` para invalidar/`setQueryData`.
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";

import { getAiPanel, getCalibration } from "@/lib/ai-panel.functions";
import { collectorInterests } from "@/lib/collector-profile";
import { buildInterestMatcher } from "@/lib/lot-score";
import { getHouseRatings } from "@/lib/house-rating.functions";
import { EMPTY_RATINGS, type RatingsPayload } from "@/lib/house-rating";

import {
  getCollection,
  getCollectionFeedback,
  getCollectionLinks,
} from "@/lib/collection.functions";
import type { CollectionItem } from "@/lib/collection.server";
import type { MyBid } from "@/lib/leiloesbr-bids.server";
import { listWatched } from "@/lib/leiloesbr-watch.functions";
import type { WatchedLot } from "@/lib/leiloesbr-watch.server";
import {
  getAiProvider,
  getAnthropicModel,
  getGeminiModel,
  getLotAi,
  getLotTracklist,
  getLotIdent,
  getUserInterests,
} from "@/lib/ai.functions";
import { getAnalyticsAliases, getLotPastSales } from "@/lib/analytics.functions";
import {
  getLotCondition,
  getHouseUfs,
  getLotMarket,
  getVinylLots,
  getVinylLotsRange,
  listMyBids,
} from "@/lib/leiloesbr.functions";
import { getLookout, getLookoutLinks, getLookoutOverview } from "@/lib/lookout.functions";
import type { LookoutItem, LookoutLinks } from "@/lib/lookout-match";
import type { LookoutOverview } from "@/lib/lookout-matches.server";
import type { LotScope } from "@/lib/lot-scope";
import {
  accumSnapshot,
  BIDS_ACCUM_STORAGE_KEY,
  loadAccum,
  mergeWatchedAccum,
  WATCHED_ACCUM_STORAGE_KEY,
} from "@/lib/watched-accum";
import type { CollectionLinks, OwnedFeedback } from "@/lib/wantlist-match";

export const queryKeys = {
  lots: ["vinyl-lots"],
  lotsRange: ["vinyl-lots-range"],
  watched: ["vinyl-watched"],
  bids: ["vinyl-my-bids"],
  lotAi: ["lot-ai"],
  lotPastSales: (id: string) => ["lot-past-sales", id] as const,
  lotTracklist: (id: string) => ["lot-tracklist", id] as const,
  lotIdent: ["lot-ident"],
  lotMarket: ["lot-market"],
  lotCondition: ["lot-condition"],
  interests: ["user-interests"],
  aiProvider: ["ai-provider"],
  geminiModel: ["gemini-model"],
  anthropicModel: ["anthropic-model"],
  aiPanel: ["ai-panel"],
  calibration: ["ai-calibration"],
  aiMode: ["ai-mode"],
  collection: ["collection"],
  collectionLinks: ["collection-links"],
  collectionFeedback: ["collection-feedback"],
  lookout: ["lookout"],
  lookoutLinks: ["lookout-links"],
  lookoutOverview: ["lookout-overview"],
  analyticsAliases: ["analytics-aliases"],
  houseRatings: ["house-ratings"],
  houseUfs: ["house-ufs"],
} as const;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Lotes da janela: carrega uma vez ao abrir; não recarrega ao navegar/focar a janela. */
export function useLotsQuery() {
  const fetchLots = useServerFn(getVinylLots);
  return useQuery({
    queryKey: queryKeys.lots,
    queryFn: () => fetchLots(),
    staleTime: 2 * HOUR,
    gcTime: 4 * HOUR,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Lotes já gravados de páginas de dias fora da janela padrão (histórico e futuro), buscados só
 * quando a página é aberta na barra de dias (`pages`: intervalo `[from, to]` por página, ou null).
 */
export function useLotsRangeQueries(pages: ({ from: string; to: string } | null)[]) {
  const fetchRange = useServerFn(getVinylLotsRange);
  return useQueries({
    queries: pages.map((range) => ({
      queryKey: [...queryKeys.lotsRange, range?.from ?? "", range?.to ?? ""],
      queryFn: () => fetchRange({ data: range! }),
      enabled: range !== null,
      staleTime: 2 * HOUR,
      gcTime: 4 * HOUR,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });
}

type LotsPayload = Awaited<ReturnType<typeof getVinylLots>>;

/** Aplica `fn` à lista de lotes da janela padrão E das páginas de histórico/futuro em cache. */
export function patchLotsCaches(
  queryClient: QueryClient,
  fn: (lots: LotsPayload["lots"]) => LotsPayload["lots"],
) {
  queryClient.setQueryData(queryKeys.lots, (old: LotsPayload | undefined) =>
    old ? { ...old, lots: fn(old.lots) } : old,
  );
  queryClient.setQueriesData(
    { queryKey: queryKeys.lotsRange },
    (old: { lots: LotsPayload["lots"] } | undefined) =>
      old ? { ...old, lots: fn(old.lots) } : old,
  );
}

// Vigiados/lances "vistos" na janela de dias: a conta do LeilõesBR (l=8/l=4) pode parar de
// trazer um lote assim que o leilão termina. Por isso o `queryFn` MESCLA (nunca substitui) num
// acumulador persistido em `localStorage` (`mergeWatchedAccum`, `@/lib/watched-accum`): um item
// só sai quando o usuário desvigia (quem chama remove do `accumRef` e grava), quando o dia sai da
// janela, ou quando some do fetch fresco com o leilão ainda aberto. As telas que leem estas
// chaves TÊM de usar estes hooks — um `queryFn` sem mesclar sobrescreveria o acumulado.
//
// `placeholderData` (v0.155.0): enquanto a conta é lida, a tela mostra o acumulado do
// `localStorage` (`accumSnapshot`) — abre na hora com o último estado e se corrige sozinha.
// `refetchFresh()` (botões "Atualizar") pula o cache de 60s do servidor (`account-cache.server`).
function useAccountQuery<T extends { id: string; date: string; time?: string }>(
  queryKey: readonly string[],
  storageKey: string,
  fetchFresh: (force: boolean) => Promise<T[]>,
) {
  const accumRef = useRef<Map<string, T> | null>(null);
  if (accumRef.current === null) accumRef.current = loadAccum<T>(storageKey);
  const forceRef = useRef(false);
  // Lido do `localStorage` só DEPOIS de montar (o HTML do SSR não tem o acumulado: ler no 1º
  // render quebraria a hidratação) e uma vez só (referência estável entre renders).
  const [placeholder, setPlaceholder] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    setPlaceholder(accumSnapshot(accumRef.current!));
  }, []);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const force = forceRef.current;
      forceRef.current = false;
      const fresh = await fetchFresh(force);
      return mergeWatchedAccum(accumRef.current!, fresh, storageKey);
    },
    placeholderData: placeholder,
    staleTime: 5 * MIN,
    refetchOnWindowFocus: false,
  });
  const refetchFresh = () => {
    forceRef.current = true;
    return query.refetch({ throwOnError: true });
  };
  return { query, accumRef, refetchFresh };
}

export function useWatchedQuery() {
  const fetchWatched = useServerFn(listWatched);
  return useAccountQuery<WatchedLot>(queryKeys.watched, WATCHED_ACCUM_STORAGE_KEY, (force) =>
    fetchWatched({ data: { force } }),
  );
}

export function useBidsQuery() {
  const fetchBids = useServerFn(listMyBids);
  return useAccountQuery<MyBid>(queryKeys.bids, BIDS_ACCUM_STORAGE_KEY, (force) =>
    fetchBids({ data: { force } }),
  );
}

export function useLotAiQuery() {
  const fetchLotAi = useServerFn(getLotAi);
  return useQuery({
    queryKey: queryKeys.lotAi,
    queryFn: () => fetchLotAi(),
    staleTime: 10 * MIN,
    refetchOnWindowFocus: false,
  });
}

/**
 * Tracklist de UM lote, buscada só quando alguém a pede (`enabled`): `getLotAi` não carrega mais as
 * faixas de todos os discos, só `hasTracklist`. Atualizada por `useLotTracklistRefresh`.
 */
export function useLotTracklist(id: string | null | undefined, enabled: boolean) {
  const fetchTracklist = useServerFn(getLotTracklist);
  return useQuery({
    queryKey: queryKeys.lotTracklist(id ?? ""),
    queryFn: () => fetchTracklist({ data: { id: id as string } }),
    enabled: enabled && Boolean(id),
    staleTime: 30 * MIN,
    refetchOnWindowFocus: false,
  });
}

/** Vendas passadas do mesmo disco (Analytics) de UM lote — buscada ao abrir o detalhe da nota. */
export function useLotPastSales(id: string | null | undefined) {
  const fetchPastSales = useServerFn(getLotPastSales);
  return useQuery({
    queryKey: queryKeys.lotPastSales(id ?? ""),
    queryFn: () => fetchPastSales({ data: { id: id as string } }),
    enabled: Boolean(id),
    staleTime: 30_000, // volta do Analytics já com a correção feita lá
    refetchOnWindowFocus: false,
  });
}

export function useLotIdentQuery() {
  const fetchLotIdent = useServerFn(getLotIdent);
  return useQuery({
    queryKey: queryKeys.lotIdent,
    queryFn: () => fetchLotIdent(),
    staleTime: 10 * MIN,
    refetchOnWindowFocus: false,
  });
}

export function useLotMarketQuery() {
  const fetchLotMarket = useServerFn(getLotMarket);
  return useQuery({
    queryKey: queryKeys.lotMarket,
    queryFn: () => fetchLotMarket(),
    staleTime: 10 * MIN,
    refetchOnWindowFocus: false,
  });
}

/** Estado de conservação (Disco/Capa) de todos os lotes (`lot_condition`). */
export function useLotConditionQuery() {
  const fetchLotCondition = useServerFn(getLotCondition);
  return useQuery({
    queryKey: queryKeys.lotCondition,
    queryFn: () => fetchLotCondition(),
    staleTime: 10 * MIN,
    refetchOnWindowFocus: false,
  });
}

/**
 * Home (v0.155.0): as tabelas por lote (`lot_ai`, `lot_ident`, `lot_market`, `lot_condition`)
 * vêm em DUAS partes — `core` (lotes de 2 dias atrás até o fim da janela padrão, o que a home
 * mostra ao abrir) e, só depois que ela chega, `rest` (histórico mais antigo e dias futuros
 * além da janela). As telas abrem com menos dados e o resto completa em segundo plano. Chaves
 * `[...base, "core" | "rest"]`: `invalidateQueries`/`setQueriesData` com a chave base atingem
 * as partes e a versão inteira (outras telas) de uma vez. Ver `lot-scope.server.ts`.
 */
function useScopedLotRows<T extends { id: string }>(
  baseKey: readonly string[],
  fetchScope: (scope: LotScope) => Promise<T[]>,
  staleTime: number,
) {
  const core = useQuery({
    queryKey: [...baseKey, "core"],
    queryFn: () => fetchScope("core"),
    staleTime,
    refetchOnWindowFocus: false,
  });
  const rest = useQuery({
    queryKey: [...baseKey, "rest"],
    queryFn: () => fetchScope("rest"),
    enabled: core.isSuccess,
    staleTime,
    refetchOnWindowFocus: false,
  });
  const data = useMemo(() => {
    if (!core.data) return undefined;
    if (!rest.data?.length) return core.data;
    // Um patch (`setQueriesData`) pode ter acrescentado a mesma linha às duas partes.
    const byId = new Map<string, T>();
    for (const r of rest.data) byId.set(r.id, r);
    for (const r of core.data) byId.set(r.id, r);
    return [...byId.values()];
  }, [core.data, rest.data]);
  return { data, isLoading: core.isLoading };
}

export function useHomeLotAiQuery() {
  const fetchLotAi = useServerFn(getLotAi);
  return useScopedLotRows(queryKeys.lotAi, (scope) => fetchLotAi({ data: { scope } }), 10 * MIN);
}

export function useHomeLotIdentQuery() {
  const fetchLotIdent = useServerFn(getLotIdent);
  return useScopedLotRows(
    queryKeys.lotIdent,
    (scope) => fetchLotIdent({ data: { scope } }),
    10 * MIN,
  );
}

export function useHomeLotMarketQuery() {
  const fetchLotMarket = useServerFn(getLotMarket);
  return useScopedLotRows(
    queryKeys.lotMarket,
    (scope) => fetchLotMarket({ data: { scope } }),
    10 * MIN,
  );
}

export function useHomeLotConditionQuery() {
  const fetchLotCondition = useServerFn(getLotCondition);
  return useScopedLotRows(
    queryKeys.lotCondition,
    (scope) => fetchLotCondition({ data: { scope } }),
    10 * MIN,
  );
}

export function useInterestsQuery() {
  const fetchInterests = useServerFn(getUserInterests);
  return useQuery({
    queryKey: queryKeys.interests,
    queryFn: () => fetchInterests(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

/**
 * Interesses efetivos do perfil do colecionador: a lista manual + os artistas do De olho
 * (`collector-profile.ts`). Quem só precisa do teste «combina com meus interesses» usa `matcher`.
 */
export function useCollectorInterests() {
  const manualQuery = useInterestsQuery();
  const lookoutQuery = useLookoutQuery();
  const interests = useMemo(
    () => collectorInterests(manualQuery.data ?? [], lookoutQuery.data ?? []),
    [manualQuery.data, lookoutQuery.data],
  );
  const matcher = useMemo(() => buildInterestMatcher(interests.all), [interests.all]);
  return { ...interests, matcher, isLoading: manualQuery.isLoading };
}

/** Aba «Calibração» do painel de IA: compras recebidas com o retrato da época e a opinião do usuário. */
export function useCalibrationQuery() {
  const fetchCalibration = useServerFn(getCalibration);
  return useQuery({
    queryKey: queryKeys.calibration,
    queryFn: () => fetchCalibration(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useAiProviderQuery() {
  const fetchAiProvider = useServerFn(getAiProvider);
  return useQuery({
    queryKey: queryKeys.aiProvider,
    queryFn: () => fetchAiProvider(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

export function useGeminiModelQuery() {
  const fetchGeminiModel = useServerFn(getGeminiModel);
  return useQuery({
    queryKey: queryKeys.geminiModel,
    queryFn: () => fetchGeminiModel(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

export function useAnthropicModelQuery() {
  const fetchAnthropicModel = useServerFn(getAnthropicModel);
  return useQuery({
    queryKey: queryKeys.anthropicModel,
    queryFn: () => fetchAnthropicModel(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

export function useCollectionQuery() {
  const fetchCollection = useServerFn(getCollection);
  return useQuery<CollectionItem[]>({
    queryKey: queryKeys.collection,
    queryFn: () => fetchCollection() as Promise<CollectionItem[]>,
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

// Vínculos/aprendizado da Coleção: best-effort — um erro aqui NUNCA pode derrubar a tela (a
// relação lote ↔ Coleção é acessória), então cai para vazio sem retentar.
export function useCollectionLinksQuery() {
  const fetchCollectionLinks = useServerFn(getCollectionLinks);
  return useQuery<CollectionLinks>({
    queryKey: queryKeys.collectionLinks,
    queryFn: async () => {
      try {
        return ((await fetchCollectionLinks()) as CollectionLinks) ?? {};
      } catch {
        return {};
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useCollectionFeedbackQuery() {
  const fetchCollectionFeedback = useServerFn(getCollectionFeedback);
  return useQuery<OwnedFeedback[]>({
    queryKey: queryKeys.collectionFeedback,
    queryFn: async () => {
      try {
        return ((await fetchCollectionFeedback()) as OwnedFeedback[]) ?? [];
      } catch {
        return [];
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Apelidos de artista/álbum curados no Analytics (também usados no casamento da Coleção). */
export function useAnalyticsAliasesQuery() {
  const fetchAliases = useServerFn(getAnalyticsAliases);
  return useQuery({
    queryKey: queryKeys.analyticsAliases,
    queryFn: () => fetchAliases(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

// "Ficar de olho": itens e vínculos por lote. Best-effort como a Coleção — a feature é acessória
// na home, então um erro aqui cai para vazio sem retentar e nunca derruba a tela.
export function useLookoutQuery() {
  const fetchLookout = useServerFn(getLookout);
  return useQuery<LookoutItem[]>({
    queryKey: queryKeys.lookout,
    queryFn: async () => {
      try {
        return ((await fetchLookout()) as LookoutItem[]) ?? [];
      } catch {
        return [];
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useLookoutLinksQuery() {
  const fetchLinks = useServerFn(getLookoutLinks);
  return useQuery<LookoutLinks>({
    queryKey: queryKeys.lookoutLinks,
    queryFn: async () => {
      try {
        return ((await fetchLinks()) as LookoutLinks) ?? {};
      } catch {
        return {};
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Matches por vir + histórico + contador de novos (cálculo no servidor, `lookout-matches.server`).
 * Duas versões, com chaves próprias:
 * - `history: false` ("light"): sem histórico e SEM valor ao vivo (`peca.asp`) — o contador do
 *   menu (só usa `newCount`, que não depende de preço) e a 1ª etapa de `/olho` (v0.155.0).
 * - `history: true` ("full"): com histórico de vendas e valor ao vivo — 2ª etapa de `/olho`.
 */
export function useLookoutOverviewQuery(opts: { history: boolean }) {
  const fetchOverview = useServerFn(getLookoutOverview);
  return useQuery<LookoutOverview>({
    queryKey: [...queryKeys.lookoutOverview, opts.history ? "full" : "light"],
    queryFn: () =>
      fetchOverview({
        data: { history: opts.history, live: opts.history },
      }) as Promise<LookoutOverview>,
    staleTime: 15 * MIN,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** UF por casa (`houseKey` → "SP"); acessória: erro vira vazio. Muda raramente. */
export function useHouseUfsQuery() {
  const fetchUfs = useServerFn(getHouseUfs);
  return useQuery<Record<string, string>>({
    queryKey: queryKeys.houseUfs,
    queryFn: async () => {
      try {
        return await fetchUfs();
      } catch {
        return {};
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

/** Avaliações das casas (semáforo por casa + avaliação por compra). Acessória: erro vira vazio. */
export function useHouseRatingsQuery() {
  const fetchRatings = useServerFn(getHouseRatings);
  return useQuery<RatingsPayload>({
    queryKey: queryKeys.houseRatings,
    queryFn: async () => {
      try {
        return (await fetchRatings()) as RatingsPayload;
      } catch {
        return EMPTY_RATINGS;
      }
    },
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

/** Configuração do painel de IA (frete, condição padrão, regras de texto, blocos do prompt). */
export function useAiPanelQuery() {
  const fetchPanel = useServerFn(getAiPanel);
  return useQuery({
    queryKey: queryKeys.aiPanel,
    queryFn: () => fetchPanel(),
    staleTime: HOUR,
    refetchOnWindowFocus: false,
  });
}

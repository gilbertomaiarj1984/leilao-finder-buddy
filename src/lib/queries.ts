// Queries do React Query compartilhadas entre telas: UMA definição por chave (key + queryFn +
// staleTime). Antes cada rota repetia o `useQuery` — e a mesma chave chegou a ter `queryFn`
// diferentes (ex.: `["collection-links"]` best-effort na home e sem tratamento em /compras),
// valendo a de quem montasse primeiro. Use `queryKeys` para invalidar/`setQueryData`.
import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef } from "react";

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
  getLotIdent,
  getUserInterests,
} from "@/lib/ai.functions";
import { getAnalyticsAliases } from "@/lib/analytics.functions";
import {
  getLotMarket,
  getVinylLots,
  getVinylLotsRange,
  listMyBids,
} from "@/lib/leiloesbr.functions";
import { getLookout, getLookoutLinks, getLookoutOverview } from "@/lib/lookout.functions";
import type { LookoutItem, LookoutLinks } from "@/lib/lookout-match";
import type { LookoutOverview } from "@/lib/lookout-matches.server";
import { getWantlist } from "@/lib/wantlist.functions";
import {
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
  lotIdent: ["lot-ident"],
  lotMarket: ["lot-market"],
  interests: ["user-interests"],
  aiProvider: ["ai-provider"],
  geminiModel: ["gemini-model"],
  anthropicModel: ["anthropic-model"],
  collection: ["collection"],
  collectionLinks: ["collection-links"],
  collectionFeedback: ["collection-feedback"],
  wantlist: ["wantlist"],
  lookout: ["lookout"],
  lookoutLinks: ["lookout-links"],
  lookoutOverview: ["lookout-overview"],
  analyticsAliases: ["analytics-aliases"],
} as const;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Item da sondagem como a UI consome (espelha `wantlist_items`). */
export type WantItem = {
  id: string;
  raw: string;
  work: string;
  year: number | null;
  note: string;
  norm: string;
  acquired: boolean;
  position: number;
};

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
export function useWatchedQuery() {
  const fetchWatched = useServerFn(listWatched);
  const accumRef = useRef<Map<string, WatchedLot> | null>(null);
  if (accumRef.current === null)
    accumRef.current = loadAccum<WatchedLot>(WATCHED_ACCUM_STORAGE_KEY);
  const query = useQuery({
    queryKey: queryKeys.watched,
    queryFn: async () => {
      const fresh = await fetchWatched();
      return mergeWatchedAccum(accumRef.current!, fresh, WATCHED_ACCUM_STORAGE_KEY);
    },
    staleTime: 5 * MIN,
    refetchOnWindowFocus: false,
  });
  return { query, accumRef };
}

export function useBidsQuery() {
  const fetchBids = useServerFn(listMyBids);
  const accumRef = useRef<Map<string, MyBid> | null>(null);
  if (accumRef.current === null) accumRef.current = loadAccum<MyBid>(BIDS_ACCUM_STORAGE_KEY);
  const query = useQuery({
    queryKey: queryKeys.bids,
    queryFn: async () => {
      const fresh = await fetchBids();
      return mergeWatchedAccum(accumRef.current!, fresh, BIDS_ACCUM_STORAGE_KEY);
    },
    staleTime: 5 * MIN,
    refetchOnWindowFocus: false,
  });
  return { query, accumRef };
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

export function useInterestsQuery() {
  const fetchInterests = useServerFn(getUserInterests);
  return useQuery({
    queryKey: queryKeys.interests,
    queryFn: () => fetchInterests(),
    staleTime: HOUR,
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

export function useWantlistQuery() {
  const fetchWantlist = useServerFn(getWantlist);
  return useQuery<WantItem[]>({
    queryKey: queryKeys.wantlist,
    queryFn: () => fetchWantlist() as Promise<WantItem[]>,
    staleTime: HOUR,
    refetchOnWindowFocus: false,
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
 * Alimenta a página `/olho` (com histórico) e o contador do menu (`history: false`, mais leve —
 * chave própria para não misturar os dois formatos).
 */
export function useLookoutOverviewQuery(opts: { history: boolean }) {
  const fetchOverview = useServerFn(getLookoutOverview);
  return useQuery<LookoutOverview>({
    queryKey: [...queryKeys.lookoutOverview, opts.history ? "full" : "light"],
    queryFn: () => fetchOverview({ data: { history: opts.history } }) as Promise<LookoutOverview>,
    staleTime: 15 * MIN,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

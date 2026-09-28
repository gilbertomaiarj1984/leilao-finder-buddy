// Queries do React Query compartilhadas entre telas: UMA definição por chave (key + queryFn +
// staleTime). Antes cada rota repetia o `useQuery` — e a mesma chave chegou a ter `queryFn`
// diferentes (ex.: `["collection-links"]` best-effort na home e sem tratamento em /compras),
// valendo a de quem montasse primeiro. Use `queryKeys` para invalidar/`setQueryData`.
import { useQuery } from "@tanstack/react-query";
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
  getGeminiModel,
  getLotAi,
  getLotIdent,
  getUserInterests,
} from "@/lib/ai.functions";
import { getAnalyticsAliases } from "@/lib/analytics.functions";
import { getLotMarket, getVinylLots, listMyBids } from "@/lib/leiloesbr.functions";
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
  watched: ["vinyl-watched"],
  bids: ["vinyl-my-bids"],
  lotAi: ["lot-ai"],
  lotIdent: ["lot-ident"],
  lotMarket: ["lot-market"],
  interests: ["user-interests"],
  aiProvider: ["ai-provider"],
  geminiModel: ["gemini-model"],
  collection: ["collection"],
  collectionLinks: ["collection-links"],
  collectionFeedback: ["collection-feedback"],
  wantlist: ["wantlist"],
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

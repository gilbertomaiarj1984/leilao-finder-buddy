import { useMemo } from "react";

import {
  toLotAi,
  toLotMarket,
  withConditionAnchor,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import { buildOwnedCandidates } from "@/lib/collector-profile";
import { effectiveTextRules } from "@/lib/condition-text";
import { parseConditionFromText, scoreCondition, type Condition, type Grade } from "@/lib/grading";
import { houseKey, type RatingLevel } from "@/lib/house-rating";
import { possibleTrashMap, type ExclusionSignal } from "@/lib/lot-exclusion";
import { parseAiAlbum } from "@/lib/lot-score";
import {
  buildLotIdentity,
  lookoutCandidates,
  LOOKOUT_CONFIDENT_MIN,
  matchLookoutForLot,
  type LookoutHit,
} from "@/lib/lookout-match";
import {
  useAiPanelQuery,
  useAnalyticsAliasesQuery,
  useCollectionFeedbackQuery,
  useCollectionKeywordDenylistQuery,
  useCollectionLinksQuery,
  useCollectionQuery,
  useCollectorInterests,
  useExcludedLotsQuery,
  useHouseRatingsQuery,
  useLookoutLinksQuery,
  useLookoutQuery,
  useLotAiQuery,
  useLotConditionQuery,
  useLotIdentQuery,
  useLotMarketQuery,
  useTrashDenylistQuery,
} from "@/lib/queries";
import type { VinylLot } from "@/lib/vinyl-parse";
import {
  ownedMatchForLot,
  resolveOwned,
  type LotIdentity,
  type OwnedHit,
} from "@/lib/wantlist-match";

/** Casamento do lote com um disco do De olho (rótulo + confiança) para o 🎯 da linha. */
export type LookoutMark = Pick<LookoutHit, "label" | "score" | "confirmed" | "yearPending">;

/** O que o app sabe de UM lote (ver `useLotInsights`). */
export type LotInsight = {
  ai: LotAi | undefined;
  /** Artista/álbum resolvido (`lot_ai` > `lot_ident`). */
  album: string | null;
  /** Mercado já ancorado na condição do disco e com o frete da UF. */
  market: LotMarket | undefined;
  condition: Condition;
  demand: { views: number | null; bids: number | null } | null;
  /** Relação com a Coleção ("já tenho"); `null` = nenhuma. */
  owned: OwnedHit | null;
  lookout: LookoutMark | null;
  houseLevel: RatingLevel | null;
  /** Parecido com um lote já excluído ("possível lixo"); só sinaliza, nunca esconde sozinho. */
  possibleTrash: ExclusionSignal | null;
};

/**
 * Tudo que o app sabe sobre cada lote, resolvido UMA vez para as telas que listam lotes fora da
 * home: nota da IA, álbum, mercado já ancorado na condição do disco e com frete, estado
 * (Disco/Capa), demanda do catálogo, "já tenho" (Coleção), De olho e semáforo da casa.
 * Leituras só — nenhuma mutação. O mapa tem identidade estável enquanto os dados não mudam.
 *
 * DUP(lot-insights): a home (`use-dashboard-data.tsx`) mantém a sua própria cópia desse pipeline
 * (condição, mercado, demanda e Coleção), que também alimenta os diálogos de decisão da Coleção.
 * Migrar a home para este hook é a consolidação pendente (ver `docs/pendencias.md`).
 */
export function useLotInsights(allLots: VinylLot[]) {
  const lotAiQuery = useLotAiQuery();
  const lotIdentQuery = useLotIdentQuery();
  const lotMarketQuery = useLotMarketQuery();
  const lotConditionQuery = useLotConditionQuery();
  const aiPanelQuery = useAiPanelQuery();
  const aliasesQuery = useAnalyticsAliasesQuery();
  const ratingsQuery = useHouseRatingsQuery();
  const lookoutQuery = useLookoutQuery();
  const lookoutLinksQuery = useLookoutLinksQuery();
  const collectionQuery = useCollectionQuery();
  const collectionLinksQuery = useCollectionLinksQuery();
  const collectionFeedbackQuery = useCollectionFeedbackQuery();
  const keywordDenylistQuery = useCollectionKeywordDenylistQuery();
  const excludedQuery = useExcludedLotsQuery();
  const trashDenylistQuery = useTrashDenylistQuery();
  // Perfil do colecionador: interesses digitados + artistas do De olho.
  const { matcher: matchesInterest } = useCollectorInterests();

  // ---- IA / álbum --------------------------------------------------------------------------
  const aiById = useMemo(() => {
    const map = new Map<string, LotAi>();
    for (const r of lotAiQuery.data ?? []) map.set(r.id, toLotAi(r));
    return map;
  }, [lotAiQuery.data]);
  // Mapa id→álbum com identidade ESTÁVEL enquanto os álbuns não mudam (assinatura id:album):
  // editar uma tag muda `lotAiQuery.data`, e sem isto recalcularia o casamento pesado abaixo.
  const aiAlbumSig = useMemo(
    () => (lotAiQuery.data ?? []).map((r) => `${r.id}:${r.album ?? ""}`).join("|"),
    [lotAiQuery.data],
  );
  const identAlbumSig = useMemo(
    () => (lotIdentQuery.data ?? []).map((r) => `${r.id}:${r.album ?? ""}`).join("|"),
    [lotIdentQuery.data],
  );
  // Álbum RESOLVIDO por lote: prefere a avaliação completa (`lot_ai`); senão a identificação
  // simplificada (`lot_ident`).
  const albumById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of lotIdentQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    for (const r of lotAiQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só muda quando algum álbum muda
  }, [aiAlbumSig, identAlbumSig]);

  // ---- Estado (Disco/Capa) -----------------------------------------------------------------
  const conditionById = useMemo(() => {
    const map = new Map<string, Condition>();
    for (const r of lotConditionQuery.data ?? []) {
      const rawMedia = (r.media || null) as Grade | null;
      const rawSleeve = (r.sleeve || null) as Grade | null;
      // `scoreCondition` espelha o lado desconhecido (padrão do app).
      const { media, sleeve, score, faixa } = scoreCondition(rawMedia, rawSleeve);
      const insert = r.insert_state === "sim" ? "sim" : r.insert_state === "nao" ? "nao" : null;
      if (!media && !sleeve && insert === null) continue; // indefinido → não guarda
      map.set(r.id, { media, sleeve, insert, score, faixa, source: "regex", raw: "" });
    }
    return map;
  }, [lotConditionQuery.data]);
  const demandById = useMemo(() => {
    const map = new Map<string, { views: number | null; bids: number | null }>();
    for (const r of lotConditionQuery.data ?? []) {
      if (r.views == null && r.bids == null) continue;
      map.set(r.id, { views: r.views ?? null, bids: r.bids ?? null });
    }
    return map;
  }, [lotConditionQuery.data]);
  const textRules = useMemo(
    () => effectiveTextRules(aiPanelQuery.data?.rules, aiPanelQuery.data?.disabledRules),
    [aiPanelQuery.data],
  );

  // ---- Mercado (Discogs) -------------------------------------------------------------------
  const marketById = useMemo(() => {
    const map = new Map<string, LotMarket>();
    for (const r of lotMarketQuery.data ?? []) map.set(r.id, toLotMarket(r));
    return map;
  }, [lotMarketQuery.data]);

  // ---- Identidade do lote (De olho e Coleção) -----------------------------------------------
  const artistAliases = useMemo(() => aliasesQuery.data?.artists ?? {}, [aliasesQuery.data]);
  const identityById = useMemo(() => {
    const map = new Map<string, LotIdentity>();
    for (const lot of allLots) {
      try {
        const market = marketById.get(lot.id);
        map.set(
          lot.id,
          buildLotIdentity({
            title: lot.title,
            artist: lot.artist,
            album: albumById.get(lot.id) ?? null,
            marketTitle: market?.releaseTitle ?? null,
            marketYear: market?.year ?? null,
            aliases: artistAliases,
          }),
        );
      } catch {
        /* um lote problemático não derruba a tela */
      }
    }
    return map;
  }, [allLots, albumById, marketById, artistAliases]);

  // ---- De olho -----------------------------------------------------------------------------
  const lookoutCands = useMemo(
    () => lookoutCandidates(lookoutQuery.data ?? [], artistAliases),
    [lookoutQuery.data, artistAliases],
  );
  const lookoutByLot = useMemo(() => {
    const map = new Map<string, LookoutMark>();
    if (!lookoutCands.length) return map;
    for (const lot of allLots) {
      try {
        const identity = identityById.get(lot.id);
        if (!identity) continue;
        const hit = matchLookoutForLot(lookoutCands, lot.id, identity, lookoutLinksQuery.data);
        if (hit && (hit.confirmed || hit.score >= LOOKOUT_CONFIDENT_MIN)) map.set(lot.id, hit);
      } catch {
        /* idem */
      }
    }
    return map;
  }, [lookoutCands, allLots, identityById, lookoutLinksQuery.data]);
  const lookoutActiveItems = (lookoutQuery.data ?? []).filter((i) => i.status === "active").length;

  // ---- Coleção ("já tenho") ----------------------------------------------------------------
  const collById = useMemo(() => {
    const map = new Map<string, { artist: string; album: string }>();
    for (const it of collectionQuery.data ?? []) map.set(it.id, it);
    return map;
  }, [collectionQuery.data]);
  const collLabel = (itemId: string): string => {
    const it = collById.get(itemId);
    return it ? [it.artist, it.album].filter(Boolean).join(" ") : "";
  };
  const ownedCands = useMemo(
    () => buildOwnedCandidates(collectionQuery.data ?? [], artistAliases),
    [collectionQuery.data, artistAliases],
  );
  // `lot_id` das peças EXATAS já arrematadas → item da Coleção (casamento 100% preciso).
  const ownedByLotId = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of collectionQuery.data ?? []) if (it.lotId) map.set(it.lotId, it.id);
    return map;
  }, [collectionQuery.data]);
  const keywordDenylist = useMemo(
    () => new Set(keywordDenylistQuery.data ?? []),
    [keywordDenylistQuery.data],
  );
  const ownedAutoById = useMemo(() => {
    const map = new Map<string, OwnedHit>();
    for (const lot of allLots) {
      try {
        const exactId = ownedByLotId.get(lot.id);
        if (exactId) {
          map.set(lot.id, { id: exactId, label: collLabel(exactId), score: 1 });
          continue;
        }
        if (!ownedCands.length) continue;
        const identity = identityById.get(lot.id);
        if (!identity) continue;
        const best = ownedMatchForLot(ownedCands, identity, keywordDenylist);
        if (best) map.set(lot.id, best);
      } catch {
        /* falha de casamento de um lote é ignorada */
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collLabel depende de collById
  }, [allLots, ownedCands, ownedByLotId, identityById, collById, keywordDenylist]);
  const EMPTY_IDENTITY: LotIdentity = useMemo(
    () => ({ text: "", tokens: new Set<string>(), years: new Set<number>() }),
    [],
  );

  // ---- Possível lixo (parecido com lote já excluído) ---------------------------------------
  const trashById = useMemo(
    () =>
      possibleTrashMap(
        allLots,
        (id) => {
          const album = albumById.get(id) ?? null;
          return [parseAiAlbum(album).artist, album, marketById.get(id)?.releaseTitle];
        },
        excludedQuery.data ?? [],
        new Set(trashDenylistQuery.data ?? []),
      ),
    [allLots, albumById, marketById, excludedQuery.data, trashDenylistQuery.data],
  );

  // ---- Resultado: uma linha de "insight" por lote -------------------------------------------
  const insightById = useMemo(() => {
    const map = new Map<string, LotInsight>();
    const links = collectionLinksQuery.data ?? {};
    const feedback = collectionFeedbackQuery.data ?? [];
    for (const lot of allLots) {
      const base = aiById.get(lot.id);
      const ai = base ? { ...base, matchesInterests: matchesInterest(lot.title) } : undefined;
      // Sem linha em `lot_condition` (ou indefinida) cai no parse do TÍTULO.
      const condition = conditionById.get(lot.id) ?? parseConditionFromText(lot.title, textRules);
      const market = withConditionAnchor(
        marketById.get(lot.id),
        condition.media,
        lot.uf,
        aiPanelQuery.data,
      );
      let owned: OwnedHit | null = null;
      try {
        const res = resolveOwned(
          lot.id,
          links,
          ownedAutoById.get(lot.id) ?? null,
          feedback,
          identityById.get(lot.id) ?? EMPTY_IDENTITY,
          (itemId) => ownedCands.find((c) => c.id === itemId),
        );
        if (res.kind === "linked")
          owned = { id: res.itemId, label: collLabel(res.itemId), score: 1 };
        else if (res.kind === "auto") owned = res.hit;
        else if (res.kind === "suggested")
          owned = { id: res.itemId, label: collLabel(res.itemId), score: res.score };
      } catch {
        /* qualquer erro no casamento vira "sem relação" */
      }
      map.set(lot.id, {
        ai,
        album: albumById.get(lot.id) ?? null,
        market,
        condition,
        demand: demandById.get(lot.id) ?? null,
        owned,
        lookout: lookoutByLot.get(lot.id) ?? null,
        houseLevel: ratingsQuery.data?.houses[houseKey(lot.house)]?.level ?? null,
        possibleTrash: trashById.get(lot.id) ?? null,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collLabel depende de collById
  }, [
    allLots,
    aiById,
    matchesInterest,
    conditionById,
    textRules,
    marketById,
    aiPanelQuery.data,
    ownedAutoById,
    collectionLinksQuery.data,
    collectionFeedbackQuery.data,
    identityById,
    ownedCands,
    collById,
    albumById,
    demandById,
    lookoutByLot,
    ratingsQuery.data,
    trashById,
  ]);

  return {
    insightById,
    albumById,
    evaluated: aiById.size,
    lookoutCount: lookoutCands.length ? lookoutByLot.size : 0,
    lookoutActiveItems,
    aiPanelConfig: aiPanelQuery.data,
  };
}

import { useMemo } from "react";

import {
  toLotAi,
  toLotMarket,
  withConditionAnchor,
  type LotAi,
} from "@/components/vinyl/ai-score-utils";
import { effectiveTextRules } from "@/lib/condition-text";
import { parseConditionFromText, scoreCondition, type Grade } from "@/lib/grading";
import {
  useAiPanelQuery,
  useLotAiQuery,
  useLotConditionQuery,
  useLotIdentQuery,
  useLotMarketQuery,
} from "@/lib/queries";

/**
 * Dados que o `LotCard` completo precisa (nota da IA, mercado Discogs, álbum, estado Disco/Capa
 * e demanda) para UM lote, das mesmas consultas (mesmo cache) da home. Usado pelos diálogos que
 * abrem o cartão completo (De olho e Agendamentos).
 */
export function useLotCardData(lot: { id: string; title: string; uf: string } | null) {
  const aiQuery = useLotAiQuery();
  const identQuery = useLotIdentQuery();
  const marketQuery = useLotMarketQuery();
  const aiPanelQuery = useAiPanelQuery();
  const conditionQuery = useLotConditionQuery();

  const id = lot?.id ?? "";
  const ai = useMemo<LotAi | undefined>(() => {
    const r = (aiQuery.data ?? []).find((x) => x.id === id);
    return r ? toLotAi(r) : undefined;
  }, [aiQuery.data, id]);
  const marketRaw = useMemo(() => {
    const r = (marketQuery.data ?? []).find((x) => x.id === id);
    return r ? toLotMarket(r) : undefined;
  }, [marketQuery.data, id]);
  const album = useMemo(() => {
    const fromAi = (aiQuery.data ?? []).find((x) => x.id === id)?.album;
    return fromAi || (identQuery.data ?? []).find((x) => x.id === id)?.album || null;
  }, [aiQuery.data, identQuery.data, id]);
  const cond = useMemo(() => {
    const r = (conditionQuery.data ?? []).find((x) => x.id === id);
    return r ?? null;
  }, [conditionQuery.data, id]);
  const condition = useMemo(() => {
    if (cond) {
      const { media, sleeve, score, faixa } = scoreCondition(
        (cond.media || null) as Grade | null,
        (cond.sleeve || null) as Grade | null,
      );
      const insert =
        cond.insert_state === "sim"
          ? ("sim" as const)
          : cond.insert_state === "nao"
            ? ("nao" as const)
            : null;
      if (media || sleeve || insert !== null) {
        return { media, sleeve, insert, score, faixa, source: "regex" as const, raw: "" };
      }
    }
    return parseConditionFromText(
      lot?.title ?? "",
      effectiveTextRules(aiPanelQuery.data?.rules, aiPanelQuery.data?.disabledRules),
    );
  }, [cond, lot?.title, aiPanelQuery.data]);
  // Mercado com a âncora de preço da condição (mídia) do lote.
  const market = useMemo(
    () => withConditionAnchor(marketRaw, condition.media, lot?.uf, aiPanelQuery.data),
    [marketRaw, condition.media, lot?.uf, aiPanelQuery.data],
  );

  const demand =
    cond && (cond.views != null || cond.bids != null)
      ? { views: cond.views ?? null, bids: cond.bids ?? null }
      : null;
  return { ai, market, album, condition, demand };
}

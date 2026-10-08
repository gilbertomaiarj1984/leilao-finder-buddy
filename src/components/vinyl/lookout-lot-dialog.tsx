import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";

import { toLotMarket, type LotAi } from "@/components/vinyl/ai-score-utils";
import { LotCard } from "@/components/vinyl/lot-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parseConditionFromText, scoreCondition, type Grade } from "@/lib/grading";
import { getLotCondition } from "@/lib/leiloesbr.functions";
import type { LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";
import { useLotAiQuery, useLotIdentQuery, useLotMarketQuery } from "@/lib/queries";

/**
 * Cartão COMPLETO do lote (o mesmo `LotCard` da home: nota da IA, Discogs, estado Disco/Capa,
 * demanda, tags, vigia…) aberto ao clicar num lote "por vir" da página `/olho`. Os dados vêm das
 * mesmas consultas (mesmo cache) da home.
 */
export function LookoutLotDialog({
  lot,
  item,
  watching,
  busy,
  onWatch,
  onClose,
}: {
  lot: LookoutUpcoming | null;
  item: LookoutItem | null;
  watching: boolean;
  busy: boolean;
  onWatch: (m: LookoutUpcoming) => void;
  onClose: () => void;
}) {
  const aiQuery = useLotAiQuery();
  const identQuery = useLotIdentQuery();
  const marketQuery = useLotMarketQuery();
  const fetchCondition = useServerFn(getLotCondition);
  // Mesma chave da home → compartilha o cache.
  const conditionQuery = useQuery({
    queryKey: ["lot-condition"] as const,
    queryFn: () => fetchCondition(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const id = lot?.lotId ?? "";
  const ai = useMemo<LotAi | undefined>(() => {
    const r = (aiQuery.data ?? []).find((x) => x.id === id);
    return r
      ? {
          score: r.score,
          rarity: r.rarity,
          deal: r.deal,
          album: r.album,
          reason: r.reason,
          tags: r.tags,
          evalPrice: r.eval_price,
          tracklist: r.tracklist,
        }
      : undefined;
  }, [aiQuery.data, id]);
  const market = useMemo(() => {
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
    return parseConditionFromText(lot?.title ?? "");
  }, [cond, lot?.title]);

  return (
    <Dialog open={lot != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-3">
        <DialogTitle className="sr-only">Lote por vir</DialogTitle>
        <DialogDescription className="sr-only">
          Cartão completo do lote, com avaliação da IA, mercado, estado e ações.
        </DialogDescription>
        {lot ? (
          <LotCard
            lot={{
              id: lot.lotId,
              title: lot.title,
              url: lot.url,
              image: lot.image,
              price: lot.price,
              time: lot.time,
              house: lot.house,
              uf: lot.uf,
              dayKey: lot.dayKey,
              watched: watching,
              lote: lot.lote,
            }}
            busy={busy}
            showDate
            onToggle={() => onWatch(lot)}
            ai={ai}
            market={market}
            album={album}
            condition={condition}
            demand={
              cond && (cond.views != null || cond.bids != null)
                ? { views: cond.views ?? null, bids: cond.bids ?? null }
                : null
            }
            lookout={{ on: true, hit: null, maxPrice: item?.maxPrice ?? null }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

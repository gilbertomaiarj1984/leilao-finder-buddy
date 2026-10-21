import { useMemo } from "react";

import type { MyBid } from "@/lib/leiloesbr-bids.server";
import type { WatchedLot } from "@/lib/leiloesbr-watch.server";
import { BAR_FORWARD_DAYS, buildBarDays, DAY_PAGE, shiftDayKey, TODAY_INDEX } from "@/lib/day-bar";
import { useLotsQuery, useLotsRangeQueries } from "@/lib/queries";
import { brDateToDayKey, type VinylLot } from "@/lib/vinyl-parse";

/** Páginas de 5 dias da barra da Análise: hoje..+4, +5..+9, +10..+14. */
export const ANALISE_PAGES = BAR_FORWARD_DAYS / DAY_PAGE;

/**
 * Lotes da Análise: HOJE + 14 dias à frente (a mesma quantidade da barra da home, sem o
 * histórico — passado não interessa aqui). A janela padrão (hoje..+4) vem da varredura; as demais
 * páginas e tudo depois do último dia da barra vêm do banco, SEM varrer o site. Lotes que você
 * vigia ou tem lance entram sempre, mesmo futuros e fora do banco (montados a partir da conta).
 * Lote do De olho já está no banco como qualquer outro, então aparece nas mesmas páginas.
 */
export function useAnaliseLots(
  watched: readonly WatchedLot[] | undefined,
  bids: readonly MyBid[] | undefined,
) {
  const base = useLotsQuery();
  const todayKey = base.data?.days[0] ?? null;
  const barDays = useMemo(
    () => (todayKey ? buildBarDays(todayKey).slice(TODAY_INDEX) : []),
    [todayKey],
  );
  const lastBarDay = barDays[barDays.length - 1];

  const ranges = useMemo(() => {
    if (!barDays.length || !lastBarDay) return [];
    const pages = Array.from({ length: ANALISE_PAGES - 1 }, (_, i) => {
      const page = i + 1;
      return { from: barDays[page * DAY_PAGE]!, to: barDays[page * DAY_PAGE + DAY_PAGE - 1]! };
    });
    // Tudo depois do último dia da barra ("Dias Futuros"): leilões marcados com muita antecedência.
    // `beyond`: não corta em hoje+14 (inclui os lotes de vigia/lance/De olho gravados além da janela).
    return [
      ...pages,
      { from: shiftDayKey(lastBarDay, 1), to: shiftDayKey(lastBarDay, 365), beyond: true },
    ];
  }, [barDays, lastBarDay]);
  const rangeQueries = useLotsRangeQueries(ranges.length ? ranges : [null]);
  const rangeStamp = rangeQueries.map((q) => q.dataUpdatedAt).join(",");

  const lots = useMemo(() => {
    if (!base.data) return [];
    const byId = new Map<string, VinylLot>();
    for (const q of rangeQueries) for (const lot of q.data?.lots ?? []) byId.set(lot.id, lot);
    for (const lot of base.data.lots) byId.set(lot.id, lot);
    const dayById = new Map<string, string>();
    // Vigiados que o banco não tem (ex.: leilão fora da varredura): entram com o dia da conta.
    for (const w of watched ?? []) {
      const dayKey = brDateToDayKey(w.date);
      if (dayKey) dayById.set(w.id, dayKey);
      if (byId.has(w.id) || !dayKey || dayKey < (todayKey ?? "")) continue;
      byId.set(w.id, {
        id: w.id,
        idPeca: w.idPeca,
        idLeilao: w.idLeilao,
        base: w.base,
        lote: w.lote,
        watched: true,
        title: w.title,
        url: w.url,
        image: w.image,
        price: w.price,
        dayKey,
        time: w.time,
        uf: w.uf,
        house: w.house,
        houseUrl: w.houseUrl,
        artist: w.artist,
      });
    }
    // Lances: a conta traz a data do LANCE, não a do pregão; o dia só é conhecido quando o lote
    // está no banco ou entre os vigiados (senão fica sem dia: aparece em "Todos").
    for (const b of bids ?? []) {
      if (byId.has(b.id)) continue;
      byId.set(b.id, {
        id: b.id,
        idPeca: b.idPeca,
        idLeilao: b.idLeilao,
        base: b.base,
        lote: b.lote,
        watched: b.watched,
        title: b.title,
        url: b.url,
        image: b.image,
        price: b.myBid,
        dayKey: dayById.get(b.id) ?? "",
        time: "",
        uf: b.uf,
        house: b.house,
        houseUrl: "#",
        artist: "",
      });
    }
    return [...byId.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rangeStamp` representa `rangeQueries`
  }, [base.data, rangeStamp, watched, bids, todayKey]);

  return {
    lots,
    todayKey,
    barDays,
    /** Dias que a varredura padrão cobre (a análise sob demanda só enxerga estes). */
    windowDays: base.data?.days ?? [],
    isLoading: base.isLoading,
    isError: base.isError,
    error: base.error,
    pageLoading: rangeQueries.some((q) => q.isLoading),
  };
}

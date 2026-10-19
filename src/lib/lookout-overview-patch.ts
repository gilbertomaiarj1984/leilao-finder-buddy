import type { LookoutOverview } from "@/lib/lookout-matches.server";

/**
 * Efeito local (otimista) de gravar o vínculo de lotes na visão `/olho`, antes do servidor
 * recalcular os matches: `false` = "não é este disco" (some de "por vir" e das aparições);
 * `itemId` = "é este disco" / mover (o lote vai para o disco, já confirmado). O recálculo real
 * (`refresh`) corrige qualquer diferença depois.
 */
export function applyLookoutLinks(
  o: LookoutOverview,
  lotIds: readonly string[],
  value: string | false,
): LookoutOverview {
  const ids = new Set(lotIds);
  if (!ids.size) return o;
  if (value === false) {
    const upcoming = o.upcoming.filter((m) => !ids.has(m.lotId));
    return {
      ...o,
      upcoming,
      history: o.history.filter((h) => !ids.has(h.lotId)),
      newCount: upcoming.filter((m) => m.isNew).length,
    };
  }
  return {
    ...o,
    upcoming: o.upcoming.map((m) =>
      ids.has(m.lotId) ? { ...m, itemId: value, confirmed: true, yearPending: false } : m,
    ),
    history: o.history.map((h) => (ids.has(h.lotId) ? { ...h, itemId: value, pending: false } : h)),
  };
}

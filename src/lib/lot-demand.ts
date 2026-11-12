/**
 * Demanda (visitas e lances) dos lotes: regras PURAS de quem precisa ser relido e de como mostrar
 * a idade da leitura. O I/O (catálogo da casa + gravação) fica em `lot-demand.server.ts`.
 */

/** Só relê um lote cuja última leitura tenha mais que isto (evita bater na casa à toa). */
const DEMAND_MIN_AGE_MS = 15 * 60_000;

export type DemandCandidate = {
  id: string;
  dayKey: string;
  time?: string | null;
  /** `lot_condition.demand_at` (ISO) ou null quando nunca lido. */
  demandAt?: string | null;
  /** `<domínio>|<idLeilao>` — um leilão = 1 requisição de catálogo. */
  auctionKey: string;
};

/**
 * Escolhe os leilões a reler: só lotes dos dias pedidos e com leitura velha (ou nunca feita);
 * os leilões cujo dado está mais velho vêm primeiro (rodízio justo), desempate pelo horário.
 */
export function pickDemandAuctions(
  lots: readonly DemandCandidate[],
  dayKeys: readonly string[],
  now = Date.now(),
  minAgeMs = DEMAND_MIN_AGE_MS,
): { auctionKey: string; ids: string[]; oldest: number }[] {
  const days = new Set(dayKeys);
  const byAuction = new Map<string, { ids: string[]; oldest: number; soonest: string }>();
  for (const l of lots) {
    if (!days.has(l.dayKey)) continue;
    const at = l.demandAt ? Date.parse(l.demandAt) : 0;
    if (Number.isFinite(at) && at > 0 && now - at < minAgeMs) continue;
    const when = `${l.dayKey} ${l.time ?? ""}`;
    const cur = byAuction.get(l.auctionKey) ?? { ids: [], oldest: Infinity, soonest: when };
    cur.ids.push(l.id);
    cur.oldest = Math.min(cur.oldest, Number.isFinite(at) ? at : 0);
    if (when < cur.soonest) cur.soonest = when;
    byAuction.set(l.auctionKey, cur);
  }
  return [...byAuction.entries()]
    .sort((a, b) => a[1].oldest - b[1].oldest || a[1].soonest.localeCompare(b[1].soonest))
    .map(([auctionKey, v]) => ({ auctionKey, ids: v.ids, oldest: v.oldest }));
}

/** "agora", "há 12 min", "há 3 h", "há 2 d" — ou null sem leitura. */
export function demandAgeLabel(at: string | null | undefined, now = Date.now()): string | null {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/** Leitura velha demais (> 3 h) para um lote que ainda vai a pregão: o selo fica esmaecido. */
export function isDemandStale(at: string | null | undefined, now = Date.now()): boolean {
  const t = at ? Date.parse(at) : NaN;
  return !Number.isFinite(t) || now - t > 3 * 3_600_000;
}

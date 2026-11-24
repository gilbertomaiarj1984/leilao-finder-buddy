import { auctionStartMs } from "./vinyl-parse";

/** Faixas de proximidade do lote acompanhado em relação ao lote em pregão agora. */
export type FollowTone = "near" | "mid" | "far" | "none";

/** Lotes que faltam para o seu lote chegar (≤ 0 = em pregão agora ou já passou). null = sem nº legível. */
export function lotDistance(lote: string | null, currentLote: string | null): number | null {
  const n = Number.parseInt(lote ?? "", 10);
  const cur = Number.parseInt(currentLote ?? "", 10);
  if (!Number.isFinite(n) || !Number.isFinite(cur)) return null;
  return n - cur;
}

/** Vermelho (≤ 3 lotes), amarelo (≤ 15) e verde (longe). Sem distância ou já passou → "none". */
export function followTone(distance: number | null): FollowTone {
  if (distance === null) return "none";
  if (distance <= 3) return "near";
  if (distance <= 15) return "mid";
  return "far";
}

const MAX_RUN_MIN = 14 * 60;

/**
 * Minutos estimados até o lote chegar: ritmo médio do pregão (minutos desde o início ÷ peças já
 * passadas) × lotes que faltam. null enquanto não há base (menos de 5 peças feitas, início
 * ilegível, pregão ainda não começou ou rodando há mais de 14 h — multi-dia).
 */
export function etaMinutes(opts: {
  dayKey: string;
  time: string;
  peca: number | null;
  distance: number | null;
  now?: number;
}): number | null {
  const { dayKey, time, peca, distance } = opts;
  if (distance === null || distance <= 0 || peca === null || peca < 5) return null;
  const start = auctionStartMs(dayKey, time);
  if (start === null) return null;
  const elapsedMin = ((opts.now ?? Date.now()) - start) / 60000;
  if (elapsedMin <= 0 || elapsedMin > MAX_RUN_MIN) return null;
  return Math.max(1, Math.round((elapsedMin / peca) * distance));
}

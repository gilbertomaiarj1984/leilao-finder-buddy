// Filtro por dia da página /olho: os próximos 10 dias (hoje + 9) como chips, cada um com a
// contagem de lotes por vir daquele dia. Módulo puro/client-safe.
import { shiftDayKey } from "@/lib/day-bar";

export const LOOKOUT_DAY_COUNT = 10;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type LookoutDayOption = {
  dayKey: string;
  /** "Hoje" no primeiro dia; nos demais o dia da semana abreviado. */
  weekday: string;
  /** `dd/mm`. */
  label: string;
  /** Lotes por vir (casamentos) naquele dia. */
  count: number;
};

/** Os `count` dias a partir de `todayKey`, com a contagem de `matches` em cada um. */
export function lookoutDayOptions(
  todayKey: string,
  matches: readonly { dayKey: string }[],
  count = LOOKOUT_DAY_COUNT,
): LookoutDayOption[] {
  const perDay = new Map<string, number>();
  for (const m of matches) perDay.set(m.dayKey, (perDay.get(m.dayKey) ?? 0) + 1);
  return Array.from({ length: count }, (_, i) => {
    const dayKey = shiftDayKey(todayKey, i);
    const [y, mo, d] = dayKey.split("-").map(Number);
    const dow = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1)).getUTCDay();
    return {
      dayKey,
      weekday: i === 0 ? "Hoje" : (WEEKDAYS[dow] ?? ""),
      label: `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`,
      count: perDay.get(dayKey) ?? 0,
    };
  });
}

/** Só os lotes do dia escolhido; sem dia (`""`) devolve tudo. */
export function filterByLookoutDay<T extends { dayKey: string }>(
  matches: readonly T[],
  dayKey: string,
): readonly T[] {
  return dayKey ? matches.filter((m) => m.dayKey === dayKey) : matches;
}

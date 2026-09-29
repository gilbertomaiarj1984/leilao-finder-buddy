// Barra de dias da home: 10 dias de histórico + hoje + 14 à frente = 25 dias, paginados de 5 em 5
// (2 páginas para trás, a página de hoje, 2 para frente). Módulo puro/client-safe.
export const DAY_PAGE = 5;
export const BAR_HISTORY_DAYS = 10;
export const BAR_FORWARD_DAYS = 15; // hoje + 14
export const TODAY_INDEX = 10; // = BAR_HISTORY_DAYS
export const TODAY_PAGE = Math.floor(TODAY_INDEX / DAY_PAGE);
export const BAR_PAGES = (BAR_HISTORY_DAYS + BAR_FORWARD_DAYS) / DAY_PAGE;

/** `YYYY-MM-DD` deslocado em `delta` dias (aritmética em UTC, sem efeito de fuso). */
export function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Todos os dias da barra, do mais antigo ao mais distante; `todayKey` fica em `TODAY_INDEX`. */
export function buildBarDays(todayKey: string): string[] {
  return Array.from({ length: BAR_HISTORY_DAYS + BAR_FORWARD_DAYS }, (_, i) =>
    shiftDayKey(todayKey, i - BAR_HISTORY_DAYS),
  );
}

// Acumulador client-safe de "vigiados"/"lances vistos", compartilhado entre TODAS as rotas
// que leem `["vinyl-watched"]`/`["vinyl-my-bids"]` (`index.tsx` E `analise.tsx`). A conta do
// LeilõesBR (`l=8`/`l=4`) pode parar de trazer um lote assim que o leilão termina — sem
// mesclar (nunca substituir) os fetches novos num acumulador local por `id`, o card do
// vigiado/lance desaparecia da tela assim que o leilão acabava, mesmo ainda sendo "hoje".
// ⚠️ As DUAS rotas precisam usar EXATAMENTE esta mesma lógica: como o `QueryClient` é
// compartilhado pelo app inteiro, duas `useQuery` com a MESMA chave (`["vinyl-watched"]`) mas
// `queryFn` divergentes (uma mesclando, outra substituindo) fazem a versão "substitui" de uma
// rota apagar o acumulado da outra ao navegar entre elas — foi exatamente essa divergência
// (fix original só em `index.tsx`) que fazia os vigiados "sumirem depois de um tempo" mesmo
// com o acumulador certo já existindo ali.
import { upcomingDayKeys } from "./vinyl-parse";

// Espelha o `WINDOW_DAYS` do servidor (`leiloesbr-scrape.server.ts`) — janela de poda do
// acumulador (um item só sai quando o dia dele já saiu dessa janela, ou é removido explicitamente).
export const WATCH_WINDOW_DAYS = 5;
export const WATCHED_ACCUM_STORAGE_KEY = "leilao-finder:watched-accum:v1";
export const BIDS_ACCUM_STORAGE_KEY = "leilao-finder:bids-accum:v1";

/** "dd/mm/yyyy" (vigiados/lances) -> "yyyy-mm-dd" (dayKey). Duplicado de
 * `grouping.ts#watchedDateToKey` para este módulo não depender de código com JSX ao lado. */
function dateToKey(value: string): string {
  const [dd, mm, yy] = value.split("/");
  return yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
}

/** Lê o acumulador salvo em `localStorage` (best-effort: SSR, aba anônima ou JSON corrompido
 * simplesmente devolvem um mapa vazio, nunca quebram a tela). */
export function loadAccum<T>(key: string): Map<string, T> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as [string, T][]);
  } catch {
    return new Map();
  }
}

/** Grava o acumulador em `localStorage` (best-effort — indisponível/cheio nunca quebra a tela). */
export function saveAccum<T>(key: string, acc: Map<string, T>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...acc]));
  } catch {
    // ignora — o acumulador em memória continua valendo pelo resto da sessão
  }
}

/**
 * Mescla `fresh` (resultado cru do fetch na conta) no acumulador por `id`, poda o que já saiu
 * da janela de dias, persiste em `localStorage` e devolve a lista resultante. Usar no `queryFn`
 * de TODA `useQuery` que leia `["vinyl-watched"]`/`["vinyl-my-bids"]`.
 */
export function mergeWatchedAccum<T extends { id: string; date: string }>(
  acc: Map<string, T>,
  fresh: T[],
  storageKey: string,
): T[] {
  for (const item of fresh) acc.set(item.id, item);
  const validDays = new Set(upcomingDayKeys(WATCH_WINDOW_DAYS));
  for (const [id, item] of acc) if (!validDays.has(dateToKey(item.date))) acc.delete(id);
  saveAccum(storageKey, acc);
  return [...acc.values()];
}

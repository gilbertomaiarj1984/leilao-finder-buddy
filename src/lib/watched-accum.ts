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
import { auctionFinished, recentDayKeys, upcomingDayKeys } from "./vinyl-parse";

// Para lances (`MyBid`), `date` é o dia em que o lance foi DADO (normalmente hoje ou um pouco
// antes do pregão), não o dia do leilão — ao contrário de `WatchedLot`. Por isso a poda de
// lances olha para os últimos N dias (passado), não para os próximos (`upcomingDayKeys`), com
// margem suficiente para cobrir o intervalo entre dar o lance e o leilão fechar.
export const BID_RETENTION_DAYS = 14;
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
export function mergeWatchedAccum<T extends { id: string; date: string; time?: string }>(
  acc: Map<string, T>,
  fresh: T[],
  storageKey: string,
): T[] {
  const freshIds = new Set(fresh.map((item) => item.id));
  for (const item of fresh) acc.set(item.id, item);
  const todayKey = upcomingDayKeys(1)[0];
  const validBidDays = new Set(recentDayKeys(BID_RETENTION_DAYS));
  for (const [id, item] of acc) {
    const dayKey = dateToKey(item.date);
    // `item.time` só existe em `WatchedLot` — ali `date` é o dia do LEILÃO. A poda aqui só olha
    // para TRÁS (dia já passado, sem data legível): vigiados de leilões FUTUROS ficam visíveis
    // mesmo além da janela de scraping do servidor (`WINDOW_DAYS`,
    // `leiloesbr-scrape.server.ts`) — o lote ainda não estar "na ferramenta" (na tabela `lots`)
    // não significa que a vigia não exista; ela vem direto da conta do LeilõesBR (`l=8`). Em
    // `MyBid` (sem `time`), `date` é o dia em que o lance foi DADO — normalmente hoje ou um
    // pouco antes do pregão —, então a poda olha para trás (`recentDayKeys`); podar pela janela
    // "só futuro" apagava o lance do acumulador assim que ele era mesclado, e o card nunca
    // chegava a mostrar "Meu lance".
    if (item.time !== undefined) {
      if (!dayKey || dayKey < todayKey) {
        acc.delete(id);
        continue;
      }
      // Ausente do fresh só remove aqui se o leilão NÃO estiver terminado: se ainda está
      // rolando e sumiu do fresh, a vigia foi removida de fato (ex.: pelo próprio usuário no
      // site do LeilõesBR) e o card deve sumir também aqui, sem esperar o dia virar passado —
      // do contrário o card ficava "preso" como vigiado até o dia seguinte ao leilão.
      if (!freshIds.has(id) && !auctionFinished(dayKey, item.time)) {
        acc.delete(id);
      }
    } else if (!validBidDays.has(dayKey)) {
      acc.delete(id);
    }
  }
  saveAccum(storageKey, acc);
  return [...acc.values()];
}

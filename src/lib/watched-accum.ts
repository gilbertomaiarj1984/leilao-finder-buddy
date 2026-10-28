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
import type { MyBid } from "./leiloesbr-bids.server";
import type { WatchedLot } from "./leiloesbr-watch.server";
import { auctionStarted, recentDayKeys, upcomingDayKeys } from "./vinyl-parse";

// Para lances (`MyBid`), `date` é o dia em que o lance foi DADO (normalmente hoje ou um pouco
// antes do pregão), não o dia do leilão — ao contrário de `WatchedLot`. Um lance para um leilão
// futuro tem que continuar aparecendo (nunca é podado por estar "à frente"); só os lances
// PASSADOS saem, e só depois de `BID_RETENTION_DAYS` dias (hoje + esta margem para trás).
const BID_RETENTION_DAYS = 3; // hoje + 2 dias pra trás
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
 * Poda por DATA de um item do acumulador (sem olhar o fetch fresco). `item.time` só existe em
 * `WatchedLot` — ali `date` é o dia do LEILÃO: sai quando o dia já passou (ou é ilegível); vigiados
 * de leilões FUTUROS ficam visíveis mesmo além da janela de scraping do servidor (`WINDOW_DAYS`,
 * `leiloesbr-scrape.server.ts`) — a vigia vem direto da conta do LeilõesBR (`l=8`). Em `MyBid`
 * (sem `time`), `date` é o dia em que o lance foi DADO — normalmente hoje ou um pouco antes do
 * pregão. Dias FUTUROS nunca são podados (senão o lance sumia assim que era mesclado, e o card
 * nunca chegava a mostrar "Meu lance"); só os dias já passados caem na janela de retenção
 * (`recentDayKeys(BID_RETENTION_DAYS)`).
 */
function accumItemExpired(
  item: { date: string; time?: string },
  todayKey: string,
  validBidDays: Set<string>,
): boolean {
  const dayKey = dateToKey(item.date);
  if (item.time !== undefined) return !dayKey || dayKey < todayKey;
  if (dayKey && dayKey > todayKey) return false;
  return !validBidDays.has(dayKey);
}

/**
 * Último estado conhecido (acumulador do `localStorage`), já sem os itens vencidos por data —
 * mostrado como `placeholderData` enquanto a conta é lida (v0.155.0), para a aba abrir na hora.
 * Não altera o acumulador; `undefined` quando vazio (aí a tela mostra o carregando normal).
 */
export function accumSnapshot<T extends { date: string; time?: string }>(
  acc: Map<string, T>,
): T[] | undefined {
  const todayKey = upcomingDayKeys(1)[0]!;
  const validBidDays = new Set(recentDayKeys(BID_RETENTION_DAYS));
  const items = [...acc.values()].filter((item) => !accumItemExpired(item, todayKey, validBidDays));
  return items.length ? items : undefined;
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
  removedIds: ReadonlySet<string> = new Set(),
): T[] {
  const freshIds = new Set(fresh.map((item) => item.id));
  for (const item of fresh) acc.set(item.id, item);
  const todayKey = upcomingDayKeys(1)[0]!;
  const validBidDays = new Set(recentDayKeys(BID_RETENTION_DAYS));
  for (const [id, item] of acc) {
    if (accumItemExpired(item, todayKey, validBidDays)) {
      acc.delete(id);
      continue;
    }
    // Desvigiado em OUTRO dispositivo: a conta já não traz o lote, mas com o leilão em andamento
    // a regra abaixo o manteria aqui. `removedIds` (servidor) é quem diz que foi desvigia de fato.
    if (removedIds.has(id) && !freshIds.has(id)) {
      acc.delete(id);
      continue;
    }
    // Ausente do fresh só remove aqui se o leilão AINDA NÃO começou (depois de iniciado a conta
    // pode parar de trazer o lote ao fim do pregão e o card tem que ficar): se sumiu do fresh, a
    // vigia foi removida de fato (ex.: pelo próprio usuário no site do LeilõesBR) e o card deve
    // sumir também aqui, sem esperar o dia virar passado — do contrário o card ficava "preso"
    // como vigiado até o dia seguinte ao leilão. Só vale para `WatchedLot` (tem `time`).
    if (
      item.time !== undefined &&
      !freshIds.has(id) &&
      !auctionStarted(dateToKey(item.date), item.time)
    ) {
      acc.delete(id);
    }
  }
  saveAccum(storageKey, acc);
  return [...acc.values()];
}

/**
 * Lista das telas de Vigiados: os vigiados da conta + os lotes com MEU LANCE que não estão na
 * vigia (dar lance não vigia o lote no LeilõesBR, e o lote sumia dessas telas). Casa por `id`
 * (`idPeca` só é único dentro da casa); o vigiado real vence. `dayKeyOf` dá o dia do LEILÃO do
 * lance (não o do lance) e, como os vigiados, só entram lotes de hoje em diante. Não mexe nos
 * acumuladores — o lote continua "não vigiado" (botão Vigiar) e só aparece na lista.
 */
export function withBidsAsWatched(
  watched: WatchedLot[],
  bids: MyBid[],
  todayKey: string,
  opts: {
    dayKeyOf: (bid: MyBid) => string;
    timeOf: (dayKey: string, house: string, idLeilao: string) => string;
    artistOf: (title: string) => string;
  },
): WatchedLot[] {
  const have = new Set(watched.map((w) => w.id));
  const extra: WatchedLot[] = [];
  for (const b of bids) {
    if (!b.id || have.has(b.id)) continue;
    const dayKey = opts.dayKeyOf(b);
    const [yyyy, mm, dd] = dayKey.split("-");
    if (!yyyy || !mm || !dd || dayKey < todayKey) continue;
    have.add(b.id);
    extra.push({
      id: b.id,
      idPeca: b.idPeca,
      idLeilao: b.idLeilao,
      base: b.base,
      lote: b.lote,
      title: b.title,
      url: b.url,
      image: b.image,
      price: "",
      date: `${dd}/${mm}/${yyyy}`,
      time: opts.timeOf(dayKey, b.house, b.idLeilao),
      house: b.house,
      houseUrl: "",
      uf: b.uf,
      artist: opts.artistOf(b.title),
      watched: true,
    });
  }
  return extra.length ? [...watched, ...extra] : watched;
}

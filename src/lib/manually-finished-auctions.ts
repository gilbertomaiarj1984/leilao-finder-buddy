/**
 * "Marcar pregão como encerrado" — override manual, só no navegador (sem servidor), pra quando
 * NENHUM dos sinais automáticos de fim de pregão dispara: o sinal preciso (`getPresencialNow`,
 * peça atual = total) costuma parar de responder assim que o pregão termina de verdade (em vez
 * de ficar parado em "peça = total"), e não existe mais janela fixa de horas (removida na v0.112.2) — sem sinal
 * automático, o pregão de hoje só vira "encerrado" por esta marcação (reversível: `unmarkManuallyFinished`). Achado do usuário: casa com pregão claramente
 * terminado (site já não mostra mais lotes ao vivo) continuava sem o acesso aos lotes sem
 * lance por bastante tempo.
 *
 * ⚠️ **Chave inclui o dia** (`idLeilao:dayKey`, não só `idLeilao`): achado do usuário — em
 * casas cujo catálogo se estende por mais de um dia (mesmo `idLeilao`, dias diferentes,
 * mesmo problema de `unsold-lots.server.ts`), marcar "encerrado" no dia de hoje fazia o link
 * "lotes sem lance" aparecer também nas linhas de dias FUTUROS da mesma casa (ainda "Em
 * breve"), porque a chave era só o `idLeilao` — compartilhado entre todos os dias do catálogo.
 *
 * Guardado com timestamp, podado após `MAX_AGE_MS` pra não crescer sem limite (mesmo espírito
 * de outras listas client-side deste app — ver `docs/areas/ui.md`).
 */
const STORAGE_KEY = "manually-finished-auctions";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Store = Record<string, number>;

function storeKey(idLeilao: string, dayKey: string): string {
  return `${idLeilao}:${dayKey}`;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    const now = Date.now();
    const pruned: Store = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "number" && now - at < MAX_AGE_MS) pruned[id] = at;
    }
    return pruned;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage indisponível (aba privada, quota, SSR) — best-effort, sem quebrar a UI.
  }
}

export function isManuallyFinished(idLeilao: string, dayKey: string): boolean {
  return Boolean(readStore()[storeKey(idLeilao, dayKey)]);
}

export function markManuallyFinished(idLeilao: string, dayKey: string): void {
  const store = readStore();
  store[storeKey(idLeilao, dayKey)] = Date.now();
  writeStore(store);
}

export function unmarkManuallyFinished(idLeilao: string, dayKey: string): void {
  const store = readStore();
  delete store[storeKey(idLeilao, dayKey)];
  writeStore(store);
}

const CHANGE_EVENT = "manually-finished-change";

/** Avisa os componentes (mesma aba) que a marcação mudou — ver `useManuallyFinished`. */
export function notifyManuallyFinishedChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeManuallyFinished(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

/**
 * "Marcar pregão como encerrado" — override manual, só no navegador (sem servidor), pra quando
 * NENHUM dos sinais automáticos de fim de pregão dispara: o sinal preciso (`getPresencialNow`,
 * peça atual = total) costuma parar de responder assim que o pregão termina de verdade (em vez
 * de ficar parado em "peça = total"), e a heurística de 3h (`auctionFinished`, usada como
 * fallback) só dispara 3h depois do horário de início — leilões mais rápidos que isso (comum)
 * ficam sem nenhum sinal até completar as 3h. Achado do usuário: casa com pregão claramente
 * terminado (site já não mostra mais lotes ao vivo) continuava sem o acesso aos lotes sem
 * lance por bastante tempo.
 *
 * Guardado por `idLeilao` com timestamp, podado após `MAX_AGE_MS` pra não crescer sem limite
 * (mesmo espírito de outras listas client-side deste app — ver `docs/areas/ui.md`).
 */
const STORAGE_KEY = "manually-finished-auctions";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Store = Record<string, number>;

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

export function isManuallyFinished(idLeilao: string): boolean {
  return Boolean(readStore()[idLeilao]);
}

export function markManuallyFinished(idLeilao: string): void {
  const store = readStore();
  store[idLeilao] = Date.now();
  writeStore(store);
}

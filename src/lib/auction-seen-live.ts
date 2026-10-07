/**
 * Lembra no navegador (`localStorage`) que um pregão já foi visto AO VIVO (peça atual < total)
 * — quando o presencial para de responder depois disso, o pregão acabou (`trackedAuctionStatus`).
 * Chave `idLeilao:dayKey`, podada após 48h. Best-effort: sem `localStorage`, nada quebra.
 */
const STORAGE_KEY = "auctions-seen-live";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

function readStore(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, at]) => typeof at === "number" && now - at < MAX_AGE_MS),
    );
  } catch {
    return {};
  }
}

export function isSeenLive(idLeilao: string, dayKey: string): boolean {
  return Boolean(readStore()[`${idLeilao}:${dayKey}`]);
}

export function markSeenLive(idLeilao: string, dayKey: string): void {
  try {
    const store = readStore();
    store[`${idLeilao}:${dayKey}`] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage indisponível — best-effort.
  }
}

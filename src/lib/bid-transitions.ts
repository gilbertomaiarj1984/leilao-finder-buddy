import { bidIsCovered } from "./vinyl-parse";

/**
 * Lances que ACABARAM de virar "Coberto" (alguém deu um lance maior) comparando com o último
 * status visto por lote. Puro: usado pelo toast do app aberto (`bid-alerts.ts`) e pelo push do
 * cron (`bid-notify.server.ts`). Lote sem registro anterior e já coberto conta como novo — quem
 * não quer avisar na 1ª leitura (cron) deve tratar o snapshot ausente antes de chamar.
 */
export function newlyCoveredBids<T extends { id: string; status: string }>(
  bids: T[],
  prevSnapshot: Map<string, string>,
): { newlyCovered: T[]; nextSnapshot: Map<string, string> } {
  const nextSnapshot = new Map(prevSnapshot);
  const newlyCovered: T[] = [];
  for (const bid of bids) {
    const prevStatus = prevSnapshot.get(bid.id);
    if (bidIsCovered(bid.status) && (prevStatus === undefined || !bidIsCovered(prevStatus))) {
      newlyCovered.push(bid);
    }
    nextSnapshot.set(bid.id, bid.status);
  }
  return { newlyCovered, nextSnapshot };
}

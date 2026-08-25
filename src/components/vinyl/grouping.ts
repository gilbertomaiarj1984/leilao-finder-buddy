// Helpers puros de agrupamento/ordenação e tipos compartilhados pela listagem de
// vinil. Sem JSX — a UI que consome isto vive nos componentes ao lado.
import {
  bidIsWinning,
  normalizeForMatch,
  parsePrice,
  UNCLASSIFIED_LABEL,
  type VinylLot,
} from "@/lib/vinyl-parse";

export function dayLabel(dayKey: string, index: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  const prefix = index === 0 ? "Hoje" : index === 1 ? "Amanhã" : weekday.replace(".", "");
  return `${prefix} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export type ArtistGroup = { artist: string; lots: VinylLot[] };
export type HouseGroup = {
  house: string;
  houseUrl: string;
  time: string;
  lots: VinylLot[];
  artists: ArtistGroup[];
  count: number;
};

export function groupByArtist(lots: VinylLot[]): ArtistGroup[] {
  const byArtist = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const key = lot.artist || UNCLASSIFIED_LABEL;
    const list = byArtist.get(key) ?? [];
    list.push(lot);
    byArtist.set(key, list);
  }
  return [...byArtist.entries()]
    .map(([artist, list]) => ({ artist, lots: list }))
    .sort((a, b) => {
      if (a.artist === UNCLASSIFIED_LABEL) return 1;
      if (b.artist === UNCLASSIFIED_LABEL) return -1;
      return a.artist.localeCompare(b.artist, "pt-BR");
    });
}

export function groupByHouse(lots: VinylLot[]): HouseGroup[] {
  const houses = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const list = houses.get(lot.house) ?? [];
    list.push(lot);
    houses.set(lot.house, list);
  }

  return [...houses.entries()]
    .map(([house, houseLots]) => ({
      house,
      houseUrl: houseLots[0]?.houseUrl ?? "#",
      time: houseLots[0]?.time ?? "",
      lots: houseLots,
      artists: groupByArtist(houseLots),
      count: houseLots.length,
    }))
    .sort((a, b) => b.count - a.count || a.house.localeCompare(b.house, "pt-BR"));
}

export type HouseStats = { vigia: number; green: number; red: number };

/**
 * Conta, para um conjunto de lotes, quantos estão vigiados e quantos têm lance
 * ganhando (verde) ou coberto (vermelho) — mesma regra de cor do LotCard.
 */
export function computeHouseStats(
  lots: { idPeca: string }[],
  watchedIds: Set<string>,
  bidStatusById: Map<string, string>,
): HouseStats {
  let vigia = 0;
  let green = 0;
  let red = 0;
  for (const lot of lots) {
    const status = bidStatusById.get(lot.idPeca);
    if (status) {
      // Mesma prioridade das cores do card: lance ganhando = verde, coberto = vermelho.
      if (bidIsWinning(status)) green += 1;
      else red += 1;
    } else if (watchedIds.has(lot.idPeca)) {
      // Vigiado sem lance = amarelo (nº de vigia).
      vigia += 1;
    }
  }
  return { vigia, green, red };
}

/**
 * Classifica o status de um lance dado na conta (conta_site.asp?l=4):
 * - "winning": vencendo agora (ganhando)
 * - "won": vencedor / arrematado — o leilão já passou e você levou
 * - "covered": coberto — alguém cobriu o seu lance
 * - "lost": não vendido / demais casos
 */
export type BidState = "winning" | "won" | "covered" | "lost";

export function classifyBid(status: string): BidState {
  const s = (status ?? "").toLowerCase();
  if (/arremat|vencedor|arrebat/.test(s)) return "won";
  if (/venc/.test(s)) return "winning";
  if (/cobert/.test(s)) return "covered";
  return "lost";
}

export type BidStats = { winning: number; won: number; covered: number; lost: number };

export function computeBidStats(bids: { status: string }[]): BidStats {
  const stats: BidStats = { winning: 0, won: 0, covered: 0, lost: 0 };
  for (const bid of bids) stats[classifyBid(bid.status)] += 1;
  return stats;
}

// Faixas de valor por casa. Preço vem como "R$ 1.234,56" (BR): ponto de milhar,
// vírgula decimal. Lotes sem valor numérico entram na faixa "Menor de 50".
export const PRICE_OPTIONS = [
  { value: "lt50", label: "Menor de 50" },
  { value: "r51_100", label: "De 51 a 100" },
  { value: "r101_150", label: "De 101 a 150" },
  { value: "gt150", label: "Acima de 150" },
] as const;

export function matchesPriceRange(raw: string, range: string): boolean {
  if (!range) return true;
  const value = parsePrice(raw);
  if (value === null) return range === "lt50"; // sem valor: sempre visível, na faixa "Menor de 50"
  if (range === "lt50") return value <= 50;
  if (range === "r51_100") return value > 50 && value <= 100;
  if (range === "r101_150") return value > 100 && value <= 150;
  return value > 150; // gt150
}

export function houseAnchor(house: string, dayIndex: number): string {
  return `casa-${dayIndex}-${house
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export function artistOptions(lots: VinylLot[]): { artist: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    const key = lot.artist || UNCLASSIFIED_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => {
      if (a.artist === UNCLASSIFIED_LABEL) return 1;
      if (b.artist === UNCLASSIFIED_LABEL) return -1;
      return a.artist.localeCompare(b.artist, "pt-BR");
    });
}

/** "dd/mm/yyyy" (vigiados) -> "yyyy-mm-dd" (dayKey). */
export function watchedDateToKey(value: string): string {
  const [dd, mm, yy] = value.split("/");
  return yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
}

/** A busca principal casa por título, artista, casa e nº do lote — igual à das abas de dia. */
export function watchedMatchesSearch(
  lot: { title: string; artist: string; house: string; lote: string },
  searchNorm: string,
): boolean {
  return (
    !searchNorm ||
    normalizeForMatch(`${lot.title} ${lot.artist} ${lot.house} ${lot.lote}`).includes(searchNorm)
  );
}

/** A busca dos lances casa por título, casa, nº do lote e status do lance. */
export function bidMatchesSearch(
  bid: { title: string; house: string; lote: string; status: string },
  searchNorm: string,
): boolean {
  return (
    !searchNorm ||
    normalizeForMatch(`${bid.title} ${bid.house} ${bid.lote} ${bid.status}`).includes(searchNorm)
  );
}

/** Agrupa vigiados por casa de leilão e ordena os lotes pelo nº do lote. */
export function groupWatchedByHouse<T extends { house: string; houseUrl: string; lote: string }>(
  lots: T[],
): { house: string; houseUrl: string; lots: T[] }[] {
  const byHouse = new Map<string, { house: string; houseUrl: string; lots: T[] }>();
  for (const lot of lots) {
    const group = byHouse.get(lot.house) ?? {
      house: lot.house,
      houseUrl: lot.houseUrl,
      lots: [] as T[],
    };
    group.lots.push(lot);
    byHouse.set(lot.house, group);
  }
  const num = (value: string) => {
    // Lote vazio ("") deve ir para o FIM: Number("") é 0, então guardamos o caso
    // vazio explicitamente antes de cair no fallback POSITIVE_INFINITY.
    const n = value.trim() === "" ? NaN : Number(value);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  for (const group of byHouse.values()) {
    group.lots.sort((a, b) => num(a.lote) - num(b.lote) || a.lote.localeCompare(b.lote, "pt-BR"));
  }
  return [...byHouse.values()].sort(
    (a, b) => b.lots.length - a.lots.length || a.house.localeCompare(b.house, "pt-BR"),
  );
}

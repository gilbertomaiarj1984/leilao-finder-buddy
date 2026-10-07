// Helpers puros de agrupamento/ordenação e tipos compartilhados pela listagem de
// vinil. Sem JSX — a UI que consome isto vive nos componentes ao lado.
import {
  auctionDayPassed,
  auctionStarted,
  bidIsWinning,
  catalogUrlFromLot,
  LOTE_LABEL,
  normalizeForMatch,
  parsePrice,
  presencialUrlFromLot,
  UNCLASSIFIED_LABEL,
  type VinylLot,
} from "@/lib/vinyl-parse";

/**
 * Ordem dos grupos de artista: artistas reais (alfabético) primeiro, depois o balde
 * "Lote" (conjuntos de discos) e por fim "não classificados". Baldes genéricos vão para o
 * fim para não poluir a navegação por artista.
 */
function artistRank(artist: string): number {
  if (artist === UNCLASSIFIED_LABEL) return 2;
  if (artist === LOTE_LABEL) return 1;
  return 0;
}

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

/**
 * Nº do lote como número para ordenar. Lote vazio ("", comum na listagem geral) vai para
 * o FIM: Number("") é 0, então guardamos o caso vazio antes de cair no fallback +Infinity.
 */
function loteNum(value: string): number {
  const n = value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Minutos desde meia-noite a partir de um horário tipo "19:30h"/"9h"/"9:30". Sem horário
 * (ou ilegível) vai para o FIM (+Infinity), igual ao `loteNum` — usado para ordenar casas
 * por horário do leilão antes do desempate alfabético.
 */
function timeMinutes(value: string): number {
  const match = value.match(/(\d{1,2})[:h.]?(\d{2})?/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hh = Number(match[1]);
  const mm = Number(match[2] ?? "0");
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : Number.POSITIVE_INFINITY;
}

/** Forma enxuta do agrupamento por casa (`{house, houseUrl, lots}`), preservando a ordem. */
export type SimpleHouseGroup = { house: string; houseUrl: string; lots: VinylLot[] };

export function groupByHouseSimple(lots: VinylLot[]): SimpleHouseGroup[] {
  const byHouse = new Map<string, SimpleHouseGroup>();
  for (const lot of lots) {
    const group = byHouse.get(lot.house) ?? { house: lot.house, houseUrl: lot.houseUrl, lots: [] };
    group.lots.push(lot);
    byHouse.set(lot.house, group);
  }
  return [...byHouse.values()];
}

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
    .sort(
      (a, b) =>
        artistRank(a.artist) - artistRank(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
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
    .sort(
      (a, b) =>
        timeMinutes(a.time) - timeMinutes(b.time) || a.house.localeCompare(b.house, "pt-BR"),
    );
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
  const stats: HouseStats = { vigia: 0, green: 0, red: 0 };
  for (const lot of lots) {
    const kind = houseStatKind(lot.idPeca, watchedIds, bidStatusById);
    if (kind) stats[kind] += 1;
  }
  return stats;
}

/** Filtro dos badges com seleção múltipla (OU): vazio = sem filtro. */
type StatFilter = ReadonlySet<keyof HouseStats>;

/** O lote passa no filtro? Sem filtro, sempre; com filtro, só se cai em UM dos contadores marcados. */
export function matchesStatFilter(
  idPeca: string,
  watchedIds: Set<string>,
  bidStatusById: Map<string, string>,
  filter: StatFilter,
): boolean {
  if (filter.size === 0) return true;
  const kind = houseStatKind(idPeca, watchedIds, bidStatusById);
  return kind !== null && filter.has(kind);
}

/**
 * Em qual contador do lote cai: lance ganhando = verde, coberto = vermelho (mesma prioridade
 * das cores do card); vigiado sem lance = amarelo (vigia); senão nenhum. Base do filtro dos badges.
 */
export function houseStatKind(
  idPeca: string,
  watchedIds: Set<string>,
  bidStatusById: Map<string, string>,
): keyof HouseStats | null {
  const status = bidStatusById.get(idPeca);
  if (status) return bidIsWinning(status) ? "green" : "red";
  return watchedIds.has(idPeca) ? "vigia" : null;
}

/**
 * Classifica o status de um lance dado na conta (conta_site.asp?l=4):
 * - "winning": vencendo agora (ganhando)
 * - "won": vencedor / arrematado — o leilão já passou e você levou
 * - "covered": coberto — alguém cobriu o seu lance
 * - "lost": não vendido / demais casos
 *
 * "winning" + "won" são os resultados POSITIVOS (verde) e devem casar com
 * `bidIsWinning` (vinyl-parse.ts), que colore o card/linha; se mudar os tokens
 * aqui, ajuste lá também.
 */
type BidState = "winning" | "won" | "covered" | "lost";

function classifyBid(status: string): BidState {
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
    .sort(
      (a, b) =>
        artistRank(a.artist) - artistRank(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
}

/** "dd/mm/yyyy" (vigiados) -> "yyyy-mm-dd" (dayKey). */
export function watchedDateToKey(value: string): string {
  const [dd, mm, yy] = value.split("/");
  return yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
}

/**
 * A busca principal casa por título, artista, casa e nº do lote — igual à das abas de dia.
 * `album` (opcional) = artista/álbum identificado pela IA, para priorizar essa
 * identificação também na busca (mais acertiva que o título).
 */
export function watchedMatchesSearch(
  lot: { title: string; artist: string; house: string; lote: string },
  searchNorm: string,
  album?: string | null,
): boolean {
  return (
    !searchNorm ||
    normalizeForMatch(
      `${lot.title} ${lot.artist} ${lot.house} ${lot.lote} ${album ?? ""}`,
    ).includes(searchNorm)
  );
}

/**
 * A busca dos lances casa por título, casa, nº do lote e status do lance. `album`
 * (opcional) = artista/álbum identificado pela IA (mesma priorização da busca de dia).
 */
export function bidMatchesSearch(
  bid: { title: string; house: string; lote: string; status: string },
  searchNorm: string,
  album?: string | null,
): boolean {
  return (
    !searchNorm ||
    normalizeForMatch(
      `${bid.title} ${bid.house} ${bid.lote} ${bid.status} ${album ?? ""}`,
    ).includes(searchNorm)
  );
}

export type AuctionStatus = "upcoming" | "live" | "ended";

export type HouseAuctionInfo = {
  time: string;
  status: AuctionStatus | null;
  presencialUrl: string | null;
  catalogUrl: string | null;
  idLeilao: string;
  dayKey: string;
};

/**
 * Horário, status (em breve/ao vivo/encerrado) e link do pregão presencial de uma casa, a
 * partir de um lote do grupo (mesma casa = mesmo leilão/horário). Mesma regra de status da
 * página "Ao vivo" (`auctionStarted`/`auctionDayPassed`). Usada ao lado do nome da casa em
 * "Vigiados do dia" e na aba "Vigiados" (global).
 */
export function houseAuctionInfo(
  dayKey: string,
  lot: { idLeilao: string; time: string; url: string } | undefined,
  now: number = Date.now(),
): HouseAuctionInfo | null {
  if (!lot) return null;
  const status: AuctionStatus | null =
    dayKey && lot.time
      ? auctionDayPassed(dayKey, now)
        ? "ended"
        : auctionStarted(dayKey, lot.time, now)
          ? "live"
          : "upcoming"
      : null;
  return {
    time: lot.time,
    status,
    presencialUrl: presencialUrlFromLot(lot),
    catalogUrl: catalogUrlFromLot(lot),
    idLeilao: lot.idLeilao,
    dayKey,
  };
}

/**
 * Agrupa vigiados/lances por casa de leilão e ordena os lotes pelo nº do lote. As casas saem
 * ordenadas por horário do leilão (`time`, quando presente no item — ex. vigiados) e depois
 * alfabeticamente, igual ao `groupByHouse` da grade principal.
 */
export function groupWatchedByHouse<
  T extends { house: string; houseUrl: string; lote: string; time?: string },
>(lots: T[]): { house: string; houseUrl: string; time: string; lots: T[] }[] {
  const byHouse = new Map<string, { house: string; houseUrl: string; time: string; lots: T[] }>();
  for (const lot of lots) {
    const group = byHouse.get(lot.house) ?? {
      house: lot.house,
      houseUrl: lot.houseUrl,
      time: lot.time ?? "",
      lots: [] as T[],
    };
    group.lots.push(lot);
    byHouse.set(lot.house, group);
  }
  for (const group of byHouse.values()) {
    group.lots.sort(
      (a, b) => loteNum(a.lote) - loteNum(b.lote) || a.lote.localeCompare(b.lote, "pt-BR"),
    );
  }
  return [...byHouse.values()].sort(
    (a, b) => timeMinutes(a.time) - timeMinutes(b.time) || a.house.localeCompare(b.house, "pt-BR"),
  );
}

/** Um catálogo (`idLeilao`) de uma casa nos vigiados; pode passar por vários dias. */
type WatchedCatalog<T> = {
  idLeilao: string;
  /** Dias (yyyy-mm-dd, crescente) em que o catálogo tem lote vigiado; sem data fica de fora. */
  dayKeys: string[];
  /** Horário de início (lotes do primeiro dia). */
  time: string;
  lots: T[];
};

type WatchedHouse<T> = {
  house: string;
  houseUrl: string;
  catalogs: WatchedCatalog<T>[];
};

type WatchedLike = {
  house: string;
  houseUrl: string;
  lote: string;
  idLeilao: string;
  date: string; // dd/mm/yyyy
  time: string;
  url: string;
};

/** dayKey (yyyy-mm-dd) do lote vigiado; "" quando sem data. */
function watchedLotDayKey(lot: { date: string }): string {
  return watchedDateToKey(lot.date) || lot.date || "";
}

/** true quando o catálogo passa pelo dia (mesmo sendo multi-dia). */
export function catalogHasDay(catalog: { dayKeys: string[] }, dayKey: string): boolean {
  return catalog.dayKeys.includes(dayKey);
}

/**
 * Agrupa vigiados por casa e, dentro dela, por catálogo (`idLeilao`). Um catálogo multi-dia
 * (lotes em datas diferentes) continua UM catálogo, com todos os dias em `dayKeys`. Catálogos
 * ordenados por primeiro dia/horário; casas pelo seu primeiro catálogo e depois pelo nome.
 * Lotes ordenados pelo nº do lote.
 */
export function groupWatchedByHouseCatalog<T extends WatchedLike>(lots: T[]): WatchedHouse<T>[] {
  const byHouse = new Map<string, { houseUrl: string; byCat: Map<string, T[]> }>();
  for (const lot of lots) {
    const entry = byHouse.get(lot.house) ?? { houseUrl: lot.houseUrl, byCat: new Map() };
    const list = entry.byCat.get(lot.idLeilao) ?? [];
    list.push(lot);
    entry.byCat.set(lot.idLeilao, list);
    byHouse.set(lot.house, entry);
  }
  const slotOf = (c: WatchedCatalog<T>) => c.dayKeys[0] ?? "￿";
  const compareCatalogs = (a: WatchedCatalog<T>, b: WatchedCatalog<T>) =>
    slotOf(a).localeCompare(slotOf(b)) ||
    timeMinutes(a.time) - timeMinutes(b.time) ||
    a.idLeilao.localeCompare(b.idLeilao);
  const houses: WatchedHouse<T>[] = [...byHouse.entries()].map(([house, entry]) => {
    const catalogs = [...entry.byCat.entries()].map(([idLeilao, catLots]) => {
      // Catálogo multi-dia: datas em ordem crescente; dentro do dia, pelo nº do lote.
      catLots.sort(
        (a, b) =>
          watchedLotDayKey(a).localeCompare(watchedLotDayKey(b)) ||
          loteNum(a.lote) - loteNum(b.lote) ||
          a.lote.localeCompare(b.lote, "pt-BR"),
      );
      const dayKeys = [...new Set(catLots.map(watchedLotDayKey).filter(Boolean))].sort();
      const firstDayTimes = catLots
        .filter((l) => watchedLotDayKey(l) === dayKeys[0])
        .map((l) => l.time)
        .filter(Boolean)
        .sort((a, b) => timeMinutes(a) - timeMinutes(b));
      return { idLeilao, dayKeys, time: firstDayTimes[0] ?? catLots[0]?.time ?? "", lots: catLots };
    });
    catalogs.sort(compareCatalogs);
    return { house, houseUrl: entry.houseUrl, catalogs };
  });
  return houses.sort((a, b) => {
    const ca = a.catalogs[0];
    const cb = b.catalogs[0];
    return (ca && cb ? compareCatalogs(ca, cb) : 0) || a.house.localeCompare(b.house, "pt-BR");
  });
}

type WatchedArtistGroup<T> = {
  /** Nome exibido: apelido curado, ou a grafia mais frequente entre os lotes. */
  artist: string;
  /** Chave final do grupo (`normalizeForMatch` do nome exibido). */
  key: string;
  /** Chaves ORIGINAIS (pré-apelido) dos artistas reunidos — o que a curadoria persiste. */
  sourceKeys: string[];
  /** Casas distintas com lote vigiado deste artista. */
  houseCount: number;
  lots: T[];
};

/** Curadoria aplicada ao agrupamento — mesmos mapas do Analytics (`getAnalyticsAliases`). */
type WatchedArtistCuration = {
  /** chave original do artista → nome canônico. */
  artists?: Record<string, string>;
  /** `lot.id` → artista daquele lote (mover um lote para outro artista). */
  sales?: Record<string, { artist?: string; album?: string }>;
};

/** Chave normalizada do artista de um lote vigiado (vazio → "não classificados"). */
function watchedArtistKey(artist: string): string {
  return normalizeForMatch(artist) || normalizeForMatch(UNCLASSIFIED_LABEL);
}

function pickName(counts: Map<string, number>): string {
  return [...counts.entries()].sort(
    (x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "pt-BR"),
  )[0]![0];
}

/**
 * Agrupa vigiados por artista. Grafias que só diferem em caixa/acento/pontuação já caem juntas
 * (`normalizeForMatch`); a curadoria (mesmos apelidos do Analytics) renomeia/funde artistas e a
 * correção por lote leva um lote para outro artista. Artistas em ordem alfabética, baldes
 * genéricos no fim (`artistRank`). Lotes por casa, dia, horário e nº do lote.
 */
export function groupWatchedByArtist<T extends WatchedLike & { artist: string; id?: string }>(
  lots: T[],
  curation: WatchedArtistCuration = {},
): WatchedArtistGroup<T>[] {
  const artistAliases = curation.artists ?? {};
  const sales = curation.sales ?? {};
  type Bucket = {
    lots: T[];
    raw: Map<string, number>;
    sourceKeys: Set<string>;
    alias?: string;
  };
  const byKey = new Map<string, Bucket>();
  for (const lot of lots) {
    const ov = lot.id ? sales[lot.id] : undefined;
    const rawName = ov?.artist?.trim() || lot.artist || UNCLASSIFIED_LABEL;
    const rawKey = watchedArtistKey(rawName);
    const alias = artistAliases[rawKey]?.trim();
    const key = alias ? normalizeForMatch(alias) || rawKey : rawKey;
    const bucket: Bucket = byKey.get(key) ?? { lots: [], raw: new Map(), sourceKeys: new Set() };
    bucket.lots.push(lot);
    bucket.raw.set(rawName, (bucket.raw.get(rawName) ?? 0) + 1);
    bucket.sourceKeys.add(rawKey);
    if (alias) bucket.alias = alias;
    byKey.set(key, bucket);
  }
  return [...byKey.entries()]
    .map(([key, b]) => {
      b.lots.sort(
        (x, y) =>
          x.house.localeCompare(y.house, "pt-BR") ||
          watchedLotDayKey(x).localeCompare(watchedLotDayKey(y)) ||
          timeMinutes(x.time) - timeMinutes(y.time) ||
          loteNum(x.lote) - loteNum(y.lote),
      );
      return {
        artist: b.alias ?? pickName(b.raw),
        key,
        sourceKeys: [...b.sourceKeys],
        houseCount: new Set(b.lots.map((l) => l.house)).size,
        lots: b.lots,
      };
    })
    .sort(
      (a, b) =>
        artistRank(a.artist) - artistRank(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
}

/**
 * Status/horário/links de um catálogo (mesma regra de `houseAuctionInfo`). Catálogo multi-dia:
 * "encerrado" só depois do ÚLTIMO dia (3h após o último horário), "ao vivo" desde o início do
 * primeiro dia.
 */
export function catalogAuctionInfo(
  catalog: WatchedCatalog<WatchedLike>,
  now: number = Date.now(),
): HouseAuctionInfo | null {
  const firstDay = catalog.dayKeys[0] ?? "";
  const lastDay = catalog.dayKeys[catalog.dayKeys.length - 1] ?? "";
  const sample = catalog.lots.find((l) => watchedLotDayKey(l) === firstDay) ?? catalog.lots[0];
  const info = houseAuctionInfo(
    firstDay,
    sample ? { idLeilao: catalog.idLeilao, time: catalog.time, url: sample.url } : undefined,
    now,
  );
  if (!info || !info.status || lastDay === firstDay) return info;
  const lastTime =
    catalog.lots
      .filter((l) => watchedLotDayKey(l) === lastDay)
      .map((l) => l.time)
      .filter(Boolean)
      .sort((a, b) => timeMinutes(b) - timeMinutes(a))[0] ?? "";
  if (lastTime && auctionDayPassed(lastDay, now)) return { ...info, status: "ended" };
  return { ...info, status: auctionStarted(firstDay, catalog.time, now) ? "live" : "upcoming" };
}

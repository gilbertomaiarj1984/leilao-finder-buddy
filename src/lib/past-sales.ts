/**
 * "Vendas passadas" de um lote (v0.148.0): o que o MESMO disco já arrematou nos leilões que o app
 * acompanha, vindo do Vinil Analytics. Módulo PURO (client-safe, testável); a leitura das tabelas
 * fica em `past-sales.server.ts`.
 *
 * "Mesmo disco" é a definição do próprio Analytics (`makeSalePlacer` em `analytics.ts`): artista e
 * álbum pós-derivação, correção por venda e apelidos. Assim, o que o usuário corrige no Analytics
 * (renomear, fundir, tirar uma venda errada) muda a comparação da IA, e o link «Ver no Analytics»
 * leva ao grupo exato que foi usado.
 */
import { UNIDENTIFIED_ALBUM, type ArtistAgg, type SalePlacement, type SaleRow } from "./analytics";
import { ANALYTICS_COMPILATION_LABEL, LOTE_LABEL, UNCLASSIFIED_LABEL } from "./vinyl-parse";

/** Diferença máxima de nota de estado (0–100) para uma venda contar como «estado parecido». */
const SIMILAR_SCORE_GAP = 12;

export type PastSales = {
  /** Nome do grupo no Analytics (para o texto do link). */
  artist: string;
  album: string;
  /** Chaves do grupo — o link do Analytics abre este artista e este álbum. */
  artistKey: string;
  albumKey: string;
  count: number;
  min: number;
  median: number;
  max: number;
  /** A venda mais recente (por data do leilão). */
  last: { price: number; date: string | null } | null;
  /** Vendas com nota de estado próxima à do lote; null quando o lote não tem estado ou nenhuma serve. */
  similar: { count: number; median: number } | null;
};

type IndexedSale = { price: number; date: string | null; score: number | null };
type PastSalesIndex = Map<
  string,
  { artist: string; album: string; artistKey: string; albumKey: string; sales: IndexedSale[] }
>;

const indexKey = (artistKey: string, albumKey: string) => `${artistKey}|${albumKey}`;

/** Mediana de uma lista de números (arredondada a centavos). */
export function median(nums: readonly number[]): number {
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  const m = a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
  return Math.round(m * 100) / 100;
}

/** Índice artista|álbum → vendas, a partir do resultado de `buildAnalytics` (sem os balaios). */
export function buildPastSalesIndex(artists: readonly ArtistAgg[]): PastSalesIndex {
  const index: PastSalesIndex = new Map();
  for (const a of artists) {
    if (
      a.artist === UNCLASSIFIED_LABEL ||
      a.artist === LOTE_LABEL ||
      a.artist === ANALYTICS_COMPILATION_LABEL
    )
      continue;
    for (const al of a.albums) {
      if (al.album === UNIDENTIFIED_ALBUM) continue;
      const sales: IndexedSale[] = [];
      for (const s of al.sales) {
        if (typeof s.sold_price === "number" && s.sold_price > 0)
          sales.push({ price: s.sold_price, date: s.sold_date, score: s.score });
      }
      if (sales.length)
        index.set(indexKey(a.key, al.key), {
          artist: a.artist,
          album: al.album,
          artistKey: a.key,
          albumKey: al.key,
          sales,
        });
    }
  }
  return index;
}

/** Estatísticas das vendas do grupo onde o lote cai; null sem grupo (ou grupo sem preço). */
export function lookupPastSales(
  index: PastSalesIndex,
  placement: SalePlacement | null,
  lotScore?: number | null,
): PastSales | null {
  if (!placement) return null;
  const hit = index.get(indexKey(placement.artistKey, placement.albumKey));
  if (!hit) return null;
  const prices = hit.sales.map((s) => s.price);
  const dated = hit.sales.filter((s) => s.date).sort((a, b) => b.date!.localeCompare(a.date!));
  const lastSale = dated[0] ?? hit.sales[hit.sales.length - 1]!;
  const near =
    typeof lotScore === "number"
      ? hit.sales.filter(
          (s) => s.score != null && Math.abs(s.score - lotScore) <= SIMILAR_SCORE_GAP,
        )
      : [];
  return {
    artist: hit.artist,
    album: hit.album,
    artistKey: hit.artistKey,
    albumKey: hit.albumKey,
    count: prices.length,
    min: Math.min(...prices),
    median: median(prices),
    max: Math.max(...prices),
    last: { price: lastSale.price, date: lastSale.date },
    similar: near.length ? { count: near.length, median: median(near.map((s) => s.price)) } : null,
  };
}

/**
 * O lote como uma «venda» para o mesmo posicionador do Analytics. Com a identificação por IA
 * (`"Artista - Álbum"`), usa-a como a reidentificação das vendas faz; senão, o artista e o título
 * do próprio lote.
 */
export function lotAsSale(
  lot: { id: string; title: string; artist: string },
  identAlbum?: string | null,
): SaleRow {
  const ident = identAlbum?.trim() ?? "";
  const sep = ident.indexOf(" - ");
  const fromIdent = sep > 0 ? { artist: ident.slice(0, sep).trim(), title: ident } : null;
  return {
    lot_id: lot.id,
    id_leilao: "",
    id_peca: "",
    artist: fromIdent?.artist ?? lot.artist,
    title: fromIdent?.title ?? lot.title,
    sold_price: null,
    sold_price_raw: "",
    sold_date: null,
    house: "",
    uf: "",
    media: "",
    sleeve: "",
    score: null,
    faixa: "",
    insert_state: "",
    source_url: "",
  };
}

/** Link do Analytics para o grupo usado na comparação (query string da rota `/vinil-analytics`). */
export function analyticsGroupSearch(p: Pick<PastSales, "artistKey" | "albumKey">): {
  artist: string;
  album: string;
} {
  return { artist: p.artistKey, album: p.albumKey };
}

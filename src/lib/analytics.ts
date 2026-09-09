// Agregação PURA do Vinil Analytics (sem JSX, sem rede). Consome as linhas de `lot_sales`
// (histórico de vendas) e agrupa por **artista → álbum**, com preço médio, contagem e médias
// por Faixa de Classificação. A casa de leilão é irrelevante aqui.
import { FAIXAS, faixaFromScore } from "@/lib/grading";
import { LOTE_LABEL, normalizeForMatch, UNCLASSIFIED_LABEL } from "@/lib/vinyl-parse";

/** Forma da linha vinda de `getVinylSales` (snake_case, espelha `lot_sales`). */
export type SaleRow = {
  lot_id: string;
  id_leilao: string;
  id_peca: string;
  artist: string;
  title: string;
  sold_price: number | null;
  sold_price_raw: string;
  sold_date: string | null;
  house: string;
  uf: string;
  media: string;
  sleeve: string;
  score: number | null;
  faixa: string;
  insert_state: string;
  source_url: string;
};

export type FaixaAgg = { label: string; count: number; avgPrice: number | null };

export type AlbumAgg = {
  album: string;
  count: number;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sales: SaleRow[]; // ordenadas do PIOR para o MELHOR score (eixo horizontal do Analytics)
  faixas: FaixaAgg[]; // médias por Faixa (na ordem de FAIXAS; só faixas com vendas)
};

export type ArtistAgg = {
  artist: string;
  count: number;
  avgPrice: number | null;
  albums: AlbumAgg[];
};

/** Média (arredondada) de uma lista, ignorando nulos; null quando não há número. */
export function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

const FORMAT_PREFIX =
  /^(lps?|disco de vinil|discos?|vinil|compacto|bolacha|ep|[aá]lbum)\b[\s:.\-–—]*/i;

/**
 * Deriva o nome do álbum a partir do título do lote (heurístico): corta a partir do 1º rótulo
 * de estado (Disco:/Capa:/…), remove ano e prefixos de formato (LP, Disco de vinil…), e tira o
 * artista à esquerda quando há separador. Best-effort — o título do catálogo é ruidoso; o
 * agrupamento pode ser refinado depois (ex.: cruzar com `lot_ident`).
 */
export function deriveAlbum(title: string, artist: string): string {
  let s = (title || "").trim();
  // Corta a descrição de estado ("... Disco: VG+ Capa: VG").
  s = s.replace(/\b(disco|m[ií]dia|midia|vinil|capa|sleeve|estado|conserva[cç][aã]o)\s*:.*/i, " ");
  // Remove ano.
  s = s.replace(/\b(19|20)\d{2}\b/g, " ");
  // Remove prefixos de formato (podem se repetir).
  for (let i = 0; i < 3; i++) s = s.replace(FORMAT_PREFIX, "").trim();
  // Com separador, assume "Artista - Álbum" e fica com o lado direito.
  const parts = s.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0]!.trim()) s = parts.slice(1).join(" - ");
  s = s
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Se sobrou só o próprio artista, não há álbum identificável.
  if (!s || (artist && normalizeForMatch(s) === normalizeForMatch(artist))) {
    return "(álbum não identificado)";
  }
  return s;
}

/** Médias por Faixa de Classificação (só faixas com pelo menos uma venda). */
function faixasFor(sales: SaleRow[]): FaixaAgg[] {
  return FAIXAS.map((f) => {
    const inFaixa = sales.filter((s) => faixaFromScore(s.score)?.label === f.label);
    return {
      label: f.label,
      count: inFaixa.length,
      avgPrice: avg(inFaixa.map((s) => s.sold_price)),
    };
  }).filter((f) => f.count > 0);
}

function artistRank(artist: string): number {
  if (artist === UNCLASSIFIED_LABEL) return 2;
  if (artist === LOTE_LABEL) return 1;
  return 0;
}

/** Ordena vendas do PIOR para o MELHOR score (sem score vai para o fim). */
function byScoreAsc(a: SaleRow, b: SaleRow): number {
  const sa = a.score ?? Number.POSITIVE_INFINITY;
  const sb = b.score ?? Number.POSITIVE_INFINITY;
  return sa - sb;
}

/** Agrega o histórico de vendas em artista → álbum. */
export function buildAnalytics(rows: SaleRow[]): ArtistAgg[] {
  const byArtist = new Map<string, Map<string, SaleRow[]>>();
  for (const row of rows) {
    const artist = row.artist?.trim() || UNCLASSIFIED_LABEL;
    const album = deriveAlbum(row.title, artist);
    const albums = byArtist.get(artist) ?? new Map<string, SaleRow[]>();
    const list = albums.get(album) ?? [];
    list.push(row);
    albums.set(album, list);
    byArtist.set(artist, albums);
  }

  const result: ArtistAgg[] = [];
  for (const [artist, albums] of byArtist) {
    const albumAggs: AlbumAgg[] = [];
    const allSales: SaleRow[] = [];
    for (const [album, sales] of albums) {
      allSales.push(...sales);
      const prices = sales.map((s) => s.sold_price);
      const nums = prices.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      albumAggs.push({
        album,
        count: sales.length,
        avgPrice: avg(prices),
        minPrice: nums.length ? Math.min(...nums) : null,
        maxPrice: nums.length ? Math.max(...nums) : null,
        sales: [...sales].sort(byScoreAsc),
        faixas: faixasFor(sales),
      });
    }
    albumAggs.sort((a, b) => b.count - a.count || (b.avgPrice ?? 0) - (a.avgPrice ?? 0));
    result.push({
      artist,
      count: allSales.length,
      avgPrice: avg(allSales.map((s) => s.sold_price)),
      albums: albumAggs,
    });
  }

  return result.sort(
    (a, b) =>
      artistRank(a.artist) - artistRank(b.artist) ||
      b.count - a.count ||
      a.artist.localeCompare(b.artist, "pt-BR"),
  );
}

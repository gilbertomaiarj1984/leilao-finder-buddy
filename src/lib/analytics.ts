// Agregação PURA do Vinil Analytics (sem JSX, sem rede). Consome as linhas de `lot_sales`
// (histórico de vendas) e agrupa por **artista → álbum**, com preço médio, contagem e médias
// por Faixa de Classificação. A casa de leilão é irrelevante aqui.
import { FAIXAS, faixaFromScore } from "@/lib/grading";
import {
  ANALYTICS_COMPILATION_LABEL,
  isCompilation,
  isDiscBundle,
  isVariousArtists,
  LOTE_LABEL,
  looksNonVinylSale,
  normalizeForMatch,
  pickCanonical,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";

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
  views?: number | null; // demanda (visualizações)
  bids?: number | null; // demanda (lances)
  fee_pct?: number | null; // taxa do leiloeiro (%)
  initial_price?: number | null; // valor inicial (p/ desconto/ágio)
  orig_text?: string | null; // descritivo completo do catálogo (texto original do lote)
};

export type FaixaAgg = { label: string; count: number; avgPrice: number | null };

export type AlbumAgg = {
  album: string;
  key: string; // chave normalizada FINAL do álbum (escopo do artista) — usada pela curadoria
  sourceKeys: string[]; // chaves normalizadas ORIGINAIS que caíram neste álbum (p/ persistir fusões)
  count: number;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sales: SaleRow[]; // ordenadas do PIOR para o MELHOR score (eixo horizontal do Analytics)
  faixas: FaixaAgg[]; // médias por Faixa (na ordem de FAIXAS; só faixas com vendas)
};

export type ArtistAgg = {
  artist: string;
  key: string; // chave normalizada FINAL do artista (pós-alias) — usada pela curadoria
  sourceKeys: string[]; // chaves normalizadas ORIGINAIS que caíram neste artista (p/ persistir fusões)
  count: number;
  avgPrice: number | null;
  albums: AlbumAgg[];
};

/**
 * Apelidos (curadoria manual, "aprendizado") do usuário — ver `app-state.server.ts`. Mapeiam a
 * CHAVE normalizada de origem para o nome canônico escolhido; renomear e fundir são o mesmo
 * mecanismo (chaves diferentes apontando para o mesmo nome caem no mesmo grupo).
 */
export type SaleOverride = { artist?: string; album?: string };

export type AnalyticsAliases = {
  artists?: Record<string, string>;
  albums?: Record<string, string>;
  // Correção POR VENDA (por `lot_id`): fixa artista/álbum de uma venda específica, aplicada
  // ANTES da derivação/agrupamento (separa os "(álbum não identificado)").
  sales?: Record<string, SaleOverride>;
  // EXCLUSÕES (ocultar do Analytics, sem deletar do banco): `excludedSales` por `lot_id` e
  // `excludedArtists` por CHAVE de artista (a `key` final e/ou as `sourceKeys`). O valor guardado
  // é um rótulo amigável (nome do artista / "artista — álbum" da venda) só para a lista de
  // "Ocultos" poder mostrar e reincluir; o agrupamento só usa as CHAVES.
  excludedSales?: Record<string, string>;
  excludedArtists?: Record<string, string>;
};

/** Média (arredondada) de uma lista, ignorando nulos; null quando não há número. */
export function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

const FORMAT_PREFIX =
  /^(lps?|disco de vinil|discos?|vinil|compacto|bolacha|ep|[aá]lbum)\b[\s:.\-–—]*/i;

// Marcador de estado embutido no título SEM dois-pontos ("… - CAPA VG+ - DISCO VG+/NM …"):
// rótulo Capa/Disco/Mídia/Vinil seguido de um grau. Tudo a partir daí não é o nome do álbum.
const GRADE_MARK =
  /[\s\-–—]+(?:capa|disco|m[íi]dia|midia|vinil)\s+(?:M-|VG\+\+|VG\+|VG-|G\+|G-|F\/P|NM|EX|VG|G|M)\b/i;

/**
 * Deriva o nome do álbum a partir do título do lote (heurístico): corta a partir do 1º rótulo
 * de estado (Disco:/Capa:/…), remove ano e prefixos de formato (LP, Disco de vinil…), e tira o
 * artista à esquerda quando há separador. Best-effort — o título do catálogo é ruidoso; o
 * agrupamento pode ser refinado depois (ex.: cruzar com `lot_ident`).
 */
export function deriveAlbum(title: string, artist: string): string {
  let s = (title || "").trim();
  // Corta no 1º marcador de estado sem dois-pontos ("… - CAPA VG+ - DISCO VG+/NM - …").
  const mark = s.match(GRADE_MARK);
  if (mark && mark.index !== undefined && mark.index > 0) s = s.slice(0, mark.index);
  // Corta a descrição de estado com rótulo e dois-pontos ("... Disco: VG+ Capa: VG").
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
  if (artist === UNCLASSIFIED_LABEL) return 3;
  if (artist === LOTE_LABEL) return 2;
  if (artist === ANALYTICS_COMPILATION_LABEL) return 1;
  return 0;
}

/** Ordena vendas do PIOR para o MELHOR score (sem score vai para o fim). */
function byScoreAsc(a: SaleRow, b: SaleRow): number {
  const sa = a.score ?? Number.POSITIVE_INFINITY;
  const sb = b.score ?? Number.POSITIVE_INFINITY;
  return sa - sb;
}

// Bucket de álbum: grafias vistas (p/ canônica), chaves originais (p/ fusões) + as vendas.
// `override` = nome forçado pela curadoria (vence a canônica).
type AlbumBucket = {
  variants: string[];
  sourceKeys: Set<string>;
  override: string | null;
  sales: SaleRow[];
};
// Bucket de artista: grafias, chaves originais, override e os álbuns por CHAVE normalizada.
type ArtistBucket = {
  variants: string[];
  sourceKeys: Set<string>;
  override: string | null;
  albums: Map<string, AlbumBucket>;
};

/**
 * Agrega o histórico de vendas em artista → álbum.
 *
 * ⚠️ **Padronização de nomes (evita registros duplicados):** o agrupamento é por CHAVE
 * `normalizeForMatch` (sem acento/caixa/pontuação), tanto de artista quanto de álbum, então
 * pequenas diferenças de grafia ("Jorge Ben" vs "Jorge ben ", "Alceu Valença" vs "Alceu
 * Valenca") caem no MESMO grupo. O nome exibido é a melhor grafia entre as variações
 * (`pickCanonical` — mais acentuada, depois mais longa). Isso corrige os casos em que
 * variações mínimas geravam 2 linhas para o mesmo artista/álbum.
 */
export function buildAnalytics(rows: SaleRow[], aliases?: AnalyticsAliases): ArtistAgg[] {
  const artistAliases = aliases?.artists ?? {};
  const albumAliases = aliases?.albums ?? {};
  const saleOverrides = aliases?.sales ?? {};
  const excludedSales = new Set(Object.keys(aliases?.excludedSales ?? {}));
  const excludedArtists = new Set(Object.keys(aliases?.excludedArtists ?? {}));
  const byArtist = new Map<string, ArtistBucket>();
  for (const row of rows) {
    // EXCLUSÃO manual da VENDA (por `lot_id`): oculta por completo (não conta em nenhum grupo).
    if (excludedSales.has(row.lot_id)) continue;
    // Correção POR VENDA (por `lot_id`): tem precedência sobre a derivação automática. Fixa o
    // artista e/ou o álbum desta venda específica (usada para separar os não identificados).
    const saleOv = saleOverrides[row.lot_id];
    // Exclui do Analytics o que caiu por engano de OUTRO formato (DVD/HQ/revista/livro…),
    // limpando também as linhas já gravadas antes deste filtro — sem precisar re-capturar. A
    // correção manual da venda ISENTA do filtro (o usuário afirmou que é um vinil).
    if (!saleOv && looksNonVinylSale(`${row.title} ${row.artist}`)) continue;
    // Oculta LOTES confirmados (conjunto de vários discos): o preço do conjunto não é preço por
    // álbum e polui as estatísticas. Checa o TÍTULO atual e o `orig_text` (descritivo bruto do
    // catálogo, preservado mesmo quando a reidentificação por IA reescreve o título) — sem isso,
    // uma venda que a IA "garimpou" um artista de dentro do lote reaparecia com o preço do
    // CONJUNTO inteiro atribuído a um único álbum. A correção manual da venda (saleOv) ISENTA —
    // o usuário pode afirmar que aquela venda é um disco específico. Não deleta nada; só some da
    // leitura.
    if (!saleOv && (isDiscBundle(row.title) || isDiscBundle(row.orig_text ?? ""))) continue;
    // Coletâneas/novelas → balaio "Coletâneas, Novela e etc" (a menos de correção manual). Casa a
    // dica no TÍTULO (coletânea/sucessos/trilha/novela) e o "artista" que é de vários intérpretes.
    const rawArtist = row.artist?.trim() || "";
    const isComp = !saleOv && (isVariousArtists(rawArtist) || isCompilation(row.title));
    const artist =
      saleOv?.artist?.trim() ||
      (isComp ? ANALYTICS_COMPILATION_LABEL : rawArtist) ||
      UNCLASSIFIED_LABEL;
    const album = saleOv?.album?.trim() || deriveAlbum(row.title, artist);
    // Chave ORIGINAL do artista (antes de qualquer apelido) — guardada p/ persistir fusões.
    const rawArtistKey = normalizeForMatch(artist) || normalizeForMatch(UNCLASSIFIED_LABEL);
    // Apelido de artista (renomear/fundir): re-chaveia pelo nome canônico escolhido.
    const artistOverride = artistAliases[rawArtistKey];
    const artistKey = artistOverride
      ? normalizeForMatch(artistOverride) || rawArtistKey
      : rawArtistKey;

    // EXCLUSÃO manual do ARTISTA: oculta o grupo inteiro. Casa pela chave FINAL (o grupo exibido)
    // ou pela chave ORIGINAL (robusto a mudanças de apelido/fusão).
    if (excludedArtists.has(artistKey) || excludedArtists.has(rawArtistKey)) continue;

    const rawAlbumKey = normalizeForMatch(album) || album;
    // Apelido de álbum: chave no escopo do artista FINAL (pós-alias), acompanhando fusões.
    const albumAliasKey = `${artistKey}|${rawAlbumKey}`;
    const albumOverride = albumAliases[albumAliasKey];
    const albumKey = albumOverride ? normalizeForMatch(albumOverride) || rawAlbumKey : rawAlbumKey;

    const aBucket: ArtistBucket = byArtist.get(artistKey) ?? {
      variants: [],
      sourceKeys: new Set(),
      override: null,
      albums: new Map(),
    };
    aBucket.variants.push(artist);
    aBucket.sourceKeys.add(rawArtistKey);
    if (artistOverride) aBucket.override = artistOverride;
    const alBucket: AlbumBucket = aBucket.albums.get(albumKey) ?? {
      variants: [],
      sourceKeys: new Set(),
      override: null,
      sales: [],
    };
    alBucket.variants.push(album);
    alBucket.sourceKeys.add(rawAlbumKey);
    if (albumOverride) alBucket.override = albumOverride;
    alBucket.sales.push(row);
    aBucket.albums.set(albumKey, alBucket);
    byArtist.set(artistKey, aBucket);
  }

  const result: ArtistAgg[] = [];
  for (const [artistKey, aBucket] of byArtist) {
    const artist = aBucket.override || pickCanonical(aBucket.variants) || UNCLASSIFIED_LABEL;
    const albumAggs: AlbumAgg[] = [];
    const allSales: SaleRow[] = [];
    for (const [albumKey, alBucket] of aBucket.albums) {
      const { sales } = alBucket;
      allSales.push(...sales);
      const prices = sales.map((s) => s.sold_price);
      const nums = prices.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      albumAggs.push({
        album: alBucket.override || pickCanonical(alBucket.variants),
        key: albumKey,
        sourceKeys: [...alBucket.sourceKeys],
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
      key: artistKey,
      sourceKeys: [...aBucket.sourceKeys],
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

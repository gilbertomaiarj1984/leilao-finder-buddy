import {
  COMPILATION_LABEL,
  LOTE_LABEL,
  UNCLASSIFIED_LABEL,
  normalizeForMatch,
} from "@/lib/vinyl-parse";

/**
 * Casamento probabilístico entre uma obra da sondagem e um lote. Em vez de exigir o título
 * escrito exatamente igual, comparamos por TOKENS (palavras normalizadas, sem acento/pontuação)
 * de artista + disco e usamos o ANO como reforço/penalidade. A "identidade" do lote junta o
 * título com sinais mais confiáveis quando existem: o artista extraído, o álbum identificado
 * pela IA e o título/ano do release casado no Discogs.
 *
 * `scoreWant` devolve uma probabilidade 0..1; a UI trata como casamento quando passa de
 * `WANT_MATCH_THRESHOLD` (80%).
 */
export const WANT_MATCH_THRESHOLD = 0.8;

const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

/** Obra da sondagem preparada para comparação (tokens significativos do texto). */
export type WantCandidate = {
  id: string;
  work: string;
  year: number | null;
  tokens: string[];
};

/**
 * Identidade do lote: texto normalizado + conjunto de tokens + anos conhecidos (o "saco de
 * palavras", usado pela sondagem) e, separados POR CAMPO, os sinais estruturados usados pelo
 * casamento com a Coleção — que compara artista com artista e álbum com álbum em vez de
 * procurar palavras soltas no título inteiro:
 *  - `titleWords` — palavras do título, em ordem (para achar o nome como FRASE e a vizinhança
 *    artista↔álbum);
 *  - `titleSegments` — índice do trecho do título (separado por " - ", "|"…) de cada palavra;
 *  - `artists` — nomes de artista estruturados do lote (artista efetivo, parte "Artista" do
 *    álbum da IA e do release do Discogs), já tokenizados; vazio = artista desconhecido;
 *  - `albums` — nomes de disco estruturados (álbum da IA, título do release do Discogs);
 *  - `bundle` — lote de vários discos (artista "Lote"): nunca tem artista/álbum confirmados.
 * Os campos estruturados são opcionais (identidades montadas só com o título continuam válidas).
 */
export type LotIdentity = {
  text: string;
  tokens: Set<string>;
  years: Set<number>;
  titleWords?: string[];
  titleSegments?: number[];
  artists?: string[][];
  albums?: string[][];
  bundle?: boolean;
};

/**
 * Tokens significativos de um texto: palavras com 3+ letras e também números curtos (ex.: o
 * "1"/"2" de "Vol. 1"), que costumam distinguir volumes/edições do mesmo disco.
 */
function significantTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((t) => t.length >= 3 || /^\d+$/.test(t));
}

/**
 * Resolve um nome de artista pelos apelidos já curados no Analytics
 * (`app_state.analytics_artist_aliases` — fusão manual de grafias, ver `analytics.ts`). Mesma
 * chave `normalizeForMatch` usada lá, então uma correção feita em QUALQUER uma das duas telas
 * (Analytics ou Coleção) passa a valer nas duas — hoje elas resolviam grafias de forma
 * independente e uma correção feita numa não beneficiava a outra.
 */
export function resolveArtistAlias(
  name: string | null | undefined,
  aliases: Readonly<Record<string, string>> | undefined,
): string {
  if (!name) return name ?? "";
  if (!aliases) return name;
  const canonical = aliases[normalizeForMatch(name)];
  return canonical || name;
}

export function wantCandidate(item: {
  id: string;
  work: string;
  year: number | null;
}): WantCandidate {
  return { id: item.id, work: item.work, year: item.year, tokens: significantTokens(item.work) };
}

export function lotIdentity(parts: {
  title: string;
  artist?: string | null;
  album?: string | null;
  marketTitle?: string | null;
  marketYear?: number | null;
}): LotIdentity {
  const raw = [parts.title, parts.artist, parts.album, parts.marketTitle]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" ");
  const text = normalizeForMatch(raw);
  const tokens = new Set(text.split(" ").filter(Boolean));
  const years = new Set<number>();
  for (const m of raw.matchAll(YEAR_RE)) years.add(Number(m[0]));
  if (parts.marketYear && parts.marketYear > 0) years.add(parts.marketYear);

  // Título em ordem, com o trecho (segmento) de cada palavra.
  const titleWords: string[] = [];
  const titleSegments: number[] = [];
  (parts.title ?? "").split(TITLE_SEGMENT_RE).forEach((seg, i) => {
    for (const w of normalizeForMatch(seg).split(" ")) {
      if (!w) continue;
      titleWords.push(w);
      titleSegments.push(i);
    }
  });

  // Lote de vários discos: o artista/álbum que a IA ou o Discogs arriscaram é de UM dos discos,
  // não do lote — nada estruturado é confiável aqui.
  const bundle = normalizeForMatch(parts.artist ?? "") === normalizeForMatch(LOTE_LABEL);
  const artists: string[][] = [];
  const albums: string[][] = [];
  if (!bundle) {
    const ai = splitArtistAlbum(parts.album);
    const market = splitArtistAlbum(parts.marketTitle);
    const seenArtist = new Set<string>();
    for (const name of [parts.artist, ai.artist, market.artist]) {
      const t = artistTokensOf(name);
      const key = t.join(" ");
      if (t.length && !seenArtist.has(key)) {
        seenArtist.add(key);
        artists.push(t);
      }
    }
    for (const name of [ai.album, market.album]) {
      const t = albumTokensOf(name);
      if (t.length) albums.push(t);
    }
  }
  return { text, tokens, years, titleWords, titleSegments, artists, albums, bundle };
}

/** Separadores de trecho no título do lote ("Artista - Álbum - LP 1972 | excelente"). */
const TITLE_SEGMENT_RE = /\s[-–—:/|]\s|\s*[|•]\s*/;

/**
 * Separa "Artista - Álbum (Ano)" (formato do álbum da IA e do título do release do Discogs).
 * Sem separador, é só o nome do disco.
 */
function splitArtistAlbum(raw: string | null | undefined): {
  artist: string | null;
  album: string | null;
} {
  const s = (raw ?? "")
    .replace(/\(\s*\d{4}\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { artist: null, album: null };
  const parts = s.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0]!.trim()) {
    return { artist: parts[0]!.trim(), album: parts.slice(1).join(" ").trim() || null };
  }
  return { artist: null, album: s };
}

/** Distância de edição ≤ 1 (troca/insere/remove um caractere) — barato, curto-circuita. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

/**
 * Um token da obra "está presente" no lote (igual, como substring, ou ~1 typo de distância).
 * `fuzzyMinLen` = tamanho mínimo para aceitar a correção de 1 letra (padrão 5, conservador). O
 * casamento de ARTISTA usa 4 para tolerar grafias como "Elis"↔"Ellis"; o de álbum mantém 5
 * (evita "arte"↔"parte" e afins inflarem o score).
 */
function tokenPresent(token: string, id: LotIdentity, fuzzyMinLen = 5): boolean {
  if (id.tokens.has(token)) return true;
  if (token.length >= 4 && id.text.includes(token)) return true;
  if (token.length >= fuzzyMinLen) {
    for (const t of id.tokens) {
      if (Math.abs(t.length - token.length) <= 1 && withinOneEdit(t, token)) return true;
    }
  }
  return false;
}

/** Probabilidade 0..1 de a obra `cand` corresponder ao lote `id`. */
export function scoreWant(cand: WantCandidate, id: LotIdentity): number {
  if (!cand.tokens.length) return 0;

  let hit = 0;
  for (const t of cand.tokens) if (tokenPresent(t, id)) hit++;
  let coverage = hit / cand.tokens.length;

  // Porta do artista: os 1-2 primeiros tokens costumam ser o nome do artista. Se NENHUM
  // deles aparece, quase certamente não é a obra (evita casar só pelo nome do disco).
  const head = cand.tokens.slice(0, Math.min(2, cand.tokens.length));
  if (!head.some((t) => tokenPresent(t, id))) coverage *= 0.4;

  // Ano: reforça quando bate, penaliza quando o lote tem ano DIFERENTE (desambigua
  // regravações/anos do mesmo artista); neutro quando o lote não informa ano.
  let adj = 0;
  if (cand.year && id.years.size) {
    if (id.years.has(cand.year)) adj = 0.15;
    else if (id.years.has(cand.year - 1) || id.years.has(cand.year + 1)) adj = 0.05;
    else adj = -0.25;
  }

  return Math.max(0, Math.min(1, coverage + adj));
}

/** Melhor obra da sondagem para o lote, ou null se nenhuma passa do limiar (80%). */
export function bestWantForLot(
  cands: WantCandidate[],
  id: LotIdentity,
): { cand: WantCandidate; score: number } | null {
  let best: { cand: WantCandidate; score: number } | null = null;
  for (const c of cands) {
    const s = scoreWant(c, id);
    if (!best || s > best.score) best = { cand: c, score: s };
  }
  return best && best.score >= WANT_MATCH_THRESHOLD ? best : null;
}

/**
 * Casamento "já tenho na Coleção": compara um lote com os discos que o usuário JÁ possui.
 *
 * Precisão em PRIMEIRO lugar (falso positivo é pior que faltar). A comparação é POR CAMPO —
 * artista com artista, álbum com álbum — e nunca por palavras soltas espalhadas no título
 * (a versão anterior juntava título + artista + álbum num saco só e aceitava substring, então
 * "arte" casava "parte", o artista citado como compositor contava como artista, e "Clube da
 * Esquina" casava "Clube da Esquina 2"). Um leva ao outro:
 *
 *  1. **Artista primeiro.** O artista do disco precisa bater com o artista ESTRUTURADO do lote
 *     (artista efetivo, "Artista" do álbum da IA ou do release do Discogs) — nomes aproximados
 *     porém bem relacionados (1 letra de diferença, "Elis Regina" ⊂ "Elis Regina & Tom Jobim"),
 *     comparados nos DOIS sentidos ("Milton Nascimento" ≠ "Milton Banana"). Se o lote diz ser de
 *     OUTRO artista, o disco nem é avaliado — assim, com o artista confirmado, só os discos DELE
 *     disputam o lote. Sem artista estruturado, basta o nome aparecer como FRASE no título, mas
 *     aí o casamento nunca passa de "?" (não dá pra ter certeza do artista).
 *  2. **Álbum depois, também nos dois sentidos.** Quando o lote tem álbum estruturado (IA/
 *     Discogs), os dois nomes precisam ser parecidos por inteiro (similaridade ≥ 75% e mesmos
 *     números de volume) — se o lote foi identificado como OUTRO disco, não casa, mesmo que o
 *     nome do disco da coleção apareça no texto (faixa, "contém…"). Sem álbum estruturado, o
 *     nome precisa aparecer como FRASE (palavras inteiras, em ordem) no título; vale mais quando
 *     está num trecho próprio ("Artista - Álbum") ou colado ao nome do artista, e um número logo
 *     depois ("… 2", "Vol. 3") que o disco da coleção não tem derruba o casamento.
 *
 * Casos especiais: título 100% genérico (coletânea/ao vivo: "Ao Vivo", "Seus Sucessos") exige o
 * ano EXATO; disco homônimo ("Djavan - Djavan") exige o artista confirmado e um álbum
 * estruturado também homônimo (ou, só com o ano exato, fica em "?"). Sem nome de álbum → não
 * marca (só a peça exata por `lot_id`, tratada no chamador).
 *
 * A UI aplica dois limiares: `>= OWNED_CONFIDENT_MIN` (80%) = confiante; entre
 * `OWNED_MATCH_MIN` (60%) e 80% = incerto ("?"); abaixo não marca.
 */
export const OWNED_MATCH_MIN = 0.6;
export const OWNED_CONFIDENT_MIN = 0.8;
/** Teto do score quando o artista NÃO foi confirmado por um campo estruturado do lote ("?"). */
const OWNED_UNCONFIRMED_ARTIST_MAX = 0.7;
/** Similaridade mínima (nos dois sentidos) entre dois nomes para considerá-los o mesmo. */
const NAME_SIMILARITY_MIN = 0.75;

/**
 * Tokens que NÃO distinguem um disco e por isso são removidos dos tokens distintivos do álbum
 * (senão casam discos diferentes do mesmo artista — ex.: "Ao Vivo", "Seus Sucessos"):
 *  - gênero/coletânea/formato/edição ("vivo", "sucessos", "coletânea", "duplo", "lp",
 *    "remasterizado"…);
 *  - estado/condição, que aparecem na descrição do lote ("excelente", "bom", "estado"…);
 *  - stopwords do português que sobrevivem ao corte de 3+ letras ("seus", "com", "para", "que"…).
 */
const GENERIC_ALBUM_TOKENS = new Set([
  // gênero / coletânea / formato / edição
  "vivo",
  "disco",
  "discos",
  "album",
  "albuns",
  "vol",
  "volume",
  "hits",
  "sucessos",
  "sucesso",
  "coletanea",
  "coletaneas",
  "colecao",
  "serie",
  "gold",
  "best",
  "classicos",
  "classico",
  "grandes",
  "raridades",
  "raridade",
  "duplo",
  "simples",
  "nacional",
  "internacional",
  "original",
  "originais",
  "estudio",
  "estereo",
  "stereo",
  "mono",
  "remaster",
  "remasterizado",
  "remastered",
  "reedicao",
  "edicao",
  "edition",
  "especial",
  "deluxe",
  "limitada",
  "limited",
  "compacto",
  "coletania",
  "antologia",
  "vinil",
  "vinis",
  "vinyl",
  "lps",
  "rpm",
  // estado / condição (vêm da descrição do lote, não do nome do disco)
  "excelente",
  "excelentes",
  "otimo",
  "otima",
  "bom",
  "boa",
  "estado",
  "conservado",
  "conservada",
  "raro",
  "rara",
  "novo",
  "nova",
  "usado",
  "usada",
  "capa",
  "encarte",
  // stopwords PT (≥ 3 letras) — não são "nome" de disco
  "dos",
  "das",
  "uma",
  "uns",
  "umas",
  "com",
  "sem",
  "por",
  "para",
  "pra",
  "que",
  "seu",
  "sua",
  "seus",
  "suas",
  "meu",
  "meus",
  "minha",
  "minhas",
  "nosso",
  "nossa",
  "teu",
  "tua",
  "este",
  "esta",
  "esse",
  "essa",
  "isso",
  "aquele",
  "aquela",
  "mais",
  "menos",
  "muito",
  "muita",
  "todo",
  "toda",
  "todos",
  "todas",
  "pois",
  "como",
  "onde",
  "quando",
  "the",
  "and",
  "of",
]);

/** Nomes que não são artista de verdade (buckets da UI, "vários artistas"…) — ignorados. */
const NON_ARTIST_NAMES = new Set(
  [
    LOTE_LABEL,
    COMPILATION_LABEL,
    UNCLASSIFIED_LABEL,
    "Coletânea",
    "Vários",
    "Vários Artistas",
    "Various",
    "Various Artists",
    "Diversos",
    "Diversos Artistas",
    "Artistas Diversos",
    "Unknown Artist",
    "Artista Desconhecido",
  ].map(normalizeForMatch),
);
/** Conectivos que não fazem parte do nome do artista ("Chico Buarque de Hollanda", "&"…). */
const ARTIST_STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "y",
  "the",
  "and",
  "of",
  "el",
  "la",
  "los",
  "las",
  "le",
  "les",
  "feat",
  "ft",
  "com",
]);

const DIGITS_RE = /^\d+$/;
const YEAR_TOKEN_RE = /^(?:19|20)\d{2}$/;

function uniq(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

/**
 * Tokens do NOME DE ARTISTA: palavras com 2+ letras (preserva "Lô", "U2"), sem conectivos nem
 * números soltos (o "(2)" de desambiguação do Discogs). Vazio para buckets/"vários artistas".
 */
function artistTokensOf(name: string | null | undefined): string[] {
  const norm = normalizeForMatch(name ?? "");
  if (!norm || NON_ARTIST_NAMES.has(norm)) return [];
  return uniq(
    norm.split(" ").filter((t) => t.length >= 2 && !DIGITS_RE.test(t) && !ARTIST_STOPWORDS.has(t)),
  );
}

/** Tokens do NOME DO DISCO: significativos (3+ letras ou números de volume), sem o ano. */
function albumTokensOf(name: string | null | undefined): string[] {
  return significantTokens(name ?? "").filter((t) => !YEAR_TOKEN_RE.test(t));
}

/** Mesma palavra de nome de artista: igual, ou 1 letra de diferença a partir de 4 letras. */
function artistTokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (DIGITS_RE.test(a) || DIGITS_RE.test(b)) return false;
  return a.length >= 4 && b.length >= 4 && withinOneEdit(a, b);
}

/**
 * Mesma palavra de nome de disco: igual, plural/singular, ou 1 letra de diferença a partir de
 * 5 letras. PALAVRA INTEIRA — nada de substring ("arte" ≠ "parte"); números só iguais.
 */
function albumTokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 2) return false;
  if (DIGITS_RE.test(a) || DIGITS_RE.test(b)) return false;
  if (a.length >= 4 && b.length >= 4 && (a === `${b}s` || b === `${a}s`)) return true;
  if (a.length >= 4 && b.length >= 4 && (a === `${b}es` || b === `${a}es`)) return true;
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b);
}

/**
 * Similaridade entre dois nomes (conjuntos de tokens), nos DOIS sentidos: pares casados 1-a-1
 * sobre o tamanho do MAIOR nome. `contained` = o menor nome está inteiro dentro do maior.
 */
function nameSimilarity(
  a: string[],
  b: string[],
  eq: (x: string, y: string) => boolean,
): { sim: number; contained: boolean; minLen: number } {
  const minLen = Math.min(a.length, b.length);
  if (!minLen) return { sim: 0, contained: false, minLen };
  const used = new Array<boolean>(b.length).fill(false);
  let matched = 0;
  for (const x of a) {
    const j = b.findIndex((y, k) => !used[k] && eq(x, y));
    if (j >= 0) {
      used[j] = true;
      matched++;
    }
  }
  return { sim: matched / Math.max(a.length, b.length), contained: matched === minLen, minLen };
}

/**
 * Dois nomes de artista são o mesmo (aproximados porém bem relacionados): ≥ 75% nos dois
 * sentidos, ou um contém o outro por inteiro com 2+ palavras ("Elis Regina" ⊂ "Elis Regina &
 * Tom Jobim"). "Milton Nascimento" × "Milton Banana" (50%) e "Queen" × "Queen Latifah" não.
 */
function artistsRelated(a: string[], b: string[]): boolean {
  const { sim, contained, minLen } = nameSimilarity(a, b, artistTokenEq);
  return sim >= NAME_SIMILARITY_MIN || (contained && minLen >= 2);
}

type Span = { start: number; end: number };

/** Palavras que podem ficar ENTRE as palavras de um nome sem quebrar a frase. */
const albumFiller = (w: string) =>
  w.length < 3 || GENERIC_ALBUM_TOKENS.has(w) || ARTIST_STOPWORDS.has(w);
const artistFiller = (w: string) => w.length < 2 || ARTIST_STOPWORDS.has(w);

/**
 * Todas as ocorrências de `tokens` como FRASE em `words`: em ordem, admitindo entre uma
 * palavra e outra no máximo 2 palavras de "enchimento" (`isFiller`: os "de"/"da"/"e"/"ao"/
 * "vivo" que o corte de tokens descarta). Qualquer outra palavra no meio quebra a frase
 * ("amor e paz perfeito" NÃO é "Amor Perfeito").
 */
function findPhrases(
  tokens: string[],
  words: string[],
  eq: (x: string, y: string) => boolean,
  isFiller: (w: string) => boolean,
): Span[] {
  const spans: Span[] = [];
  if (!tokens.length) return spans;
  for (let i = 0; i < words.length; i++) {
    if (!eq(tokens[0]!, words[i]!)) continue;
    let pos = i;
    let ok = true;
    for (let k = 1; k < tokens.length && ok; k++) {
      let found = -1;
      for (let j = pos + 1; j < words.length && j <= pos + 3; j++) {
        if (eq(tokens[k]!, words[j]!)) {
          found = j;
          break;
        }
        if (!isFiller(words[j]!)) break;
      }
      if (found < 0) ok = false;
      else pos = found;
    }
    if (ok) spans.push({ start: i, end: pos });
  }
  return spans;
}

/**
 * Chaves de busca aproximada de uma palavra: ela mesma + as variações com 1 letra apagada
 * (4+ letras). Duas palavras a ≤ 1 edição de distância sempre compartilham uma chave — índice
 * barato para descartar, antes da comparação fina, os discos cujo artista nem aparece no lote.
 */
function fuzzyKeys(t: string): string[] {
  if (t.length < 4) return [t];
  const keys = [t];
  for (let i = 0; i < t.length; i++) keys.push(t.slice(0, i) + t.slice(i + 1));
  return keys;
}

/** Índice de chaves por identidade de lote (título + artistas estruturados), calculado 1×. */
const identityKeysCache = new WeakMap<LotIdentity, Set<string>>();
function identityKeys(id: LotIdentity): Set<string> {
  let keys = identityKeysCache.get(id);
  if (!keys) {
    keys = new Set<string>();
    for (const w of [...wordsOf(id), ...(id.artists ?? []).flat()]) {
      for (const k of fuzzyKeys(w)) keys.add(k);
    }
    identityKeysCache.set(id, keys);
  }
  return keys;
}

function wordsOf(id: LotIdentity): string[] {
  return id.titleWords ?? (id.text ? id.text.split(" ") : []);
}

/**
 * Disco da coleção preparado para o casamento:
 *  - `artistTokens` — nome do artista (ver `artistTokensOf`);
 *  - `albumTokens` — **distintivos** do nome do disco (fora os do artista e os genéricos:
 *    "Cavalo", "Pau", "Arte", "Bugre"…), incluindo números de volume;
 *  - `genericTokens` — **genéricos** do título ("Vivo", "Seus", "Sucessos"…). Sozinhos não
 *    distinguem disco, mas com o **ano** viram o nome da coletânea ("Ao Vivo (1989)");
 *  - `numbers` — números do nome (volume/parte), que precisam bater exatamente;
 *  - `selfTitled` — disco homônimo (o nome do disco é o nome do artista).
 */
export type OwnedCandidate = {
  id: string;
  label: string; // "Artista Álbum" para o tooltip
  artistTokens: string[];
  artistKeys: string[]; // chaves de busca aproximada do artista (pré-filtro, ver `fuzzyKeys`)
  albumTokens: string[]; // distintivos (sem artista nem genéricos)
  genericTokens: string[]; // genéricos do título (sem artista)
  numbers: string[];
  selfTitled: boolean;
  year: number | null;
};

/** Melhor acerto na coleção para um lote: `score` 0..1 (a UI decide confiante × "?"). */
export type OwnedHit = { id: string; label: string; score: number };

export function ownedCandidate(item: {
  id: string;
  artist: string;
  album?: string | null;
  year: number | null;
}): OwnedCandidate {
  const artistTokens = artistTokensOf(item.artist);
  const artistSet = new Set([...artistTokens, ...significantTokens(item.artist ?? "")]);
  const albumAll = albumTokensOf(item.album);
  // Tokens do álbum que não são do artista, divididos em distintivos × genéricos.
  const rest = albumAll.filter((t) => !artistSet.has(t));
  return {
    id: item.id,
    label: [item.artist, item.album].filter((s): s is string => Boolean(s && s.trim())).join(" "),
    artistTokens,
    artistKeys: uniq(artistTokens.flatMap(fuzzyKeys)),
    albumTokens: uniq(rest.filter((t) => !GENERIC_ALBUM_TOKENS.has(t))),
    genericTokens: uniq(rest.filter((t) => GENERIC_ALBUM_TOKENS.has(t))),
    numbers: uniq(albumAll.filter((t) => DIGITS_RE.test(t))),
    selfTitled: albumAll.length > 0 && rest.length === 0,
    year: item.year,
  };
}

/**
 * Quão seguro é que o lote é do artista `artist`:
 *  - `confirmed` — bate com um artista ESTRUTURADO do lote;
 *  - `title` — o lote não tem artista estruturado (ou cita os dois artistas no título, dueto/
 *    "X interpreta Y"), mas o nome aparece como frase no título → no máximo "?";
 *  - `none` — não aparece, ou o lote é de OUTRO artista.
 * `spans` = onde o nome aparece no título (para a vizinhança com o álbum).
 */
function artistEvidence(
  artist: string[],
  id: LotIdentity,
  artistKeys?: string[],
): { level: "confirmed" | "title" | "none"; spans: Span[] } {
  if (!artist.length) return { level: "none", spans: [] };
  // Pré-filtro: nenhuma palavra do nome aparece (nem aproximada) no título/artistas do lote.
  const keys = identityKeys(id);
  if (!(artistKeys ?? artist.flatMap(fuzzyKeys)).some((k) => keys.has(k))) {
    return { level: "none", spans: [] };
  }
  const words = wordsOf(id);
  const lotArtists = id.artists ?? [];
  const all = findPhrases(artist, words, artistTokenEq, artistFiller);
  if (lotArtists.some((a) => artistsRelated(artist, a))) return { level: "confirmed", spans: all };
  // O lote diz ser de OUTRO artista. Uma ocorrência DENTRO do nome desse outro ("Queen" em
  // "Queen Latifah", "Milton" em "Milton Banana") não é citação — descarta.
  const others = lotArtists.flatMap((a) => findPhrases(a, words, artistTokenEq, artistFiller));
  const spans = all.filter((sp) => !others.some((o) => sp.start <= o.end && o.start <= sp.end));
  if (!spans.length) return { level: "none", spans };
  if (!lotArtists.length) return { level: "title", spans };
  // Se o outro artista também é citado no título (dueto, "X interpreta Y"), fica em dúvida;
  // se não (veio da IA/Discogs), o lote é de outro artista e o nome aqui é só citação.
  return { level: others.length ? "title" : "none", spans };
}

/**
 * Nome do disco da coleção × nome de disco ESTRUTURADO do lote (IA/Discogs), nos dois
 * sentidos: `match` (mesmo disco, nomes aproximados porém bem relacionados), `partial` (um nome
 * está inteiro dentro do outro — subtítulo; fica em "?"), `different` (o lote é OUTRO disco) ou
 * `none` (o lote não tem álbum estruturado).
 */
function albumVsStructured(
  distinct: string[],
  c: OwnedCandidate,
  id: LotIdentity,
): { level: "match" | "partial" | "different" | "none"; sim: number } {
  const albums = id.albums ?? [];
  if (!albums.length) return { level: "none", sim: 0 };
  const ignore = new Set([...c.artistTokens, ...(id.artists ?? []).flat()]);
  let best: { level: "match" | "partial" | "different"; sim: number } = {
    level: "different",
    sim: 0,
  };
  for (const lot of albums) {
    const lotNumbers = uniq(lot.filter((t) => DIGITS_RE.test(t)));
    const sameNumbers =
      lotNumbers.length === c.numbers.length && lotNumbers.every((n) => c.numbers.includes(n));
    if (!sameNumbers) continue; // "Vol. 1" × "Vol. 2", "Clube da Esquina" × "… 2"
    const lotDistinct = uniq(lot.filter((t) => !GENERIC_ALBUM_TOKENS.has(t) && !ignore.has(t)));
    const { sim, contained, minLen } = nameSimilarity(distinct, lotDistinct, albumTokenEq);
    if (sim >= NAME_SIMILARITY_MIN || (contained && minLen >= 2)) {
      const s = Math.max(sim, NAME_SIMILARITY_MIN);
      if (best.level !== "match" || s > best.sim) best = { level: "match", sim: s };
    } else if (contained && best.level === "different") {
      best = { level: "partial", sim };
    }
  }
  return best;
}

/**
 * Nome do disco da coleção no TÍTULO do lote (sem álbum estruturado), do mais ao menos seguro:
 *  - `segment` — a frase ocupa um trecho próprio do título ("Artista - Álbum - LP 1972") e o
 *    trecho não tem outras palavras de nome (confere nos dois sentidos);
 *  - `adjacent` — a frase está colada ao nome do artista ("LP Chico Buarque Construção 1971");
 *  - `phrase` — a frase aparece em outro ponto do título;
 *  - `scattered` — as palavras aparecem, mas espalhadas (não formam o nome).
 * Um número logo depois da frase ("Clube da Esquina 2", "… Vol. 3") que o disco da coleção
 * não tem invalida aquela ocorrência.
 */
function albumInTitle(
  distinct: string[],
  c: OwnedCandidate,
  id: LotIdentity,
  artistSpans: Span[],
): "segment" | "adjacent" | "phrase" | "scattered" | null {
  const words = wordsOf(id);
  const segs = id.titleSegments;
  const phrases = findPhrases(distinct, words, albumTokenEq, albumFiller);
  const valid = phrases.filter((sp) => {
    let j = sp.end + 1;
    while (j < words.length && /^(vol|volume|parte|part|n|no)$/.test(words[j]!)) j++;
    const next = words[j];
    return !(next && /^\d{1,2}$/.test(next) && !c.numbers.includes(next));
  });
  if (valid.length) {
    if (segs) {
      const artistSet = new Set(c.artistTokens);
      for (const sp of valid) {
        const seg = segs[sp.start];
        if (segs[sp.end] !== seg) continue;
        const segTokens = uniq(
          words
            .filter((_, k) => segs[k] === seg)
            .filter(
              (t) =>
                (t.length >= 3 || DIGITS_RE.test(t)) &&
                !GENERIC_ALBUM_TOKENS.has(t) &&
                !YEAR_TOKEN_RE.test(t) &&
                !artistSet.has(t),
            ),
        );
        if (nameSimilarity(distinct, segTokens, albumTokenEq).sim >= NAME_SIMILARITY_MIN) {
          return "segment";
        }
      }
    }
    const near = valid.some(
      (sp) =>
        artistSpans.some((a) => sp.start - a.end <= 3 && sp.start > a.end) ||
        artistSpans.some((a) => a.start - sp.end <= 3 && a.start > sp.end),
    );
    return near ? "adjacent" : "phrase";
  }
  if (phrases.length) return null; // a frase existe, mas é de OUTRO volume ("… 2")
  const all = distinct.every((t) => words.some((w) => albumTokenEq(t, w)));
  return all ? "scattered" : null;
}

/**
 * Score 0..1 de o disco `c` da coleção ser o mesmo do lote `id` (ver o comentário do bloco).
 * `denylist` são termos que o usuário já negou como "genéricos demais para distinguir disco"
 * (`app_state.collection_keyword_denylist`, clique no painel de relação) — removidos do nome do
 * disco ANTES da comparação, então um falso positivo corrigido uma vez deixa de acontecer em
 * QUALQUER lote futuro, não só no que foi corrigido.
 */
export function ownedScore(
  c: OwnedCandidate,
  id: LotIdentity,
  denylist?: ReadonlySet<string>,
): number {
  // 1) ARTISTA: sem ele, o nome do disco não vale nada.
  const artist = artistEvidence(c.artistTokens, id, c.artistKeys);
  if (artist.level === "none") return 0;
  const cap = artist.level === "confirmed" ? 1 : OWNED_UNCONFIRMED_ARTIST_MAX;

  const yearExact = c.year != null && id.years.has(c.year);
  const yearNear =
    c.year != null && (yearExact || id.years.has(c.year - 1) || id.years.has(c.year + 1));
  const yearConflict = c.year != null && id.years.size > 0 && !yearNear;
  const finish = (s: number) => Math.max(0, Math.min(cap, s));

  const deny = (t: string) => Boolean(denylist?.has(t));
  const distinct = c.albumTokens.filter((t) => !deny(t));
  const generic = c.genericTokens.filter((t) => !deny(t));

  // 2a) Título DISTINTIVO (nome real do disco).
  if (c.albumTokens.length) {
    if (!distinct.length) return 0; // todos os termos foram negados pelo usuário
    const structured = albumVsStructured(distinct, c, id);
    if (structured.level === "match") {
      // 75% → 0.80 … 100% → 0.95; reedição com outro ano ainda é o mesmo disco (penaliza pouco).
      let s = 0.8 + (0.15 * (structured.sim - NAME_SIMILARITY_MIN)) / (1 - NAME_SIMILARITY_MIN);
      if (yearExact) s += 0.03;
      else if (yearConflict) s -= 0.05;
      return finish(s);
    }
    if (structured.level === "partial") return finish(yearConflict ? 0 : 0.65);
    if (structured.level === "different") return 0; // o lote foi identificado como OUTRO disco

    // Sem álbum estruturado: o nome precisa estar no título, como frase.
    const where = albumInTitle(distinct, c, id, artist.spans);
    if (!where) return 0;
    const multi = distinct.length >= 2;
    let s: number;
    if (where === "segment") s = 0.9;
    else if (where === "adjacent") s = multi ? 0.9 : yearExact ? 0.9 : 0.75;
    else if (where === "phrase") s = multi ? (yearExact ? 0.85 : 0.75) : yearExact ? 0.8 : 0.65;
    else s = yearExact ? 0.7 : 0.6; // scattered
    if (yearConflict) s -= 0.15;
    return finish(s);
  }

  // 2b) Título 100% GENÉRICO (coletânea/ao vivo: "Ao Vivo", "Seus Sucessos"). O nome não
  // distingue disco, então o ANO vira o desambiguador: exige TODAS as palavras do título +
  // ano EXATO. Sem ano exato → não marca.
  if (c.genericTokens.length) {
    if (!generic.length || !yearExact) return 0;
    const inStructured = (id.albums ?? []).some((lot) =>
      generic.every((t) => lot.some((w) => albumTokenEq(t, w))),
    );
    const inTitle = findPhrases(generic, wordsOf(id), albumTokenEq, albumFiller).length > 0;
    return inStructured || inTitle ? finish(0.85) : 0;
  }

  // 2c) Disco HOMÔNIMO ("Djavan - Djavan"): o nome do disco não diz nada além do artista.
  // Exige o artista confirmado + álbum estruturado também homônimo; só com o ano exato → "?".
  if (c.selfTitled) {
    const albums = id.albums ?? [];
    if (albums.length) {
      const self = albums.some((lot) => {
        const rest = lot.filter(
          (t) => !GENERIC_ALBUM_TOKENS.has(t) && !c.artistTokens.some((a) => artistTokenEq(a, t)),
        );
        return lot.length > 0 && rest.length === 0;
      });
      return self ? finish(yearConflict ? 0.75 : 0.9) : 0;
    }
    return yearExact ? finish(0.7) : 0;
  }

  return 0; // sem nome de álbum → não marca (só a peça exata por lot_id, no chamador)
}

/**
 * Termos DISTINTIVOS do disco `c` que efetivamente casaram no lote `id` — a "causa" do score.
 * Serve para a UI oferecer negar um termo específico (`collection_keyword_denylist`) quando o
 * casamento foi falso positivo por causa dele (ex.: "sucessos" casando o disco errado).
 */
export function matchedAlbumTerms(c: OwnedCandidate, id: LotIdentity): string[] {
  const pool = c.albumTokens.length ? c.albumTokens : c.genericTokens;
  const words = [...wordsOf(id), ...(id.albums ?? []).flat()];
  return pool.filter((t) => words.some((w) => albumTokenEq(t, w)));
}

/**
 * Melhor disco da coleção para o lote (score ≥ `OWNED_MATCH_MIN`), ou null. Como o artista é
 * verificado primeiro (`ownedScore`), quando o lote tem artista confirmado só os discos DESSE
 * artista chegam a disputar.
 */
export function ownedMatchForLot(
  cands: OwnedCandidate[],
  id: LotIdentity,
  denylist?: ReadonlySet<string>,
): OwnedHit | null {
  let best: OwnedHit | null = null;
  for (const c of cands) {
    const score = ownedScore(c, id, denylist);
    if (score < OWNED_MATCH_MIN) continue;
    if (!best || score > best.score) best = { id: c.id, label: c.label, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Relação manual + APRENDIZADO ("já tenho na Coleção")
// ---------------------------------------------------------------------------

/** Como um disco apareceu num lote (gravado no feedback para SUGERIR em outros lotes). */
export type OwnedSignature = { artist: string[]; album: string[]; year: number | null };

/** Extrai a assinatura de um lote: tokens de artista + tokens do nome do disco + ano. */
export function ownedSignatureFromLot(parts: {
  artist?: string | null;
  album?: string | null; // nome do disco (álbum da IA já resolvido, ou o da coleção)
  title?: string | null;
  year?: number | null;
}): OwnedSignature {
  const artist = significantTokens(parts.artist ?? "");
  const artistSet = new Set(artist);
  const album = significantTokens(parts.album || parts.title || "").filter(
    (t) => !artistSet.has(t),
  );
  return { artist, album, year: parts.year ?? null };
}

/** Uma decisão aprendida: como o disco `itemId` apareceu num lote, e o veredito. */
export type OwnedFeedback = {
  lotId: string;
  itemId: string;
  verdict: "pos" | "neg";
  artist: string[];
  album: string[];
  year: number | null;
};

/** Vínculos explícitos por lote: itemId (vincular) | false ("não tenho"). */
export type CollectionLinks = Record<string, string | false>;

/** Estado efetivo de um lote quanto à Coleção (a UI decide cor/painel a partir daqui). */
export type OwnedResolution =
  | { kind: "none" } // cinza
  | { kind: "rejected" } // cinza ("não tenho")
  | { kind: "linked"; itemId: string } // roxo (manual)
  | { kind: "auto"; hit: OwnedHit } // roxo (≥80%) / roxo+? (60–80%)
  | { kind: "suggested"; itemId: string; score: number }; // roxo+? (aprendizado)

/**
 * O lote `id` "parece" o disco descrito na assinatura do feedback? (tolerante, p/ sugerir —
 * nunca confirma sozinho). Mesma lógica por campo do casamento automático: o artista precisa
 * bater (estruturado ou como frase no título, e o lote não pode ser de OUTRO artista) e o nome
 * do disco precisa aparecer em palavras inteiras (≥ 80%) no título ou no álbum estruturado.
 */
function feedbackMatches(fb: OwnedFeedback, id: LotIdentity): boolean {
  if (!fb.artist.length || !fb.album.length) return false;
  if (artistEvidence(fb.artist, id).level === "none") return false;
  const distinct = fb.album.filter((t) => !GENERIC_ALBUM_TOKENS.has(t));
  const name = distinct.length ? distinct : fb.album;
  const words = [...wordsOf(id), ...(id.albums ?? []).flat()];
  const hit = name.filter((t) => words.some((w) => albumTokenEq(t, w))).length;
  if (hit / name.length < 0.8) return false; // nome do disco
  // Ano (quando ambos conhecidos): coletâneas do mesmo tipo em anos diferentes NÃO casam.
  if (
    fb.year != null &&
    id.years.size > 0 &&
    !(id.years.has(fb.year) || id.years.has(fb.year - 1) || id.years.has(fb.year + 1))
  ) {
    return false;
  }
  return true;
}

/**
 * Resolve o estado de um lote combinando: override explícito (vence), casamento
 * automático e aprendizado (só SUGERE — "?"; nunca confirma sozinho nem esconde).
 */
export function resolveOwned(
  lotId: string,
  links: CollectionLinks,
  autoHit: OwnedHit | null,
  feedback: OwnedFeedback[],
  id: LotIdentity,
): OwnedResolution {
  const ov = links[lotId];
  if (ov === false) return { kind: "rejected" };
  if (typeof ov === "string") return { kind: "linked", itemId: ov };

  if (autoHit) {
    // Aprendizado NEGATIVO: já disseram que este disco não é deste tipo de lote → rebaixa p/ "?".
    const negated = feedback.some(
      (f) => f.verdict === "neg" && f.itemId === autoHit.id && feedbackMatches(f, id),
    );
    if (negated) {
      return { kind: "suggested", itemId: autoHit.id, score: Math.min(autoHit.score, 0.7) };
    }
    return { kind: "auto", hit: autoHit };
  }

  // Aprendizado POSITIVO: o automático não pegou, mas já confirmaram algo parecido → sugere "?".
  const pos = feedback.find((f) => f.verdict === "pos" && feedbackMatches(f, id));
  if (pos) return { kind: "suggested", itemId: pos.itemId, score: 0.7 };

  return { kind: "none" };
}

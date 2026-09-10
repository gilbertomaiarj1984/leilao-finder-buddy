export type VinylLot = {
  id: string;
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string; // número do lote exibido (ex.: "123"); "" quando não identificado
  watched: boolean;
  title: string;
  url: string;
  image: string | null;
  price: string;
  dayKey: string; // yyyy-mm-dd
  time: string; // e.g. "19:30h"
  uf: string;
  house: string;
  houseUrl: string;
  artist: string; // "" when unidentified
};

const VINYL_HINTS = [
  "lp",
  "lps",
  "disco",
  "discos",
  "disco de vinil",
  "discos de vinil",
  "vinil",
  "vinis",
  "vinyl",
  "compacto",
  "compactos",
  "bolachao",
  "bolachão",
  "long play",
  "78 rpm",
];

const NON_VINYL_HINTS = ["cd ", " cd", "dvd", "blu-ray", "fita k7", "k7", "cassete", "cassette"];

/**
 * Decodifica entidades HTML de um texto vindo de atributo/markup (`&#34;`, `&amp;`, `&#xE7;`…).
 * Algumas casas colocam a descrição completa do lote no atributo `title` do card (o tooltip
 * do site), e o parser de HTML usado na varredura NÃO decodifica entidades de atributos — daí
 * títulos aparecerem com `&#34;` literal em vez de `"`. Cobre nomeadas comuns + numéricas
 * (decimais e hex).
 *
 * ⚠️ DUPLA codificação: várias casas gravam o texto já escapado DUAS vezes (`&amp;#34;` em vez
 * de `&#34;`) — uma passada só decodifica o `&amp;` externo e deixa `&#34;` visível. Por isso
 * decodificamos em LOOP até a string estabilizar (teto de 5 passadas para evitar patologias).
 */
export function decodeHtmlEntities(s: string): string {
  let prev = s;
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/gi, "&");
    if (next === prev) break;
    prev = next;
  }
  return prev.replace(/\s+/g, " ").trim();
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isVinylTitle(title: string): boolean {
  const t = ` ${normalize(title)} `;
  const hasVinyl = VINYL_HINTS.some((hint) =>
    hint.length <= 3 ? new RegExp(`\\b${hint}\\b`).test(t) : t.includes(hint),
  );
  if (!hasVinyl) return false;
  // Only reject when the title looks like a non-vinyl format and never says vinil/LP disc.
  const mentionsDisc = t.includes("vinil") || /\blps?\b/.test(t) || t.includes("compacto");
  if (!mentionsDisc && NON_VINYL_HINTS.some((hint) => t.includes(hint))) return false;
  return true;
}

/**
 * A varredura já é feita na CATEGORIA "Disco de vinil" (parâmetro `tp`), então
 * TODO lote retornado já é vinil. Portanto NÃO exigimos uma palavra-chave de vinil
 * no título — casas dedicadas a vinil listam por artista/álbum ("Beatles - Abbey
 * Road") sem repetir "vinil/LP", e exigir a palavra descartava esses lotes (bug:
 * casa com 200+ lotes aparecia com 2). Aqui só descartamos o que é claramente de
 * OUTRO formato (CD/DVD/K7) e não menciona vinil.
 */
export function looksNonVinyl(title: string): boolean {
  const t = ` ${normalize(title)} `;
  const mentionsVinyl =
    t.includes("vinil") ||
    t.includes("vinyl") ||
    t.includes("disco") ||
    /\blps?\b/.test(t) ||
    t.includes("compacto") ||
    t.includes("bolachao") ||
    t.includes("long play");
  if (mentionsVinyl) return false;
  return NON_VINYL_HINTS.some((hint) => t.includes(hint));
}

// Sinal FORTE de vinil (formato explícito) — "disco" sozinho NÃO conta (DVD também é "disco").
const VINYL_STRONG_RE =
  /\b(?:lps?|vinil|vinyl|compactos?|bolach[aã]o|long\s*play|78\s*rpm|33\s*rpm)\b/;
// Formatos que NÃO são vinil (inequívocos) — no histórico de vendas/Analytics excluímos o
// lote inteiro quando aparecem SEM sinal forte de vinil. Cobre DVD/HQ/revista/livro/K7/VHS…
const NON_VINYL_SALE_RE =
  /\b(?:dvds?|blu[-\s]?ray|vhs|hqs?|gibis?|quadrinhos?|revistas?|livros?|figurinhas?|fita\s*k7|k7|cass?ete?s?)\b/;

/**
 * No contexto de VENDAS/Analytics: true quando o lote é claramente de OUTRO formato
 * (DVD, HQ/gibi, revista, livro, K7, VHS…) e NÃO há sinal forte de vinil no texto. Mais
 * rígido que `looksNonVinyl`: aqui "disco" sozinho não salva o lote (um DVD também é "disco").
 * Serve para EXCLUIR do histórico o que caiu por engano (ex.: grupos "2 dvds", "hqs").
 */
export function looksNonVinylSale(text: string): boolean {
  const t = ` ${normalize(text)} `;
  if (VINYL_STRONG_RE.test(t)) return false;
  return NON_VINYL_SALE_RE.test(t);
}

/**
 * true quando o status do meu lance é um resultado POSITIVO (cor verde na UI):
 * ganhando agora ("Vencendo") OU já arrematado/vencedor com o leilão encerrado
 * ("Arrematado"/"Vencedor"/"Arrebatado"). Casa os mesmos tokens de "winning" + "won"
 * de `classifyBid` (grouping.ts) para as duas rotas de cor não divergirem — antes só
 * `/venc/` marcava verde, então "Arrematado" (sem "venc") caía como vermelho.
 * "Coberto"/"Coberto e Vendido"/"Não vendido" continuam retornando false.
 */
export function bidIsWinning(status: string): boolean {
  return /venc|arremat|arrebat/i.test(status ?? "");
}

/**
 * Converte um preço em texto BR ("R$ 1.234,56": ponto de milhar, vírgula decimal)
 * para número. Retorna null quando não há valor numérico (ex.: "sem valor", "--").
 */
export function parsePrice(raw: string): number | null {
  const cleaned = (raw ?? "").replace(/[^\d,]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const UNCLASSIFIED_HINTS = [
  "novela",
  "trilha sonora",
  "trilha original",
  "coletanea",
  "coletaneas",
  "sucessos",
  "internacional",
  "nacional",
  "lote com",
  "lote de",
  "diversos",
  "varios",
  "musicas",
  "sertanejo",
  "carnaval",
  "infantil",
  "seleção",
  "selecao",
];

// Rótulos de campo que aparecem no próprio título ("Artista: X | Album: Y") e nunca são
// nomes de artista — usados para descartar candidatos espúrios em `extractArtist`.
const LABEL_WORDS = new Set(["artista", "album", "albuns", "titulo", "faixa", "faixas"]);

const PREFIX_PATTERNS: RegExp[] = [
  /^lote\s*(n?[ºo°]?\s*\d+)?\s*[-:–]?\s*/i,
  /^\d+\s*(lps?|discos?|vinis|compactos?)\b\s*[-:–]?\s*/i,
  /^(belissimo|belíssimo|belo|raro|rarissimo|raríssimo|antigo|otimo|ótimo|excelente)\s+/i,
  /^(lps?|long\s*play|discos?\s*de\s*vinil|disco\s*de\s*vinil|discos?|vinis|vinil|compactos?|compacto|bolach[aã]o|album|álbum)\b\s*[-:–,.]?\s*/i,
];

/** Rótulo do "artista" para lotes que são um conjunto/coleção de vários discos. */
export const LOTE_LABEL = "Lote";

/** Rótulo/sentinela do "artista" para coletâneas (vários artistas, sucessos, trilhas). */
export const COMPILATION_LABEL = "Coletâneas";

/**
 * Balaio do Vinil Analytics para onde vão coletâneas e novelas (curadoria do usuário). O nome
 * casa com o balaio criado à mão via curadoria — como o agrupamento é por `normalizeForMatch`,
 * pequenas diferenças de grafia caem no MESMO grupo.
 */
export const ANALYTICS_COMPILATION_LABEL = "Coletâneas, Novela e etc";

// "Artistas" que na verdade são um balaio de LOTE/lixo de catálogo (não um nome real): o próprio
// "Lote", códigos de casa tipo "Discos5"/"Discos 6" e placeholders de pregão ("Proposta de Lote
// Para Leilão"). Já normalizados (sem acento/caixa/pontuação). Alvo da IA de identificação.
const JUNK_ARTIST_RE = /^discos?\s*\d+$/;
const LOTE_PLACEHOLDER_HINTS = ["proposta de lote", "lote para leilao"];

// Sinais no TÍTULO de que o disco é uma coletânea (vários artistas / sucessos / trilha /
// novela), e não o álbum de um artista específico. Normalizados (sem acento, minúsculo).
const COMPILATION_HINTS = [
  "coletanea",
  "coletaneas",
  "coletania",
  "sucessos",
  "grandes sucessos",
  "as melhores",
  "varios artistas",
  "varios interpretes",
  "various artists",
  "diversos interpretes",
  "diversos artistas",
  "trilha sonora",
  "trilha original",
  "trilha de novela",
  "novela",
  "selecao de sucessos",
];

// Valores de "artista" (vindos da IA ou do título) que representam uma coletânea, não uma
// pessoa/banda. Comparados já normalizados por `normalizeForMatch`.
const VARIOUS_ARTIST_NAMES = new Set([
  "varios",
  "varios artistas",
  "varios interpretes",
  "various",
  "various artists",
  "va",
  "diversos",
  "diversos artistas",
  "diversos interpretes",
  "coletanea",
  "coletaneas",
  "artistas variados",
]);

/** true quando o TÍTULO indica uma coletânea (vários artistas / sucessos / trilha / novela). */
export function isCompilation(title: string): boolean {
  const t = normalize(title);
  return COMPILATION_HINTS.some((hint) => t.includes(hint));
}

/** true quando um nome de "artista" na verdade representa vários artistas (coletânea). */
export function isVariousArtists(name: string): boolean {
  return VARIOUS_ARTIST_NAMES.has(normalizeForMatch(name));
}

// Palavras que confirmam que o título fala de disco(s) — usadas com termos genéricos
// ("diversos", "coleção de") para só classificar como lote quando há contexto de disco.
const DISC_WORD = /\b(lps?|discos?|vinis|vinil|compactos?|bolach[aã]o|bolachoes|long play)\b/;

/**
 * true quando o título representa um LOTE de discos (conjunto de vários discos vendidos
 * juntos), e não um álbum específico. Sinais: "lote com/de ...", "kit com/de ...",
 * "coleção de discos", quantidade (3+) de discos ("20 LPs") ou "diversos/vários" + disco.
 * Discos duplos/triplos de um mesmo álbum (ex.: "2 LPs") NÃO contam como lote.
 */
export function isDiscBundle(title: string): boolean {
  const t = normalize(title);
  if (/\b(lote|kit)\s+(com|de)\b/.test(t)) return true;
  if (/\bcolecao de\b/.test(t) && DISC_WORD.test(t)) return true;
  const qty = t.match(/\b(\d+)\s*(lps?|discos?|vinis|vinil|compactos?|bolach[aã]o|bolachoes)\b/);
  if (qty && Number(qty[1]) >= 3) return true;
  if (/\b(diversos|varios|varias)\b/.test(t) && DISC_WORD.test(t)) return true;
  return false;
}

/**
 * Best-effort artist extraction from a lot title. Returns `LOTE_LABEL` for lots that are a
 * bundle of several discs, and "" when the title looks like a compilation / soundtrack or
 * no artist can be isolated.
 */
export function extractArtist(title: string): string {
  const normalized = normalize(title);
  if (isDiscBundle(title)) return LOTE_LABEL;
  if (UNCLASSIFIED_HINTS.some((hint) => normalized.includes(hint))) return "";

  let rest = title.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of PREFIX_PATTERNS) {
      const next = rest.replace(pattern, "");
      if (next !== rest) {
        rest = next.trim();
        changed = true;
      }
    }
  }

  // "ARTISTA - TITULO" / "ARTISTA – TITULO" / "ARTISTA: TITULO" / "ARTISTA. resto"
  const parts = rest.split(/\s[-–—:]\s|[-–—:](?=\s)|\s[-–—](?=\S)/);
  let candidate = (parts[0] ?? "").trim();

  // Cut trailing sentences / album names / parentheses: "Artista. Produto original..."
  candidate = candidate.split(/["“”([/]/)[0]!;
  candidate = candidate.split(/\.\s+|,\s+|;\s+/)[0]!;
  candidate = candidate
    .replace(/[(),.;:]+$/g, "")
    .replace(/^[(),.;:]+/g, "")
    .trim();
  candidate = candidate.replace(/\s+(vol\.?|volume)\s*\d*$/i, "").trim();

  const normCandidate = normalize(candidate);
  if (!normCandidate) return "";
  if (normCandidate.length < 3) return "";
  if (normCandidate.split(" ").length > 5) return "";
  if (/^\d+$/.test(normCandidate)) return "";
  // Títulos no formato "LP: Artista: X | Album: Y" deixam o rótulo "Artista"/"Álbum"
  // como 1º token antes do ":"; nunca é um nome de artista real — descarta para não
  // criar um grupo espúrio "Artista" (o valor real vem da identificação da IA).
  if (LABEL_WORDS.has(normCandidate)) return "";
  if (UNCLASSIFIED_HINTS.some((hint) => normCandidate.includes(hint))) return "";

  return titleCase(candidate);
}

const LOWER_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "of",
  "the",
  "and",
  "a",
  "o",
  "y",
  "los",
  "las",
  "le",
  "la",
  "des",
  "du",
  "van",
  "von",
]);

export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWER_WORDS.has(word)
        ? word
        : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1),
    )
    .join(" ")
    .trim();
}

export const UNCLASSIFIED_LABEL = "Novelas, coletâneas e não classificados";

// "Artistas" genéricos/lixo que o `extractArtist` produz de títulos ruidosos: categorias
// ("Colecionismo"), formato ("Duplo"), coletânea ("Various Artists", "Various", "Vários"),
// descritor de faixa ("Ao Vivo") ou rótulo solto ("Código"). Não são nomes de artista — o
// valor real precisa vir da IA de identificação. Já normalizados (sem acento, minúsculo).
const GENERIC_ARTISTS = new Set([
  "lote",
  "colecionismo",
  "colecao",
  "acervo",
  "duplo",
  "triplo",
  "quadruplo",
  "various",
  "various artists",
  "va",
  "varios",
  "varios artistas",
  "coletanea",
  "coletaneas",
  "ao vivo",
  "codigo",
  "novela",
  "novelas",
  "trilha sonora",
  "trilha original",
  "importado",
  "nacional",
  "internacional",
  "sucessos",
  "diversos",
  "promocional",
  "single",
  "compacto",
  "selecao",
  "selecoes",
]);

/**
 * true quando o "artista" é genérico/lixo (categoria, formato, coletânea, rótulo solto ou
 * vazio) e NÃO um nome real — casos em que o artista/álbum corretos devem ser buscados pela IA
 * de identificação. Ex.: "Colecionismo", "Duplo", "Various Artists", "Various", "Ao Vivo",
 * "Ao vivo | Código" (resto de parse com "|").
 */
export function isGenericArtist(artist: string | null | undefined): boolean {
  const a = normalize(artist ?? "");
  if (!a) return true; // vazio → agrupa em "não classificados"
  if (a.includes("|")) return true; // resto de "X | Código"
  if (GENERIC_ARTISTS.has(a)) return true;
  if (JUNK_ARTIST_RE.test(a)) return true; // "Discos5", "Discos 6" (código de casa, não artista)
  if (LOTE_PLACEHOLDER_HINTS.some((hint) => a.includes(hint))) return true; // placeholder de lote
  // Rótulo/dica de coletânea como o texto inteiro (não um nome de artista).
  if (UNCLASSIFIED_HINTS.some((hint) => a === hint)) return true;
  return false;
}

/** Parses "20/8/2026 - 19:30h - MG" style info lines. */
export function parseInfoLine(line: string): { dayKey: string; time: string } | null {
  const match = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*([\dh:.]+)/);
  if (!match) return null;
  const [, d, m, y, time] = match;
  const dayKey = `${y}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  return { dayKey, time: time!.replace(/\.$/, "") };
}

export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day keys for today + the next (count - 1) days, in São Paulo time. */
export function upcomingDayKeys(count = 3, now = new Date()): string[] {
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(sp);
    d.setDate(sp.getDate() + i);
    return toDayKey(d);
  });
}

export function formatDayLabel(dayKey: string, dayKeys: string[]): string {
  const index = dayKeys.indexOf(dayKey);
  const [y, m, d] = dayKey.split("-");
  const short = `${d}/${m}`;
  if (index === 0) return `Hoje · ${short}`;
  if (index === 1) return `Amanhã · ${short}`;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short" });
  return `${weekday.replace(".", "")} · ${short}`;
}

/** Instante de início do leilão (dia + hora, fuso São Paulo) em ms, ou null. */
function auctionStartMs(dayKey: string, time: string): number | null {
  const match = time.match(/(\d{1,2})[:h.]?(\d{2})?/);
  if (!match) return null;
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = (match[2] ?? "00").padStart(2, "0");
  const start = new Date(`${dayKey}T${hh}:${mm}:00-03:00`).getTime();
  return Number.isFinite(start) ? start : null;
}

/** true se o horário de início do leilão já passou. */
export function auctionStarted(dayKey: string, time: string, now: number = Date.now()): boolean {
  const start = auctionStartMs(dayKey, time);
  return start !== null && start <= now;
}

/**
 * true quando o leilão é considerado finalizado: passou `graceHours` (padrão 3h)
 * do horário de início. O site não informa o término, então usamos essa janela.
 */
export function auctionFinished(
  dayKey: string,
  time: string,
  now: number = Date.now(),
  graceHours = 3,
): boolean {
  const start = auctionStartMs(dayKey, time);
  return start !== null && now - start >= graceHours * 60 * 60 * 1000;
}

// --- Base de nomes conhecidos (reforço da classificação de artista) ---

/** Normalização para casar nomes: remove acentos e pontuação, baixa a caixa. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Quantidade de acentos numa string (desempate de grafia — mais acentuada é a "correta"). */
function accentScore(s: string): number {
  return (s.normalize("NFD").match(/[\u0300-\u036f]/g) ?? []).length;
}

/**
 * Escolhe a MELHOR grafia entre variações do mesmo nome (mesmo `normalizeForMatch`):
 * mais acentuada, depois mais longa, depois ordem alfabética. Usado para juntar registros
 * que só diferem por acento/caixa/pontuação (ex.: "Alceu Valença" = "Alceu Valenca") num
 * único nome canônico — evita 2 registros para o mesmo artista/álbum.
 */
export function pickCanonical(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (!list.length) return "";
  return list.sort(
    (a, b) => accentScore(b) - accentScore(a) || b.length - a.length || a.localeCompare(b, "pt-BR"),
  )[0]!;
}

/**
 * Relevância de um lote para a busca, para ordenar "mais exato primeiro, parecidos depois".
 * `queryNorm` já vem normalizado (via `normalizeForMatch`). Camadas, da mais forte à mais
 * fraca; 0 = não corresponde (não deve aparecer):
 *   5 — a IDENTIDADE (artista/álbum/título) começa com a frase digitada
 *   4 — a frase digitada aparece contígua na identidade
 *   3 — todos os termos aparecem na identidade (ordem livre)
 *   2 — a frase digitada aparece em qualquer campo (casa/nº do lote inclusos)
 *   1 — todos os termos aparecem em qualquer campo
 * Assim, buscar "clara nunes" põe os discos dela na frente e só depois traz um lote de
 * outra pessoa numa casa que por acaso contém os termos.
 */
export function searchRelevance(identity: string, extra: string, queryNorm: string): number {
  if (!queryNorm) return 1;
  const id = normalizeForMatch(identity);
  const full = normalizeForMatch(`${identity} ${extra}`);
  const tokens = queryNorm.split(" ").filter(Boolean);
  const allIn = (hay: string) => tokens.every((t) => hay.includes(t));
  if (id.startsWith(queryNorm)) return 5;
  if (id.includes(queryNorm)) return 4;
  if (allIn(id)) return 3;
  if (full.includes(queryNorm)) return 2;
  if (allIn(full)) return 1;
  return 0;
}

// Nomes de UMA palavra que também são palavras comuns (PT/EN) e gerariam falsos
// positivos; só entram na base como parte de nomes com 2+ palavras.
const AMBIGUOUS_SINGLE_WORDS = new Set([
  "free",
  "love",
  "zero",
  "cream",
  "sweet",
  "angel",
  "death",
  "family",
  "spirit",
  "war",
  "air",
  "can",
  "yes",
  "mud",
  "egg",
  "dust",
  "fist",
  "toad",
  "bang",
  "art",
  "peso",
  "stress",
  "strike",
  "oriente",
  "sensacao",
  "evolucao",
  "abolicao",
  "overdose",
  "devotos",
  "inocentes",
  "replicantes",
  "chic",
  "mina",
  "jane",
  "nico",
  "sade",
  "dio",
  "jesus",
  "zero",
]);

const LEADING_ARTICLES = ["the ", "os ", "as ", "o ", "a "];

export type KnownArtistIndex = { byNorm: Map<string, string>; maxWords: number };

/** Constrói o índice de busca a partir da lista de nomes canônicos. */
export function buildKnownArtistIndex(names: string[]): KnownArtistIndex {
  const byNorm = new Map<string, string>();
  let maxWords = 1;
  const add = (key: string, canonical: string) => {
    const words = key.split(" ").filter(Boolean);
    if (!words.length) return;
    if (words.length === 1 && (key.length < 4 || AMBIGUOUS_SINGLE_WORDS.has(key))) return;
    if (!byNorm.has(key)) byNorm.set(key, canonical);
    if (words.length > maxWords) maxWords = words.length;
  };
  for (const raw of names) {
    const norm = normalizeForMatch(raw);
    if (norm.length < 2) continue;
    add(norm, raw);
    // Indexa também sem o artigo inicial: "The Beatles" também casa "beatles".
    for (const article of LEADING_ARTICLES) {
      if (norm.startsWith(article)) {
        add(norm.slice(article.length), raw);
        break;
      }
    }
  }
  return { byNorm, maxWords };
}

/**
 * Procura um nome conhecido dentro do título como sequência de palavras inteiras;
 * o maior nome encontrado vence. Retorna "" quando nada casa.
 */
export function matchKnownArtist(title: string, index: KnownArtistIndex): string {
  const words = normalizeForMatch(title).split(" ").filter(Boolean);
  const max = Math.min(index.maxWords, words.length);
  for (let size = max; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const hit = index.byNorm.get(words.slice(i, i + size).join(" "));
      if (hit) return hit;
    }
  }
  return "";
}

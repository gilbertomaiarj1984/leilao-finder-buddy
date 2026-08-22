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
  "disco de vinil",
  "discos de vinil",
  "vinil",
  "vinis",
  "compacto",
  "compactos",
  "bolachao",
  "bolachão",
  "long play",
  "78 rpm",
];

const NON_VINYL_HINTS = ["cd ", " cd", "dvd", "blu-ray", "fita k7", "k7", "cassete", "cassette"];

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

const PREFIX_PATTERNS: RegExp[] = [
  /^lote\s*(n?[ºo°]?\s*\d+)?\s*[-:–]?\s*/i,
  /^\d+\s*(lps?|discos?|vinis|compactos?)\b\s*[-:–]?\s*/i,
  /^(belissimo|belíssimo|belo|raro|rarissimo|raríssimo|antigo|otimo|ótimo|excelente)\s+/i,
  /^(lps?|long\s*play|discos?\s*de\s*vinil|disco\s*de\s*vinil|discos?|vinis|vinil|compactos?|compacto|bolach[aã]o|album|álbum)\b\s*[-:–,.]?\s*/i,
];

/**
 * Best-effort artist extraction from a lot title. Returns "" when the title looks
 * like a compilation / soundtrack / mixed lot or no artist can be isolated.
 */
export function extractArtist(title: string): string {
  const normalized = normalize(title);
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
  candidate = candidate.split(/["“”(\[/]/)[0]!;
  candidate = candidate.split(/\.\s+|,\s+|;\s+/)[0]!;
  candidate = candidate.replace(/[(),.;:]+$/g, "").replace(/^[(),.;:]+/g, "").trim();
  candidate = candidate.replace(/\s+(vol\.?|volume)\s*\d*$/i, "").trim();


  const normCandidate = normalize(candidate);
  if (!normCandidate) return "";
  if (normCandidate.length < 3) return "";
  if (normCandidate.split(" ").length > 5) return "";
  if (/^\d+$/.test(normCandidate)) return "";
  if (UNCLASSIFIED_HINTS.some((hint) => normCandidate.includes(hint))) return "";

  return titleCase(candidate);
}

const LOWER_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "of", "the", "and", "a", "o", "y", "los", "las", "le", "la", "des", "du", "van", "von",
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

/** true se o horário de início do leilão (dia + hora, fuso São Paulo) já passou. */
export function auctionStarted(dayKey: string, time: string, now: number = Date.now()): boolean {
  const match = time.match(/(\d{1,2})[:h.]?(\d{2})?/);
  if (!match) return false;
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = (match[2] ?? "00").padStart(2, "0");
  const start = new Date(`${dayKey}T${hh}:${mm}:00-03:00`).getTime();
  return Number.isFinite(start) && start <= now;
}

// --- Base de nomes conhecidos (reforço da classificação de artista) ---

/** Normalização para casar nomes: remove acentos e pontuação, baixa a caixa. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Nomes de UMA palavra que também são palavras comuns (PT/EN) e gerariam falsos
// positivos; só entram na base como parte de nomes com 2+ palavras.
const AMBIGUOUS_SINGLE_WORDS = new Set([
  "free", "love", "zero", "cream", "sweet", "angel", "death", "family", "spirit",
  "war", "air", "can", "yes", "mud", "egg", "dust", "fist", "toad", "bang", "art",
  "peso", "stress", "strike", "oriente", "sensacao", "evolucao", "abolicao",
  "overdose", "devotos", "inocentes", "replicantes", "chic", "mina", "jane",
  "nico", "sade", "dio", "jesus", "zero",
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

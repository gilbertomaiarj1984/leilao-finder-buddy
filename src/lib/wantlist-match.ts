import { normalizeForMatch } from "@/lib/vinyl-parse";

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

/** Identidade do lote: texto normalizado + conjunto de tokens + anos conhecidos. */
export type LotIdentity = {
  text: string;
  tokens: Set<string>;
  years: Set<number>;
};

export function wantCandidate(item: {
  id: string;
  work: string;
  year: number | null;
}): WantCandidate {
  // Tokens significativos: palavras com 3+ letras e também números curtos (ex.: o "1"/"2"
  // de "Vol. 1"), que costumam distinguir volumes/edições do mesmo disco.
  const tokens = normalizeForMatch(item.work)
    .split(" ")
    .filter((t) => t.length >= 3 || /^\d+$/.test(t));
  return { id: item.id, work: item.work, year: item.year, tokens };
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
  return { text, tokens, years };
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

/** Um token da obra "está presente" no lote (igual, como substring, ou ~1 typo de distância). */
function tokenPresent(token: string, id: LotIdentity): boolean {
  if (id.tokens.has(token)) return true;
  if (token.length >= 4 && id.text.includes(token)) return true;
  if (token.length >= 5) {
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

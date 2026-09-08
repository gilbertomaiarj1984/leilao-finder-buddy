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

/**
 * Tokens significativos de um texto: palavras com 3+ letras e também números curtos (ex.: o
 * "1"/"2" de "Vol. 1"), que costumam distinguir volumes/edições do mesmo disco.
 */
function significantTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .filter((t) => t.length >= 3 || /^\d+$/.test(t));
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

/**
 * Casamento "já tenho na Coleção": compara um lote com os discos que o usuário JÁ possui.
 *
 * Diferente da sondagem, aqui separamos os tokens de ARTISTA e de ÁLBUM para dosar a
 * confiança em duas faixas:
 *  - **artista + álbum** casam → score alto (o ano é só reforço; uma reedição em ano
 *    diferente ainda é o MESMO álbum que ele tem);
 *  - **artista + ano**, com o álbum NÃO confirmado (a coleção não tem o álbum, ou o lote não
 *    expõe o nome) → score na faixa intermediária (a UI marca com "?").
 *
 * A UI aplica dois limiares: `>= OWNED_CONFIDENT_MIN` (80%) = casamento confiante; entre
 * `OWNED_MATCH_MIN` (50%) e 80% = incerto ("?"); abaixo de 50% não marca.
 */
export const OWNED_MATCH_MIN = 0.5;
export const OWNED_CONFIDENT_MIN = 0.8;

/** Disco da coleção preparado para o casamento (tokens de artista e de álbum separados). */
export type OwnedCandidate = {
  id: string;
  label: string; // "Artista Álbum" para o tooltip
  artistTokens: string[];
  albumTokens: string[];
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
  return {
    id: item.id,
    label: [item.artist, item.album].filter((s): s is string => Boolean(s && s.trim())).join(" "),
    artistTokens: significantTokens(item.artist),
    albumTokens: item.album ? significantTokens(item.album) : [],
    year: item.year,
  };
}

/** Fração dos tokens presentes na identidade do lote (0..1). */
function coverage(tokens: string[], id: LotIdentity): number {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) if (tokenPresent(t, id)) hit++;
  return hit / tokens.length;
}

/** Score 0..1 de o disco `c` da coleção ser o mesmo do lote `id`. */
function ownedScore(c: OwnedCandidate, id: LotIdentity): number {
  const artistCov = coverage(c.artistTokens, id);
  if (artistCov <= 0) return 0; // sem o artista, não é ele

  const yearKnown = c.year != null && id.years.size > 0;
  const yearMatch =
    c.year != null &&
    (id.years.has(c.year) || id.years.has(c.year - 1) || id.years.has(c.year + 1));
  const yearConflict = yearKnown && !yearMatch;

  if (c.albumTokens.length) {
    // Artista + álbum já casa (o ano só reforça; conflito de ano penaliza um pouco). Com os
    // dois cheios → 1.0 (confiante). Álbum parcial/ausente cai para a faixa do "?".
    const albumCov = coverage(c.albumTokens, id);
    const s = 0.4 * artistCov + 0.6 * albumCov + (yearMatch ? 0.1 : yearConflict ? -0.2 : 0);
    return Math.max(0, Math.min(1, s));
  }
  // Sem álbum na coleção: no MÁXIMO incerto ("?"), e só quando o ANO confirma o artista.
  if (yearMatch) return Math.min(0.75, 0.5 + 0.25 * artistCov);
  return Math.min(0.4, 0.4 * artistCov); // sem álbum e sem ano batendo: fraco → não marca
}

/** Melhor disco da coleção para o lote (score ≥ 50%), ou null. */
export function ownedMatchForLot(cands: OwnedCandidate[], id: LotIdentity): OwnedHit | null {
  let best: OwnedHit | null = null;
  for (const c of cands) {
    const score = ownedScore(c, id);
    if (score < OWNED_MATCH_MIN) continue;
    if (!best || score > best.score) best = { id: c.id, label: c.label, score };
  }
  return best;
}

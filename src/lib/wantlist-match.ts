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
 * Precisão em PRIMEIRO lugar (evitar falso positivo é mais importante que pegar tudo). O
 * casamento EXIGE o nome do álbum e separa os tokens do álbum (fora os do artista) em:
 *  - **distintivos** (nome real do disco) — descontando os que também são do ARTISTA (ex.:
 *    "A Arte de Jorge Ben" → distintivo só "arte"; senão "jorge"/"ben" casariam sempre que o
 *    lote cita o artista, inclusive como compositor — "Músicas de Jorge Ben");
 *  - **genéricos** de coletânea/ao vivo/estado/stopword ("Ao Vivo", "Seus Sucessos"…).
 *
 * Dois caminhos no score (0..1), sempre com o **artista** claramente presente (`OWNED_ARTIST_MIN`):
 *  1. **título distintivo** → dirigido pela cobertura do álbum (o ano só reforça / desempata
 *     reedições);
 *  2. **título 100% genérico** (coletânea/ao vivo) → o nome não distingue disco, então usamos
 *     o **nome da coletânea como nome do disco** e o **ano** como desambiguador: exige o título
 *     inteiro presente + **ano EXATO** ("Ao Vivo (1989)", "Seus Sucessos (1978)").
 *
 * Sem álbum confirmável → NÃO marca (só a peça exata por
 * `lot_id`, tratada no chamador). A UI aplica dois limiares: `>= OWNED_CONFIDENT_MIN` (80%) =
 * confiante; entre `OWNED_MATCH_MIN` (60%) e 80% = incerto ("?"); abaixo não marca.
 */
export const OWNED_MATCH_MIN = 0.6;
export const OWNED_CONFIDENT_MIN = 0.8;
/** O artista precisa aparecer quase inteiro (evita casar "Milton" por "Milton Banana"). */
const OWNED_ARTIST_MIN = 0.75;

/**
 * Tokens que NÃO distinguem um disco e por isso são removidos dos tokens distintivos do álbum
 * (senão casam discos diferentes do mesmo artista — ex.: "Ao Vivo", "Seus Sucessos"):
 *  - gênero/coletânea/formato ("vivo", "sucessos", "coletânea", "duplo"…);
 *  - estado/condição, que aparecem na descrição do lote ("excelente", "bom", "estado"…);
 *  - stopwords do português que sobrevivem ao corte de 3+ letras ("seus", "com", "para", "que"…).
 */
const GENERIC_ALBUM_TOKENS = new Set([
  // gênero / coletânea / formato
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
  "mono",
  "remaster",
  "compacto",
  "coletania",
  "antologia",
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

/**
 * Disco da coleção preparado para o casamento. Os tokens do álbum (fora os do artista) são
 * separados em:
 *  - `albumTokens` — **distintivos** (nome real do disco: "Cavalo", "Pau", "Arte", "Bugre"…);
 *  - `genericTokens` — **genéricos** de coletânea/ao vivo/estado/stopword ("Vivo", "Seus",
 *    "Sucessos"…). Sozinhos não distinguem disco, mas com o **ano** viram o nome da coletânea
 *    ("Ao Vivo (1989)", "Seus Sucessos (1978)").
 */
export type OwnedCandidate = {
  id: string;
  label: string; // "Artista Álbum" para o tooltip
  artistTokens: string[];
  albumTokens: string[]; // distintivos (sem artista nem genéricos)
  genericTokens: string[]; // genéricos do título (sem artista)
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
  const artistTokens = significantTokens(item.artist);
  const artistSet = new Set(artistTokens);
  // Tokens do álbum que não são do artista, divididos em distintivos × genéricos.
  const albumAll = item.album ? significantTokens(item.album).filter((t) => !artistSet.has(t)) : [];
  return {
    id: item.id,
    label: [item.artist, item.album].filter((s): s is string => Boolean(s && s.trim())).join(" "),
    artistTokens,
    albumTokens: albumAll.filter((t) => !GENERIC_ALBUM_TOKENS.has(t)),
    genericTokens: albumAll.filter((t) => GENERIC_ALBUM_TOKENS.has(t)),
    year: item.year,
  };
}

/** Fração dos tokens presentes na identidade do lote (0..1). */
function coverage(tokens: string[], id: LotIdentity, fuzzyMinLen = 5): number {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) if (tokenPresent(t, id, fuzzyMinLen)) hit++;
  return hit / tokens.length;
}

/** Score 0..1 de o disco `c` da coleção ser o mesmo do lote `id`. */
function ownedScore(c: OwnedCandidate, id: LotIdentity): number {
  // Artista com fuzzy mais tolerante (4+) → aceita "Ellis Regina" para "Elis Regina".
  const artistCov = coverage(c.artistTokens, id, 4);
  if (artistCov < OWNED_ARTIST_MIN) return 0; // o artista precisa estar claramente presente

  const yearExact = c.year != null && id.years.has(c.year);
  const yearMatch =
    c.year != null && (yearExact || id.years.has(c.year - 1) || id.years.has(c.year + 1));
  const yearKnown = c.year != null && id.years.size > 0;
  const yearConflict = yearKnown && !yearMatch;

  // (1) Título DISTINTIVO (nome real do disco): score dirigido pela cobertura do álbum. O ano
  // só reforça; num conflito, cobertura alta ainda é reedição do mesmo disco (penaliza pouco),
  // cobertura parcial com ano diferente cai fora.
  if (c.albumTokens.length) {
    const albumCov = coverage(c.albumTokens, id);
    if (albumCov <= 0) return 0; // o álbum não aparece no lote → não é este disco
    let s = albumCov;
    if (yearMatch) s += 0.1;
    else if (yearConflict) s -= albumCov >= 0.8 ? 0.05 : 0.3;
    return Math.max(0, Math.min(1, s));
  }

  // (2) Título 100% GENÉRICO (coletânea/ao vivo: "Ao Vivo", "Seus Sucessos"). Como o nome não
  // distingue disco, o ANO vira o desambiguador: exige artista + TODAS as palavras do título +
  // ano EXATO. Assim "Ao Vivo (1989)"/"Seus Sucessos (1978)" casam o disco certo, e um outro
  // ano do mesmo tipo não casa. Sem ano exato → não marca.
  if (c.genericTokens.length && yearExact && coverage(c.genericTokens, id) >= 1) {
    return 0.85;
  }
  return 0; // sem álbum confirmável → não marca (só a peça exata por lot_id, no chamador)
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

/** O lote `id` "parece" o disco descrito na assinatura do feedback? (tolerante, p/ sugerir). */
function feedbackMatches(fb: OwnedFeedback, id: LotIdentity): boolean {
  if (!fb.artist.length || !fb.album.length) return false;
  if (coverage(fb.artist, id, 4) < OWNED_ARTIST_MIN) return false; // artista (tolera grafia)
  if (coverage(fb.album, id) < 0.5) return false; // nome do disco
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

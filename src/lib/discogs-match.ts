/**
 * Casamento do lote com um release do Discogs (funções PURAS, testáveis sem token). A busca em si
 * fica em `discogs.server.ts`; aqui só se decide, entre os resultados, qual é o disco.
 */
import { normalizeForMatch } from "./vinyl-parse";

export type SearchHit = {
  id?: number;
  /** Master do release (0/ausente = sem master). Em resultados `type=master`, o próprio `id` é o master. */
  master_id?: number;
  title?: string;
  year?: number | string;
  country?: string;
  format?: string[];
  community?: { have?: number; want?: number };
  thumb?: string;
  cover_image?: string;
};

/** O que a IA identificou, quebrado em artista/álbum/ano para casar melhor no Discogs. */
export type ReleaseTarget = { artist: string | null; title: string | null; year: number | null };

/** Extrai o 1º ano (19xx/20xx) de um texto. */
export function extractYear(text: string): number | null {
  const m = (text ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/**
 * Quebra o `album` da IA ("Artista - Álbum (1970)") em {artista, título, ano}. Tolerante:
 * separa no primeiro travessão/hífen/barra (o modelo às vezes devolve "Artista / Álbum"
 * no lugar do " - " pedido); sem separador, tudo vira título. Remove o "(ano)".
 */
export function parseAlbum(album: string): ReleaseTarget {
  const year = extractYear(album);
  let s = (album ?? "")
    .replace(/\((?:\s*\d{4}\s*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0].trim()) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(" - ").trim();
    return { artist: artist || null, title: title || null, year };
  }
  s = s
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { artist: null, title: s || null, year };
}

// Sinais de coletânea/"greatest hits" no título do release (para não casar com elas quando
// o alvo é um álbum de estúdio específico).
const COMP_HINTS = [
  "greatest hits",
  "best of",
  "the best",
  "anthology",
  "collection",
  "compilation",
  "essential",
  "singles",
];
function looksCompilation(title: string, formats: string[]): boolean {
  const t = (title ?? "").toLowerCase();
  if (/\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/.test(t)) return true; // faixa de anos "1967-1970"
  if (COMP_HINTS.some((h) => t.includes(h))) return true;
  return (formats ?? []).some((f) => /comp|compilation/i.test(f));
}

function coverage(targetTokens: string[], resultTokens: Set<string>): number {
  if (!targetTokens.length) return 1;
  let hit = 0;
  for (const t of targetTokens) if (resultTokens.has(t)) hit += 1;
  return hit / targetTokens.length;
}

/**
 * Formato do release: `lp` (LP/12"/Album), `small` (7"/compacto/single/EP) ou `other`. O Discogs
 * devolve algo como ["Vinyl", "LP", "Album"] ou ["Vinyl", "7\"", "45 RPM", "Single"].
 */
export function releaseFormat(formats: readonly string[] | undefined): "lp" | "small" | "other" {
  const f = (formats ?? []).map((x) => x.toLowerCase());
  const small = f.some((x) => /^(7|10)"$|single|\bep\b|45 rpm/.test(x));
  const lp = f.some((x) => /^lp$|^12"$|album|33 ?⅓|33 rpm/.test(x));
  if (small && !lp) return "small";
  if (lp) return "lp";
  return "other";
}

/** Resultado do casamento: o release escolhido e a evidência (para auditar o veredicto depois). */
type ReleaseMatch = {
  hit: SearchHit;
  titleCov: number;
  artistCov: number;
};

/**
 * Escolhe o melhor release para o alvo (artista+álbum+ano). Pontua pela **cobertura dos
 * tokens do ÁLBUM** (peso maior) + cobertura do artista + ano + vinil/LP, com **penalidade para
 * coletâneas e para compactos/EP** (o preço de um 7" não vale para um LP). Rejeita (null) quando a
 * cobertura mínima do álbum/artista não é atingida — melhor não casar do que casar com o disco
 * errado (ex.: "Let It Be" vs "1967-1970").
 */
export function pickBestRelease(target: ReleaseTarget, results: SearchHit[]): ReleaseMatch | null {
  if (!results?.length) return null;
  const titleToks = target.title ? normalizeForMatch(target.title).split(" ").filter(Boolean) : [];
  const artistToks = target.artist
    ? normalizeForMatch(target.artist).split(" ").filter(Boolean)
    : [];
  let best: SearchHit | null = null;
  let bestScore = -Infinity;
  let bestTitleCov = 0;
  let bestArtistCov = 0;
  for (const r of results) {
    const rTokens = new Set(
      normalizeForMatch(r.title ?? "")
        .split(" ")
        .filter(Boolean),
    );
    const titleCov = coverage(titleToks, rTokens);
    const artistCov = coverage(artistToks, rTokens);
    const isVinyl = (r.format ?? []).some((f) => /vinyl|lp|vinil/i.test(f)) ? 0.5 : 0;
    const kind = releaseFormat(r.format);
    const formatBonus = kind === "lp" ? 0.5 : kind === "small" ? -2 : 0;
    const ry = Number(r.year);
    let yearBonus = 0;
    if (target.year && Number.isFinite(ry) && ry > 0) {
      if (ry === target.year) yearBonus = 2;
      else if (Math.abs(ry - target.year) <= 1) yearBonus = 0.5;
      else yearBonus = -1.5;
    }
    let score = titleCov * 5 + artistCov * 3 + isVinyl + formatBonus + yearBonus;
    // Coletânea só é penalizada quando NÃO é exatamente o álbum buscado.
    if (looksCompilation(r.title ?? "", r.format ?? []) && titleCov < 0.999) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = r;
      bestTitleCov = titleCov;
      bestArtistCov = artistCov;
    }
  }
  // Piso de aceitação: o álbum precisa aparecer bem no título e o artista bater.
  if (!best) return null;
  if (titleToks.length && bestTitleCov < 0.6) return null;
  if (artistToks.length && bestArtistCov < 0.5) return null;
  return { hit: best, titleCov: bestTitleCov, artistCov: bestArtistCov };
}

/**
 * O master/release achado serve para o álbum que o usuário digitou? Para álbum HOMÔNIMO ("Caetano
 * Veloso — Caetano Veloso") o ano é o que distingue os discos: se o Discogs não tem o master do ano
 * pedido e devolve o "mais parecido" (outro ano), usá-lo funde dois discos diferentes. Então, com
 * ano pedido, o do resultado precisa estar a ≤1 ano; sem ano pedido, não se adivinha. Álbum não
 * homônimo aceita qualquer ano (a diferença é reedição do mesmo álbum).
 */
export function masterMatchesTarget(
  selfTitled: boolean,
  targetYear: number | null,
  hitYear: number | string | undefined,
): boolean {
  if (!selfTitled) return true;
  const y = Number(hitYear);
  if (!targetYear || !Number.isFinite(y) || y <= 0) return false;
  return Math.abs(y - targetYear) <= 1;
}

/** Evidência do casamento que vai para `lot_market.match_info` (auditoria de um preço estranho). */
export type MatchInfo = {
  /** Como achou: `br` = busca restrita ao Brasil; `any` = busca sem país. */
  via: "br" | "any";
  country: string | null;
  format: "lp" | "small" | "other";
  titleCov: number;
  artistCov: number;
};

export function toMatchInfo(match: ReleaseMatch, via: MatchInfo["via"]): MatchInfo {
  return {
    via,
    country: match.hit.country ?? null,
    format: releaseFormat(match.hit.format),
    titleCov: Math.round(match.titleCov * 100) / 100,
    artistCov: Math.round(match.artistCov * 100) / 100,
  };
}

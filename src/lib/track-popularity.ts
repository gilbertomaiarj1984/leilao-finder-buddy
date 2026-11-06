/**
 * Fama de faixa a partir de um ranking REAL de reproduções do artista (ListenBrainz), em vez do
 * palpite da IA (que varia a cada pergunta). Módulo puro/client-safe: normaliza títulos, soma as
 * várias gravações da mesma música e converte a posição no ranking em `alta`/`media`/`baixa`.
 */
import type { TrackFame } from "./tracklist";

type RecordingCount = { name: string; listens: number };

/** Ranking do artista: título normalizado → posição (1 = mais tocada). */
export type ArtistRanking = {
  /** Músicas distintas no ranking. */
  total: number;
  ranks: Map<string, number>;
};

/** Poucas músicas ou pouco volume = dado fraco demais; melhor deixar a IA decidir. */
const MIN_SONGS = 10;
const MIN_TOP_LISTENS = 500;
const ALTA_MAX = 40;
const MEDIA_MAX = 150;

/** Título comparável: sem acento/caixa/pontuação/parênteses e sem o " e " solto. */
export function normTitle(title: string): string {
  return (title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && w !== "e")
    .join(" ");
}

/**
 * Soma as gravações da mesma música (disco, coletânea, ao vivo) e ordena. `null` quando o dado
 * é fraco (poucas músicas ou a mais tocada tem poucas reproduções).
 */
export function buildRanking(recs: RecordingCount[]): ArtistRanking | null {
  const sums = new Map<string, number>();
  for (const r of recs) {
    const key = normTitle(r.name);
    if (!key || !(r.listens > 0)) continue;
    sums.set(key, (sums.get(key) ?? 0) + r.listens);
  }
  const sorted = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length < MIN_SONGS || sorted[0][1] < MIN_TOP_LISTENS) return null;
  return { total: sorted.length, ranks: new Map(sorted.map(([k], i) => [k, i + 1])) };
}

/** Posição → cor, proporcional ao tamanho da obra do artista (teto 40 verdes / 150 amarelas). */
export function fameFromRank(rank: number, total: number): TrackFame {
  const altaMax = Math.min(ALTA_MAX, Math.max(3, Math.ceil(total * 0.08)));
  const mediaMax = Math.min(MEDIA_MAX, Math.max(altaMax + 1, Math.ceil(total * 0.3)));
  if (rank <= altaMax) return "alta";
  if (rank <= mediaMax) return "media";
  return "baixa";
}

/** Fama por faixa (mesma ordem); `null` onde o título não está no ranking. */
export function fameFromRanking(
  tracks: { title: string }[],
  ranking: ArtistRanking,
): (TrackFame | null)[] {
  return tracks.map((t) => {
    const rank = ranking.ranks.get(normTitle(t.title));
    return rank ? fameFromRank(rank, ranking.total) : null;
  });
}

import { auctionStartMs } from "./vinyl-parse";

/** Faixas de proximidade do lote acompanhado em relação ao lote em pregão agora. */
export type FollowTone = "near" | "mid" | "far" | "none";

/** Lotes que faltam para o seu lote chegar (≤ 0 = em pregão agora ou já passou). null = sem nº legível. */
export function lotDistance(lote: string | null, currentLote: string | null): number | null {
  const n = Number.parseInt(lote ?? "", 10);
  const cur = Number.parseInt(currentLote ?? "", 10);
  if (!Number.isFinite(n) || !Number.isFinite(cur)) return null;
  return n - cur;
}

/** Vermelho (≤ 3 lotes), amarelo (≤ 15) e verde (longe). Sem distância ou já passou → "none". */
export function followTone(distance: number | null): FollowTone {
  if (distance === null) return "none";
  if (distance <= 3) return "near";
  if (distance <= 15) return "mid";
  return "far";
}

const MAX_RUN_MIN = 14 * 60;

/**
 * Minutos estimados até o lote chegar: ritmo médio do pregão (minutos desde o início ÷ peças já
 * passadas) × lotes que faltam. null enquanto não há base (menos de 5 peças feitas, início
 * ilegível, pregão ainda não começou ou rodando há mais de 14 h — multi-dia).
 */
export function etaMinutes(opts: {
  dayKey: string;
  time: string;
  peca: number | null;
  distance: number | null;
  now?: number;
}): number | null {
  const { dayKey, time, peca, distance } = opts;
  if (distance === null || distance <= 0 || peca === null || peca < 5) return null;
  const start = auctionStartMs(dayKey, time);
  if (start === null) return null;
  const elapsedMin = ((opts.now ?? Date.now()) - start) / 60000;
  if (elapsedMin <= 0 || elapsedMin > MAX_RUN_MIN) return null;
  return Math.max(1, Math.round((elapsedMin / peca) * distance));
}

type TimelinePin = { index: number; pct: number };

/**
 * Posição dos itens acompanhados na barra do pregão. O nº do lote não é a peça (o lote 364 pode
 * ser a peça 174), então a posição estimada é `peça atual + (lote do item − lote atual)`. Itens
 * de dias seguintes (multi-dia) passam do total do dia: a escala cresce para caber TODOS e
 * `endPct` marca onde o dia termina (null quando tudo cabe no total). Itens sem nº legível ficam
 * de fora. `progressPct` é o avanço do pregão nessa mesma escala.
 */
export function timelineLayout(
  lotes: string[],
  now: { lote: string; peca: number | null; total: number },
): { pins: TimelinePin[]; endPct: number | null; progressPct: number } {
  const cur = Number.parseInt(now.lote, 10);
  const offset = now.peca !== null && Number.isFinite(cur) ? cur - now.peca : 0;
  const est: { index: number; at: number }[] = [];
  lotes.forEach((lote, index) => {
    const n = Number.parseInt(lote, 10);
    if (Number.isFinite(n)) est.push({ index, at: Math.max(0, n - offset) });
  });
  const scale = Math.max(now.total, now.peca ?? 0, ...est.map((e) => e.at));
  const pct = (v: number) => Math.min(99, Math.max(1, (v / scale) * 100));
  return {
    pins: est.map((e) => ({ index: e.index, pct: pct(e.at) })),
    endPct: scale > now.total ? (now.total / scale) * 100 : null,
    progressPct: Math.min(100, ((now.peca ?? 0) / scale) * 100),
  };
}

/**
 * Separa artista e álbum para exibir em linhas distintas: tira separadores soltos do fim do
 * artista ("Gonzaguinha /" → "Gonzaguinha") e o artista repetido no começo do álbum
 * ("Gonzaguinha - Caminhos" → "Caminhos"). Só remove o prefixo quando vem seguido de
 * separador; um álbum que apenas começa com o nome do artista ("Gilberto Gil Em Concerto")
 * fica como está.
 */
export function splitArtistAlbum(
  artist: string | null | undefined,
  rawAlbum: string,
): { artist: string; album: string } {
  const cleanArtist = (artist ?? "").replace(/[\s/\-–—:|,]+$/u, "").trim();
  const album = rawAlbum.trim();
  if (!cleanArtist) return { artist: "", album };
  const head = album.slice(0, cleanArtist.length);
  const rest = album.slice(cleanArtist.length);
  if (head.toLowerCase() === cleanArtist.toLowerCase()) {
    const m = rest.match(/^\s*[-–—/:|]\s*(\S.*)$/u);
    if (m) return { artist: cleanArtist, album: m[1]! };
  }
  return { artist: cleanArtist, album };
}

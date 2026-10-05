/**
 * Tracklist do álbum devolvida pela IA junto com a avaliação do lote (`lot_ai.tracklist`).
 * Módulo puro/client-safe: tipo, normalização do JSON da IA e agrupamento por lado.
 *
 * `fame` = quão conhecida é a faixa: "alta" (verde, maiores sucessos), "media" (amarelo,
 * conhecidas) e "baixa" (vermelho, pouco conhecidas e/ou lado B).
 */
export const TRACK_FAMES = ["alta", "media", "baixa"] as const;
export type TrackFame = (typeof TRACK_FAMES)[number];

export type Track = {
  /** Lado do disco ("A", "B", ...); null quando a IA não informou. */
  side: string | null;
  title: string;
  fame: TrackFame;
};

const MAX_TRACKS = 40;

/** Normaliza o valor cru (JSON da IA ou jsonb do banco) numa lista válida; `null` se vazia. */
export function normalizeTracklist(value: unknown): Track[] | null {
  if (!Array.isArray(value)) return null;
  const out: Track[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const title = typeof o["title"] === "string" ? o["title"].replace(/\s+/g, " ").trim() : "";
    if (!title) continue;
    const sideRaw = typeof o["side"] === "string" ? o["side"].trim().toUpperCase() : "";
    const side = /^[A-Z0-9]{1,2}$/.test(sideRaw) ? sideRaw : null;
    const fameRaw = typeof o["fame"] === "string" ? o["fame"].toLowerCase().trim() : "";
    const fame = (TRACK_FAMES as readonly string[]).includes(fameRaw)
      ? (fameRaw as TrackFame)
      : "baixa";
    out.push({ side, title: title.slice(0, 120), fame });
    if (out.length >= MAX_TRACKS) break;
  }
  return out.length ? out : null;
}

/** Agrupa por lado mantendo a ordem original; faixas sem lado ficam num grupo `null`. */
export function groupTracksBySide(tracks: Track[]): { side: string | null; tracks: Track[] }[] {
  const groups: { side: string | null; tracks: Track[] }[] = [];
  for (const t of tracks) {
    const last = groups[groups.length - 1];
    if (last && last.side === t.side) last.tracks.push(t);
    else groups.push({ side: t.side, tracks: [t] });
  }
  return groups;
}

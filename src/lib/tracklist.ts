/**
 * Tracklist do álbum (`lot_ai.tracklist`): faixas e ordem vêm do **Discogs**
 * (`parseDiscogsTracklist`); a IA só classifica a fama de cada faixa (`buildFamePrompt` /
 * `applyFame`). Módulo puro/client-safe: tipo, normalização, parsing e agrupamento por lado.
 *
 * `fame` = quão conhecida é a faixa (ou `null` enquanto a IA não classificou): "alta" (verde, maiores sucessos), "media" (amarelo,
 * conhecidas) e "baixa" (vermelho, pouco conhecidas e/ou lado B).
 */
export const TRACK_FAMES = ["alta", "media", "baixa"] as const;
export type TrackFame = (typeof TRACK_FAMES)[number];

export type Track = {
  /** Lado do disco ("A", "B", ...); null quando a fonte não informou. */
  side: string | null;
  title: string;
  /** Fama pela IA; `null` = ainda não classificada (as faixas vêm do Discogs antes da IA). */
  fame: TrackFame | null;
  /** Faixa de dentro de um medley (indentada sob a faixa-mãe, que vem logo antes na lista). */
  sub?: boolean;
};

const MAX_TRACKS = 80;

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
      : null;
    out.push({
      side,
      title: title.slice(0, 120),
      fame,
      ...(o["sub"] === true ? { sub: true } : {}),
    });
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

/** Faixa sem fama — o que o Discogs informa (a fama vem da IA). */
export type RawTrack = Omit<Track, "fame">;

/**
 * Converte o `tracklist` de `GET /releases/{id}` do Discogs em faixas (ordem do disco).
 * Só entram itens `type_: "track"` (ignora `heading`); itens `index` (faixa composta, ex.: um
 * medley) são expandidos pelas `sub_tracks`. O lado sai da `position` ("A1"→"A", "B"→"B",
 * "2-C3"→"C"); posição numérica ("1", "2") ou vazia fica sem lado.
 */
export function parseDiscogsTracklist(value: unknown): RawTrack[] | null {
  if (!Array.isArray(value)) return null;
  const out: RawTrack[] = [];
  const positionOf = (o: Record<string, unknown>) =>
    typeof o["position"] === "string" ? o["position"].trim().toUpperCase() : "";
  const sideOf = (o: Record<string, unknown>): string | null => {
    const m = positionOf(o).match(/^(?:\d+\s*[-.]\s*)?([A-Z]{1,2})(?=\d|$)/);
    return m ? m[1] : null;
  };
  const titleOf = (o: Record<string, unknown>) =>
    typeof o["title"] === "string" ? o["title"].replace(/\s+/g, " ").trim().slice(0, 120) : "";
  // "A2.1"/"A2.5"/"A9a" → faixa-base "A2"/"A9" (parte de um medley); posição normal → null.
  const subBase = (position: string): string | null => {
    const m = position.match(/^((?:\d+\s*[-.]\s*)?[A-Z]{1,2}\d+)(?:\s*\.\s*\d+|[A-Z])$/);
    return m ? m[1] : null;
  };
  // Medley sem faixa-mãe com título (comum no Discogs): a mãe é sintetizada para ter sob o quê indentar.
  const MEDLEY = "Medley";
  let flatGroup: string | null = null; // faixa-base cujo grupo de partes planas está aberto
  let lastTop = ""; // posição da última faixa de nível 1 gravada

  const visit = (item: unknown, parent: { side: string | null } | null) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const type = typeof o["type_"] === "string" ? o["type_"] : "track";
    if (type === "heading") return;
    const subs = Array.isArray(o["sub_tracks"]) ? (o["sub_tracks"] as unknown[]) : [];
    if (type === "index" && subs.length) {
      // Medley: a faixa-mãe entra na lista e as partes vêm logo depois, marcadas `sub`.
      const firstSub = subs.find((x) => x && typeof x === "object") as
        Record<string, unknown> | undefined;
      const side = sideOf(o) ?? (firstSub ? sideOf(firstSub) : null);
      out.push({ side, title: titleOf(o) || MEDLEY });
      lastTop = positionOf(o);
      flatGroup = null;
      for (const sub of subs) visit(sub, { side });
      return;
    }
    const title = titleOf(o);
    if (!title) return;
    if (parent) {
      out.push({ side: sideOf(o) ?? parent.side, title, sub: true });
      return;
    }
    const base = subBase(positionOf(o));
    if (base) {
      if (flatGroup !== base && lastTop !== base) {
        out.push({ side: sideOf(o), title: MEDLEY });
      }
      flatGroup = base;
      out.push({ side: sideOf(o), title, sub: true });
      return;
    }
    flatGroup = null;
    lastTop = positionOf(o);
    out.push({ side: sideOf(o), title });
  };
  for (const item of value) {
    visit(item, null);
    if (out.length >= MAX_TRACKS) break;
  }
  return out.length ? out.slice(0, MAX_TRACKS) : null;
}

/** Prompt (só texto) que pede a fama de cada faixa JÁ conhecida do álbum. */
export function buildFamePrompt(album: string, tracks: RawTrack[]): string {
  return (
    `Álbum de vinil: ${JSON.stringify(album)}.\n` +
    `Faixas (na ordem do disco): ${JSON.stringify(tracks.map((t) => t.title))}.\n` +
    'Devolva um objeto JSON {"fame":[...]} com EXATAMENTE uma entrada por faixa, na mesma ' +
    'ordem, cada uma "alta" (maiores sucessos do álbum), "media" (conhecidas) ou "baixa" ' +
    "(pouco conhecidas e/ou de lado B). Não adicione, remova nem renomeie faixas. Se não " +
    'conhecer o álbum, use "baixa" em todas. Responda só com o JSON.'
  );
}

/** Lê o texto da IA e devolve a fama por posição (`null` onde faltou/veio inválido). */
export function parseFameText(text: string, count: number): (TrackFame | null)[] {
  const none = Array.from({ length: count }, () => null);
  if (!text) return none;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return none;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const arr = obj["fame"];
    if (!Array.isArray(arr)) return none;
    return none.map((_, i) => {
      const raw = typeof arr[i] === "string" ? arr[i].toLowerCase().trim() : "";
      return (TRACK_FAMES as readonly string[]).includes(raw) ? (raw as TrackFame) : null;
    });
  } catch {
    return none;
  }
}

/** Faixas do Discogs sem fama ainda (a IA classifica depois, em passo próprio). */
export function withoutFame(tracks: RawTrack[]): Track[] {
  return tracks.map((t) => ({ ...t, fame: null }));
}

/** A lista tem faixa sem fama (precisa passar pela IA)? */
export function needsFame(tracks: Track[] | null): boolean {
  return Boolean(tracks?.length && tracks.some((t) => t.fame === null));
}

/** Aplica a fama da IA (por posição) numa tracklist já existente; sem fama válida mantém `null`. */
export function applyFame(tracks: Track[], fames: (TrackFame | null)[]): Track[] {
  return tracks.map((t, i) => ({ ...t, fame: fames[i] ?? t.fame }));
}

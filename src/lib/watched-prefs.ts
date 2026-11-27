/**
 * Preferências da aba Vigiados que valem para TODOS os aparelhos (guardadas em `app_state`):
 * lotes acompanhados (★) e casas ocultas no dia. Cada mudança é uma operação pequena aplicada no
 * servidor dentro de uma transação (duas escritas simultâneas, celular e desktop, não se
 * sobrescrevem); `applyPrefsOp` é a mesma regra usada na atualização otimista do cliente.
 * Módulo client-safe: o servidor NÃO importa daqui (tem o próprio normalizador).
 */
export type WatchedPrefs = {
  /** id do lote → quando foi marcado (ISO). */
  followed: Record<string, string>;
  /** casa → dia (YYYY-MM-DD) em que foi ocultada. */
  hidden: Record<string, string>;
};

export type WatchedPrefsOp =
  | { t: "follow"; id: string; at: string }
  | { t: "unfollow"; id: string }
  | { t: "hide"; house: string; day: string }
  | { t: "show"; house: string }
  | { t: "showAll" }
  /** Envio único do que já estava só neste aparelho (migração): une, nunca apaga. */
  | { t: "merge"; followed: string[]; hidden: Record<string, string>; at: string };

export const EMPTY_PREFS: WatchedPrefs = { followed: {}, hidden: {} };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function applyPrefsOp(cur: WatchedPrefs, op: WatchedPrefsOp): WatchedPrefs {
  const followed = { ...cur.followed };
  const hidden = { ...cur.hidden };
  switch (op.t) {
    case "follow":
      followed[op.id] = op.at;
      break;
    case "unfollow":
      delete followed[op.id];
      break;
    case "hide":
      hidden[op.house] = op.day;
      break;
    case "show":
      delete hidden[op.house];
      break;
    case "showAll":
      return { followed, hidden: {} };
    case "merge":
      for (const id of op.followed) if (!(id in followed)) followed[id] = op.at;
      for (const [house, day] of Object.entries(op.hidden)) {
        if (DAY_RE.test(day) && (hidden[house] ?? "") < day) hidden[house] = day;
      }
      break;
  }
  return { followed, hidden };
}

/** Valida uma operação vinda do cliente (null = inválida). */
export function parsePrefsOp(raw: unknown): WatchedPrefsOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 300;
  switch (o["t"]) {
    case "follow":
      return str(o["id"]) && str(o["at"]) ? { t: "follow", id: o["id"], at: o["at"] } : null;
    case "unfollow":
      return str(o["id"]) ? { t: "unfollow", id: o["id"] } : null;
    case "hide":
      return str(o["house"]) && typeof o["day"] === "string" && DAY_RE.test(o["day"])
        ? { t: "hide", house: o["house"], day: o["day"] }
        : null;
    case "show":
      return str(o["house"]) ? { t: "show", house: o["house"] } : null;
    case "showAll":
      return { t: "showAll" };
    case "merge": {
      if (!Array.isArray(o["followed"]) || !str(o["at"])) return null;
      const hiddenRaw =
        o["hidden"] && typeof o["hidden"] === "object" && !Array.isArray(o["hidden"])
          ? (o["hidden"] as Record<string, unknown>)
          : {};
      const hidden: Record<string, string> = {};
      for (const [h, d] of Object.entries(hiddenRaw))
        if (str(h) && typeof d === "string" && DAY_RE.test(d)) hidden[h] = d;
      return {
        t: "merge",
        followed: (o["followed"] as unknown[]).filter(str).slice(0, 2000),
        hidden,
        at: o["at"],
      };
    }
    default:
      return null;
  }
}

/**
 * Alerta "o pregão de um lote que você vigia está para começar" (puro). Agrupa os vigiados por
 * pregão (`idLeilao` + dia) e escolhe os que começam dentro da janela e ainda têm lote vigiado sem
 * aviso. O envio e o armazenamento em `app_state` ficam em `watch-alerts.server.ts`.
 *
 * Dedupe em duas etapas (`reserveNotified` antes do envio, `confirmNotified` depois): uma execução
 * cancelada no meio do envio não reavisa, e uma queda antes de confirmar libera o aviso de novo
 * depois de `SENDING_TTL_MS`. O aviso é por LOTE vigiado: vigiar outro lote do mesmo pregão depois
 * do aviso gera um novo aviso só para ele (enquanto o pregão ainda estiver na janela).
 */
import { startsInMinutes } from "./analise-time";
import { brDateToDayKey } from "./vinyl-parse";

export type WatchedForAlert = {
  /** Id do lote (`idLeilao-idPeca`); sem ele, `idLeilao|lote` identifica o lote. */
  id?: string;
  idLeilao: string;
  house: string;
  /** "dd/mm/yyyy" (formato da conta). */
  date: string;
  time: string;
  lote: string;
};

type StartingAuction = {
  /** Chave de dedupe: `idLeilao|dayKey`. */
  key: string;
  house: string;
  startsIn: number;
  /** Números dos lotes AINDA NÃO avisados, em ordem. */
  lotes: string[];
  /** Identificadores desses lotes (para o registro de avisados). */
  lotIds: string[];
};

/** Quantos minutos antes do início avisamos, e quanto atraso do agendador toleramos depois dele. */
const ALERT_WINDOW_MIN = 30;
const ALERT_LATE_TOLERANCE_MIN = 10;
/** Um envio "em andamento" vale como avisado por este tempo; depois disso o pregão volta a ser candidato. */
const SENDING_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;

export type NotifiedEntry = {
  /** Quando foi reservado/confirmado (ms). */
  at: number;
  state: "sending" | "sent";
  /** Lotes (ids) já cobertos por este aviso. */
  lotIds: string[];
  /** Formato antigo (só a chave do pregão): todos os lotes contam como avisados. */
  all?: true;
};
export type NotifiedMap = Record<string, NotifiedEntry>;

/** Lê o valor de `app_state`: o formato novo (objeto) e o antigo (lista de chaves de pregão). */
export function normalizeNotified(value: unknown): NotifiedMap {
  const out: NotifiedMap = {};
  if (Array.isArray(value)) {
    for (const k of value)
      if (typeof k === "string") out[k] = { at: 0, state: "sent", lotIds: [], all: true };
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
    const e = raw as Partial<NotifiedEntry> | null;
    if (!e || typeof e.at !== "number" || (e.state !== "sending" && e.state !== "sent")) continue;
    out[k] = {
      at: e.at,
      state: e.state,
      lotIds: Array.isArray(e.lotIds)
        ? e.lotIds.filter((x): x is string => typeof x === "string")
        : [],
      ...(e.all ? { all: true as const } : {}),
    };
  }
  return out;
}

/** O aviso desta entrada ainda vale (enviado, ou em andamento há pouco)? */
function covers(e: NotifiedEntry | undefined, nowMs: number): boolean {
  if (!e) return false;
  return e.state === "sent" || nowMs - e.at < SENDING_TTL_MS;
}

/** Pregões com vigiados que começam em até `ALERT_WINDOW_MIN` min (ou começaram há pouco) e têm lote sem aviso. */
export function pickStartingAuctions(
  watched: readonly WatchedForAlert[],
  nowMs: number,
  notified: NotifiedMap,
): StartingAuction[] {
  const byKey = new Map<string, StartingAuction>();
  for (const w of watched) {
    const dayKey = brDateToDayKey(w.date);
    if (!dayKey || !w.idLeilao) continue;
    const startsIn = startsInMinutes(dayKey, w.time, nowMs);
    if (startsIn === null || startsIn > ALERT_WINDOW_MIN || startsIn < -ALERT_LATE_TOLERANCE_MIN)
      continue;
    const key = `${w.idLeilao}|${dayKey}`;
    const entry = notified[key];
    const lotId = w.id ?? `${w.idLeilao}|${w.lote}`;
    if (covers(entry, nowMs) && (entry!.all || entry!.lotIds.includes(lotId))) continue;
    const item = byKey.get(key) ?? { key, house: w.house, startsIn, lotes: [], lotIds: [] };
    if (w.lote) item.lotes.push(w.lote);
    item.lotIds.push(lotId);
    byKey.set(key, item);
  }
  const num = (v: string) => Number.parseInt(v, 10) || 0;
  return [...byKey.values()]
    .map((a) => ({ ...a, lotes: [...a.lotes].sort((x, y) => num(x) - num(y)) }))
    .sort((a, b) => a.startsIn - b.startsIn);
}

/** Marca os pregões como "enviando" ANTES do push (um cancelamento no meio não reavisa). */
export function reserveNotified(
  map: NotifiedMap,
  auctions: readonly StartingAuction[],
  nowMs: number,
): NotifiedMap {
  const next: NotifiedMap = { ...map };
  for (const a of auctions) {
    const prev = next[a.key];
    const kept = prev && covers(prev, nowMs) && !prev.all ? prev.lotIds : [];
    next[a.key] = {
      at: nowMs,
      state: "sending",
      lotIds: [...new Set([...kept, ...a.lotIds])],
      ...(prev?.all ? { all: true as const } : {}),
    };
  }
  return pruneNotified(next);
}

/** Confirma como enviados os pregões reservados. */
export function confirmNotified(
  map: NotifiedMap,
  keys: readonly string[],
  nowMs: number,
): NotifiedMap {
  const next: NotifiedMap = { ...map };
  for (const k of keys) {
    const e = next[k];
    if (e) next[k] = { ...e, at: nowMs, state: "sent" };
  }
  return next;
}

/** Guarda só as entradas mais recentes. */
function pruneNotified(map: NotifiedMap): NotifiedMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES));
}

/** Texto do aviso (um por rodada, com todos os pregões). */
export function startingAlertText(auctions: readonly Omit<StartingAuction, "lotIds">[]): {
  title: string;
  body: string;
} {
  const line = (a: Omit<StartingAuction, "lotIds">) => {
    const when = a.startsIn > 0 ? `em ${a.startsIn} min` : "agora";
    const lotes = a.lotes.length
      ? ` — lote(s) ${a.lotes.slice(0, 6).join(", ")}${a.lotes.length > 6 ? "…" : ""}`
      : "";
    return `${a.house} começa ${when}${lotes}`;
  };
  return {
    title:
      auctions.length === 1
        ? "Pregão de lote vigiado começando"
        : `${auctions.length} pregões com lotes vigiados`,
    body: auctions.map(line).join("\n"),
  };
}

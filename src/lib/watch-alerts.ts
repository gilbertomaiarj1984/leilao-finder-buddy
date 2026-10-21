/**
 * Alerta "o pregão de um lote que você vigia está para começar" (puro). Agrupa os vigiados por
 * pregão (`idLeilao` + dia) e escolhe os que começam dentro da janela e ainda não foram avisados.
 * O envio e o dedupe em `app_state` ficam em `watch-alerts.server.ts`.
 */
import { startsInMinutes } from "./analise-time";
import { brDateToDayKey } from "./vinyl-parse";

export type WatchedForAlert = {
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
  lotes: string[];
};

/** Quantos minutos antes do início avisamos, e quanto atraso do agendador toleramos depois dele. */
const ALERT_WINDOW_MIN = 30;
const ALERT_LATE_TOLERANCE_MIN = 10;

/** Pregões com vigiados que começam em até `ALERT_WINDOW_MIN` min (ou começaram há pouco) e não foram avisados. */
export function pickStartingAuctions(
  watched: readonly WatchedForAlert[],
  nowMs: number,
  alreadyNotified: ReadonlySet<string>,
): StartingAuction[] {
  const byKey = new Map<string, StartingAuction>();
  for (const w of watched) {
    const dayKey = brDateToDayKey(w.date);
    if (!dayKey || !w.idLeilao) continue;
    const startsIn = startsInMinutes(dayKey, w.time, nowMs);
    if (startsIn === null || startsIn > ALERT_WINDOW_MIN || startsIn < -ALERT_LATE_TOLERANCE_MIN)
      continue;
    const key = `${w.idLeilao}|${dayKey}`;
    if (alreadyNotified.has(key)) continue;
    const entry = byKey.get(key) ?? { key, house: w.house, startsIn, lotes: [] };
    if (w.lote) entry.lotes.push(w.lote);
    byKey.set(key, entry);
  }
  const num = (v: string) => Number.parseInt(v, 10) || 0;
  return [...byKey.values()]
    .map((a) => ({ ...a, lotes: [...a.lotes].sort((x, y) => num(x) - num(y)) }))
    .sort((a, b) => a.startsIn - b.startsIn);
}

/** Texto do aviso (um por rodada, com todos os pregões). */
export function startingAlertText(auctions: readonly StartingAuction[]): {
  title: string;
  body: string;
} {
  const line = (a: StartingAuction) => {
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

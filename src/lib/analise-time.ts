/**
 * Tempo do pregão de um lote na Análise (puro): "em 50 min" para quem ainda não começou e
 * "ao vivo · faltam 47 lotes" para quem está rolando. O início vem do horário da casa (dia +
 * hora, fuso de São Paulo); o andamento, do polling do presencial (`getPresencialNow`), que só
 * existe para casas da plataforma. `time` é o início do PREGÃO da casa, não do lote.
 */
import { auctionStartMs, bidIsSold, isLotePassed } from "./vinyl-parse";

/** Minutos até o início (negativo = já começou); `null` sem horário legível. */
export function startsInMinutes(dayKey: string, time: string, nowMs: number): number | null {
  const start = auctionStartMs(dayKey, time);
  return start === null ? null : Math.round((start - nowMs) / 60_000);
}

function formatMinutes(min: number): string {
  if (min < 60) return `${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Andamento do pregão da casa (do presencial), já reduzido ao que o chip precisa. */
export type AuctionProgress = {
  status: "live" | "ended";
  /** Lote em pregão agora. */
  currentLote: string | null;
  total: number | null;
  peca: number | null;
};

export type AuctionChip = {
  label: string;
  tone: "info" | "warn" | "live" | "muted";
  title: string;
};

/** Mais de um dia de antecedência não vira chip: o dia/hora já está na linha. */
const CHIP_HORIZON_MIN = 24 * 60;
/** Começou há mais que isso e sem sinal do presencial: não afirmamos "ao vivo". */
const MAX_LIVE_AGE_MIN = 6 * 60;

export function auctionChip(input: {
  dayKey: string;
  time: string;
  lote: string;
  nowMs: number;
  progress: AuctionProgress | null;
}): AuctionChip | null {
  const startsIn = startsInMinutes(input.dayKey, input.time, input.nowMs);
  if (startsIn === null) return null;
  if (startsIn > 0) {
    if (startsIn > CHIP_HORIZON_MIN) return null;
    return {
      label: `começa em ${formatMinutes(startsIn)}`,
      tone: startsIn <= 30 ? "warn" : "info",
      title: `Pregão da casa às ${input.time}`,
    };
  }
  const p = input.progress;
  if (p?.status === "ended") {
    return { label: "pregão encerrado", tone: "muted", title: "Os lotes da casa já passaram" };
  }
  if (!p) {
    // Sem andamento (casa sem presencial ou ainda carregando): só dizemos "ao vivo" dentro de uma janela plausível.
    return -startsIn <= MAX_LIVE_AGE_MIN
      ? { label: "ao vivo", tone: "live", title: "O horário do pregão já passou" }
      : null;
  }
  const cur = p.currentLote;
  if (!cur) return { label: "ao vivo", tone: "live", title: "Pregão em andamento" };
  const n = Number.parseInt(input.lote, 10);
  const curN = Number.parseInt(cur, 10);
  const of = p.total ? `/${p.total}` : "";
  if (input.lote && isLotePassed(input.lote, cur)) {
    return {
      label: `ao vivo · lote ${cur}${of} · já passou`,
      tone: "muted",
      title: "O pregão já passou deste lote",
    };
  }
  if (input.lote && Number.isFinite(n) && Number.isFinite(curN) && n > curN) {
    const left = n - curN;
    return {
      label: `ao vivo · lote ${cur}${of} · faltam ${left}`,
      tone: left <= 5 ? "warn" : "live",
      title: `O pregão está no lote ${cur}; este é o ${input.lote}`,
    };
  }
  return {
    label: `ao vivo · em pregão agora (lote ${cur}${of})`,
    tone: "warn",
    title: "Este lote está no pregão",
  };
}

/**
 * O lote JÁ ACABOU para quem decide lance? Então não faz sentido na Análise, nem vigiado:
 * dia do pregão anterior a hoje; meu lance com resultado final ("Vendido", "Vencedor",
 * "Arrematado", "Não vendido"); pregão da casa terminado; ou pregão em andamento que já passou
 * deste lote (o lote do pregão é maior que o seu). Sem andamento conhecido, só vale o que o dia e
 * o status do lance dizem.
 */
export function lotIsClosed(input: {
  dayKey: string;
  todayKey: string;
  lote: string;
  bidStatus: string | null;
  progress: AuctionProgress | null;
}): boolean {
  if (input.dayKey && input.todayKey && input.dayKey < input.todayKey) return true;
  const bid = input.bidStatus ?? "";
  if (bid && (bidIsSold(bid) || /n[ãa]o\s+vendid/i.test(bid))) return true;
  const p = input.progress;
  if (!p) return false;
  if (p.status === "ended") return true;
  return Boolean(p.currentLote && input.lote && isLotePassed(input.lote, p.currentLote));
}

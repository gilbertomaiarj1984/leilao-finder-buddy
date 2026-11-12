/**
 * Agendamento de lance único (puro, sem I/O): "quando o pregão chegar no lote X, dar UM lance no
 * lote Y, se o valor atual do Y for Z e o próximo lance couber no teto W".
 * O servidor (`bid-schedule.server.ts`) acompanha o pregão e aplica estas regras.
 */

export type BidScheduleStatus =
  | "waiting" // aguardando o gatilho
  | "firing" // reservado: o lance está sendo enviado (nunca volta a "waiting")
  | "fired" // lance enviado e aceito pelo site
  | "simulated" // modo simulação: registrou o que faria, sem enviar
  | "skipped" // gatilho chegou, mas a regra de valor não permitiu o lance
  | "failed" // envio recusado ou resposta incerta: conferir no site
  | "expired" // o pregão passou do lote alvo antes do disparo
  | "cancelled";

export type BidSchedule = {
  id: string;
  idLeilao: string;
  house: string;
  /** URL do pregão (`/presencial/presencial.asp?Num=…`). */
  presencialUrl: string;
  /** Dia do leilão (yyyy-mm-dd), para agrupar a lista; "" quando desconhecido. */
  dayKey: string;
  /** Lote que, ao entrar em pregão, dispara o lance. */
  triggerLote: number;
  /** Lote que recebe o lance. */
  targetLote: number;
  /** Valor atual exigido no lote alvo (Z), em reais. `null` = não exigir. */
  expectedValue: number | null;
  /** Teto (W): o próximo lance não pode passar disso, em reais. */
  maxValue: number;
  status: BidScheduleStatus;
  createdAt: string;
  updatedAt: string;
  /** Explicação do último passo (motivo do "não disparou", valor enviado…). */
  message: string;
  /** Guardado pelo botão "Limpar" (sai da lista principal e vai para as sacolas). */
  archived: boolean;
};

export type BidScheduleInput = {
  idLeilao: string;
  house: string;
  presencialUrl: string;
  dayKey: string;
  triggerLote: number;
  targetLote: number;
  expectedValue: number | null;
  maxValue: number;
};

/** Só edita/cancela enquanto nada foi reservado ou enviado. */
export const isEditable = (s: Pick<BidSchedule, "status">) => s.status === "waiting";

/** Status que o botão "Limpar" tira da lista: expirado, não disparou e falha. */
export const ARCHIVABLE_STATUSES = ["expired", "skipped", "failed"] as const;
export type ArchivableStatus = (typeof ARCHIVABLE_STATUSES)[number];

export const isArchivable = (s: Pick<BidSchedule, "status" | "archived">): boolean =>
  !s.archived && (ARCHIVABLE_STATUSES as readonly string[]).includes(s.status);

/** Marca como guardados os agendamentos encerrados sem lance (devolve a lista nova e quantos). */
export function archiveFinished(list: BidSchedule[]): { list: BidSchedule[]; count: number } {
  let count = 0;
  const out = list.map((s) => {
    if (!isArchivable(s)) return s;
    count++;
    return { ...s, archived: true };
  });
  return { list: out, count };
}

const STATUSES: readonly BidScheduleStatus[] = [
  "waiting",
  "firing",
  "fired",
  "simulated",
  "skipped",
  "failed",
  "expired",
  "cancelled",
];

/** Número do lote ("118", "118A") → 118. `null` se não começar com dígitos. */
export function parseLoteNumber(raw: unknown): number | null {
  const m = /^\s*0*(\d{1,6})/.exec(String(raw ?? ""));
  return m ? Number(m[1]) : null;
}

/** "R$ 1.050,00" / "105,5" / "105.5" / 105 → número em reais; `null` se inválido. */
export function parseBrl(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const v = String(raw ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(v)) return null;
  const lastDot = v.lastIndexOf(".");
  const lastComma = v.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thousands = dec === "." ? "," : ".";
    normalized = v.split(thousands).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    normalized = v.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(v)) {
    normalized = v.split(".").join("");
  } else {
    normalized = v;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Valida o formulário; devolve o erro em português ou a entrada normalizada. */
export function validateScheduleInput(
  raw: Partial<Record<keyof BidScheduleInput, unknown>>,
): { ok: true; value: BidScheduleInput } | { ok: false; error: string } {
  const idLeilao = String(raw.idLeilao ?? "").trim();
  const presencialUrl = String(raw.presencialUrl ?? "").trim();
  if (!idLeilao || !presencialUrl) return { ok: false, error: "Escolha o leilão." };
  const triggerLote = parseLoteNumber(raw.triggerLote);
  const targetLote = parseLoteNumber(raw.targetLote);
  if (triggerLote === null || targetLote === null) {
    return { ok: false, error: "Informe o número do lote gatilho e do lote alvo." };
  }
  if (triggerLote > targetLote) {
    return { ok: false, error: "O lote gatilho não pode ser maior que o lote alvo." };
  }
  const maxValue = parseBrl(raw.maxValue);
  if (maxValue === null || maxValue <= 0) {
    return { ok: false, error: "O teto (valor limite) é obrigatório e deve ser maior que zero." };
  }
  const rawExpected = raw.expectedValue;
  const hasExpected = rawExpected !== null && rawExpected !== undefined && rawExpected !== "";
  const expectedValue = hasExpected ? parseBrl(rawExpected) : null;
  if (hasExpected && (expectedValue === null || expectedValue < 0)) {
    return { ok: false, error: "Valor atual esperado inválido." };
  }
  return {
    ok: true,
    value: {
      idLeilao,
      house: String(raw.house ?? "").trim(),
      presencialUrl,
      dayKey: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dayKey ?? "")) ? String(raw.dayKey) : "",
      triggerLote,
      targetLote,
      expectedValue,
      maxValue,
    },
  };
}

/** Lê o JSON de `app_state` descartando itens malformados. */
export function parseSchedules(raw: unknown): BidSchedule[] {
  if (!Array.isArray(raw)) return [];
  const out: BidSchedule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o["id"] !== "string" ||
      typeof o["idLeilao"] !== "string" ||
      typeof o["presencialUrl"] !== "string" ||
      typeof o["triggerLote"] !== "number" ||
      typeof o["targetLote"] !== "number" ||
      typeof o["maxValue"] !== "number" ||
      !STATUSES.includes(o["status"] as BidScheduleStatus)
    ) {
      continue;
    }
    out.push({
      id: o["id"],
      idLeilao: o["idLeilao"],
      house: typeof o["house"] === "string" ? o["house"] : "",
      presencialUrl: o["presencialUrl"],
      dayKey: typeof o["dayKey"] === "string" ? o["dayKey"] : "",
      triggerLote: o["triggerLote"],
      targetLote: o["targetLote"],
      expectedValue: typeof o["expectedValue"] === "number" ? o["expectedValue"] : null,
      maxValue: o["maxValue"],
      status: o["status"] as BidScheduleStatus,
      createdAt: typeof o["createdAt"] === "string" ? o["createdAt"] : "",
      updatedAt: typeof o["updatedAt"] === "string" ? o["updatedAt"] : "",
      message: typeof o["message"] === "string" ? o["message"] : "",
      archived: o["archived"] === true,
    });
  }
  return out;
}

type TriggerDecision = "wait" | "fire" | "expire";

/**
 * Compara o lote em pregão com o agendamento. `fire` quando o pregão já chegou ao gatilho e
 * ainda não passou do alvo (assim, se o pregão pular o lote gatilho, o disparo não se perde);
 * `expire` quando já passou do alvo.
 */
export function decideTrigger(
  s: Pick<BidSchedule, "triggerLote" | "targetLote">,
  currentLote: number | null,
): TriggerDecision {
  if (currentLote === null) return "wait";
  if (currentLote > s.targetLote) return "expire";
  return currentLote >= s.triggerLote ? "fire" : "wait";
}

type BidDecision = { action: "bid"; value: number } | { action: "skip"; reason: string };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Regra de valor no momento do disparo: o lance é SEMPRE o próximo valor do lote (nunca outro),
 * só se o valor atual for o esperado (Z, quando informado) e o próximo lance couber no teto (W).
 */
export function decideBid(
  s: Pick<BidSchedule, "expectedValue" | "maxValue">,
  live: { currentValue: number | null; nextBid: number | null },
): BidDecision {
  if (live.nextBid === null || live.nextBid <= 0) {
    return { action: "skip", reason: "Não consegui ler o próximo lance do lote." };
  }
  if (s.expectedValue !== null) {
    if (live.currentValue === null) {
      return { action: "skip", reason: "Não consegui ler o valor atual do lote." };
    }
    if (Math.abs(live.currentValue - s.expectedValue) > 0.005) {
      return {
        action: "skip",
        reason: `Valor atual é ${brl(live.currentValue)}, diferente do esperado (${brl(s.expectedValue)}).`,
      };
    }
  }
  if (live.nextBid > s.maxValue + 0.005) {
    return {
      action: "skip",
      reason: `Próximo lance ${brl(live.nextBid)} passa do teto ${brl(s.maxValue)}.`,
    };
  }
  return { action: "bid", value: live.nextBid };
}

/** Valor como o site espera no envio (ponto decimal, sem milhar): 105 → "105", 105.5 → "105.50". */
export function formatBidValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

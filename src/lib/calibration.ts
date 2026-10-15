/**
 * Calibração da IA com as compras RECEBIDAS (v0.150.0). Módulo PURO (client-safe, testável): tipos
 * do que fica gravado na compra (`purchase_calibration`) e as contas que respondem «a IA e o leitor
 * de estado acertam?» — o disco chegou e o usuário diz como ele realmente é.
 *
 * Três comparações:
 *  - **Estado:** o que o leitor de texto leu (com as regras atuais do painel) × o estado real que o
 *    usuário informa (ou que já está na Coleção). Mostra se o app é otimista/pessimista e em que
 *    graus erra (matriz «lido → real»).
 *  - **Nota:** a nota que a IA deu na época da compra (snapshot) × a nota que o usuário daria.
 *  - **Veredicto:** barato/justo/caro (mercado, senão IA) × «valeu a pena?».
 */
import { GRADE_ORDER, normalizeGrade, type Grade } from "./grading";

export const VERDICTS = ["valeu", "ok", "nao_valeu"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
  valeu: "Valeu a pena",
  ok: "Foi ok",
  nao_valeu: "Não valeu",
};

/** O que a IA e o mercado diziam do lote NA ÉPOCA DA COMPRA (o lote sai do banco 10 dias depois). */
export type CalibrationSnapshot = {
  takenAt: string;
  /** Valor do lote no momento (texto BR). */
  price: string;
  ai: {
    score: number | null;
    rarity: string | null;
    deal: string | null;
    album: string | null;
    reason: string | null;
    evalPrice: number | null;
  } | null;
  cond: {
    media: string;
    sleeve: string;
    insert: string;
    score: number | null;
    source: string;
  } | null;
  market: {
    verdict: "barato" | "justo" | "caro" | "indefinido";
    anchorCondition: string | null;
    anchorPrice: number | null;
    freight: number | null;
  } | null;
  pastSales: { count: number; median: number } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Valida o jsonb vindo do banco; qualquer lixo vira `null`. */
export function normalizeSnapshot(raw: unknown): CalibrationSnapshot | null {
  if (!isObj(raw) || !str(raw["takenAt"])) return null;
  const ai = isObj(raw["ai"])
    ? {
        score: num(raw["ai"]["score"]),
        rarity: strOrNull(raw["ai"]["rarity"]),
        deal: strOrNull(raw["ai"]["deal"]),
        album: strOrNull(raw["ai"]["album"]),
        reason: strOrNull(raw["ai"]["reason"]),
        evalPrice: num(raw["ai"]["evalPrice"]),
      }
    : null;
  const cond = isObj(raw["cond"])
    ? {
        media: str(raw["cond"]["media"]),
        sleeve: str(raw["cond"]["sleeve"]),
        insert: str(raw["cond"]["insert"]),
        score: num(raw["cond"]["score"]),
        source: str(raw["cond"]["source"]),
      }
    : null;
  const verdicts = ["barato", "justo", "caro", "indefinido"] as const;
  const market = isObj(raw["market"])
    ? {
        verdict: (verdicts as readonly unknown[]).includes(raw["market"]["verdict"])
          ? (raw["market"]["verdict"] as (typeof verdicts)[number])
          : ("indefinido" as const),
        anchorCondition: strOrNull(raw["market"]["anchorCondition"]),
        anchorPrice: num(raw["market"]["anchorPrice"]),
        freight: num(raw["market"]["freight"]),
      }
    : null;
  const ps = isObj(raw["pastSales"])
    ? { count: num(raw["pastSales"]["count"]) ?? 0, median: num(raw["pastSales"]["median"]) ?? 0 }
    : null;
  return {
    takenAt: str(raw["takenAt"]),
    price: str(raw["price"]),
    ai,
    cond,
    market,
    pastSales: ps && ps.count > 0 ? ps : null,
  };
}

/** Uma compra recebida, com o que a calibração precisa. */
export type CalibrationRow = {
  lotId: string;
  idLeilao: string;
  title: string;
  /** «Artista — Álbum» da Coleção quando existe; senão o título do lote. */
  label: string;
  image: string | null;
  house: string;
  wonPrice: string;
  wonDate: string | null;
  receivedAt: string | null;
  snapshot: CalibrationSnapshot | null;
  /** O que o leitor de texto lê AGORA do descritivo da venda (regras atuais do painel). */
  read: { media: string; sleeve: string };
  /** Estado real informado pelo usuário (ou o da Coleção quando ele não preencheu aqui). */
  real: { media: string; sleeve: string };
  realScore: number | null;
  verdict: Verdict | "";
  note: string;
};

const gradeIndex = (g: string | null | undefined): number | null => {
  const n = normalizeGrade(g ?? "");
  return n ? GRADE_ORDER.indexOf(n) : null;
};

/** Passos de diferença entre o estado real e o lido: positivo = o real é PIOR (a leitura foi otimista). */
export function optimismSteps(read: string, real: string): number | null {
  const r = gradeIndex(read);
  const t = gradeIndex(real);
  return r === null || t === null ? null : t - r;
}

export type ConditionStats = {
  /** Compras com leitura E estado real. */
  n: number;
  exact: number;
  withinOne: number;
  /** Média de passos (real − lido): > 0 = o app lê melhor do que o disco é. */
  optimism: number;
  /** Para cada grau lido, como os discos chegaram. */
  matrix: { read: Grade; n: number; real: { grade: Grade; n: number }[] }[];
};

export function conditionStats(
  rows: readonly CalibrationRow[],
  side: "media" | "sleeve",
): ConditionStats {
  let n = 0;
  let exact = 0;
  let within = 0;
  let sum = 0;
  const by = new Map<Grade, Map<Grade, number>>();
  for (const r of rows) {
    const steps = optimismSteps(r.read[side], r.real[side]);
    if (steps === null) continue;
    n += 1;
    sum += steps;
    if (steps === 0) exact += 1;
    if (Math.abs(steps) <= 1) within += 1;
    const read = normalizeGrade(r.read[side])!;
    const real = normalizeGrade(r.real[side])!;
    const inner = by.get(read) ?? new Map<Grade, number>();
    inner.set(real, (inner.get(real) ?? 0) + 1);
    by.set(read, inner);
  }
  const matrix = GRADE_ORDER.filter((g) => by.has(g)).map((g) => {
    const inner = by.get(g)!;
    return {
      read: g,
      n: [...inner.values()].reduce((a, b) => a + b, 0),
      real: GRADE_ORDER.filter((x) => inner.has(x)).map((x) => ({ grade: x, n: inner.get(x)! })),
    };
  });
  return {
    n,
    exact,
    withinOne: within,
    optimism: n ? Math.round((sum / n) * 100) / 100 : 0,
    matrix,
  };
}

type ScoreStats = {
  n: number;
  /** Erro absoluto médio (pontos). */
  mae: number;
  /** Média de (nota da IA − nota do usuário): > 0 = a IA é mais generosa. */
  bias: number;
};

export function scoreStats(rows: readonly CalibrationRow[]): ScoreStats {
  const pairs = rows
    .map((r) => [r.snapshot?.ai?.score ?? null, r.realScore] as const)
    .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  if (!pairs.length) return { n: 0, mae: 0, bias: 0 };
  const mae = pairs.reduce((a, [ai, me]) => a + Math.abs(ai - me), 0) / pairs.length;
  const bias = pairs.reduce((a, [ai, me]) => a + (ai - me), 0) / pairs.length;
  return { n: pairs.length, mae: Math.round(mae * 10) / 10, bias: Math.round(bias * 10) / 10 };
}

/** O veredicto «na época»: mercado quando definido, senão o da IA. */
export function dealAtPurchase(s: CalibrationSnapshot | null): "barato" | "justo" | "caro" | null {
  const m = s?.market?.verdict;
  if (m && m !== "indefinido") return m;
  const d = s?.ai?.deal;
  return d === "barato" || d === "justo" || d === "caro" ? d : null;
}

const EXPECTED: Record<"barato" | "justo" | "caro", Verdict[]> = {
  barato: ["valeu"],
  justo: ["ok", "valeu"],
  caro: ["nao_valeu", "ok"],
};

type DealStats = {
  n: number;
  /** O veredicto bateu com o «valeu a pena?» (barato→valeu, justo→ok/valeu, caro→não valeu/ok). */
  hits: number;
  table: { deal: "barato" | "justo" | "caro"; n: number; byVerdict: Record<Verdict, number> }[];
};

export function dealStats(rows: readonly CalibrationRow[]): DealStats {
  const table = (["barato", "justo", "caro"] as const).map((deal) => ({
    deal,
    n: 0,
    byVerdict: { valeu: 0, ok: 0, nao_valeu: 0 } as Record<Verdict, number>,
  }));
  let n = 0;
  let hits = 0;
  for (const r of rows) {
    const deal = dealAtPurchase(r.snapshot);
    if (!deal || !r.verdict) continue;
    const line = table.find((t) => t.deal === deal)!;
    line.n += 1;
    line.byVerdict[r.verdict] += 1;
    n += 1;
    if (EXPECTED[deal].includes(r.verdict)) hits += 1;
  }
  return { n, hits, table };
}

/** Frases curtas que apontam o que ajustar (só com amostra mínima). */
export function calibrationHints(media: ConditionStats): string[] {
  const out: string[] = [];
  for (const line of media.matrix) {
    if (line.n < 3) continue;
    const readIdx = GRADE_ORDER.indexOf(line.read);
    const worse = line.real
      .filter((r) => GRADE_ORDER.indexOf(r.grade) > readIdx)
      .reduce((a, r) => a + r.n, 0);
    const better = line.real
      .filter((r) => GRADE_ORDER.indexOf(r.grade) < readIdx)
      .reduce((a, r) => a + r.n, 0);
    if (worse / line.n >= 0.6) {
      out.push(
        `Textos lidos como ${line.read} chegaram piores em ${worse} de ${line.n} discos — vale uma regra de teto (Correlação de condições).`,
      );
    } else if (better / line.n >= 0.6) {
      out.push(
        `Textos lidos como ${line.read} chegaram melhores em ${better} de ${line.n} discos — o leitor está conservador demais.`,
      );
    }
  }
  return out;
}

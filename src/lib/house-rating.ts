// Avaliação das casas de leilão (semáforo de 4 níveis + tags + anotação). Módulo puro/client-safe:
// a avaliação é feita POR COMPRA (página Compras) e o semáforo da casa é a agregação das compras
// avaliadas, com peso maior para as mais recentes.

export const RATING_LEVELS = ["verde", "amarelo", "laranja", "vermelho"] as const;
export type RatingLevel = (typeof RATING_LEVELS)[number];

export const LEVEL_META: Record<RatingLevel, { label: string; hint: string; score: number }> = {
  verde: { label: "Boa", hint: "Compraria de novo sem pensar", score: 3 },
  amarelo: { label: "Ok", hint: "Sem problemas, mas nada de especial", score: 2 },
  laranja: { label: "Atenção", hint: "Teve problema; compre com cautela", score: 1 },
  vermelho: { label: "Evitar", hint: "Experiência ruim", score: 0 },
};

export const POSITIVE_TAGS = [
  "Descrição fiel",
  "Embalagem boa",
  "Envio rápido",
  "Atende bem",
  "Bons achados",
  "Taxas justas",
] as const;
export const NEGATIVE_TAGS = [
  "Estado pior que o anunciado",
  "Embalagem ruim",
  "Demora a enviar",
  "Atendimento ruim",
  "Taxas altas",
  "Frete caro",
] as const;
const ALL_TAGS: readonly string[] = [...POSITIVE_TAGS, ...NEGATIVE_TAGS];

export type PurchaseRating = {
  level: RatingLevel;
  tags: string[];
  note: string;
  updatedAt: string;
};

export type HouseSummary = {
  key: string;
  /** `null` = nenhuma compra avaliada ainda. */
  level: RatingLevel | null;
  /** Compras avaliadas dessa casa. */
  rated: number;
  /** Tags mais marcadas (maior contagem primeiro). */
  tags: { tag: string; count: number }[];
  /** Anotações mais recentes (até 3). */
  notes: { title: string; note: string; level: RatingLevel; date: string }[];
};

export type RatingsPayload = {
  ratings: Record<string, PurchaseRating>;
  houses: Record<string, HouseSummary>;
};

export const EMPTY_RATINGS: RatingsPayload = { ratings: {}, houses: {} };

export function isRatingLevel(v: unknown): v is RatingLevel {
  return typeof v === "string" && (RATING_LEVELS as readonly string[]).includes(v);
}

/** Chave estável da casa: minúsculas, sem acento e sem espaços repetidos. */
export function houseKey(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Aceita só tags conhecidas, sem repetição; anotação aparada e limitada. */
export function sanitizeRating(input: {
  level?: unknown;
  tags?: unknown;
  note?: unknown;
}): Omit<PurchaseRating, "updatedAt"> | null {
  if (!isRatingLevel(input.level)) return null;
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((t): t is string => typeof t === "string"))].filter((t) =>
        ALL_TAGS.includes(t),
      )
    : [];
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  return { level: input.level, tags, note };
}

const DECAY = 0.8;

/** Nível da casa: média das compras avaliadas (mais recente pesa 1, cada anterior ×0,8). */
export function levelFromScores(scoresNewestFirst: number[]): RatingLevel | null {
  if (scoresNewestFirst.length === 0) return null;
  let sum = 0;
  let weights = 0;
  scoresNewestFirst.forEach((score, i) => {
    const w = DECAY ** i;
    sum += score * w;
    weights += w;
  });
  const mean = sum / weights;
  if (mean >= 2.5) return "verde";
  if (mean >= 1.5) return "amarelo";
  if (mean >= 0.5) return "laranja";
  return "vermelho";
}

type PurchaseRef = { id: string; house: string; title: string; wonDate: string | null };

/** Resumo por casa (chave = `houseKey`) a partir das compras e das avaliações por compra. */
export function summarizeHouses(
  purchases: readonly PurchaseRef[],
  ratings: Record<string, PurchaseRating>,
): Record<string, HouseSummary> {
  const byHouse = new Map<string, { p: PurchaseRef; r: PurchaseRating }[]>();
  for (const p of purchases) {
    const r = ratings[p.id];
    if (!r || !p.house) continue;
    const key = houseKey(p.house);
    const list = byHouse.get(key) ?? [];
    list.push({ p, r });
    byHouse.set(key, list);
  }
  const out: Record<string, HouseSummary> = {};
  for (const [key, list] of byHouse) {
    list.sort((a, b) =>
      (b.p.wonDate ?? b.r.updatedAt.slice(0, 10)).localeCompare(
        a.p.wonDate ?? a.r.updatedAt.slice(0, 10),
      ),
    );
    const counts = new Map<string, number>();
    for (const { r } of list) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    out[key] = {
      key,
      level: levelFromScores(list.map(({ r }) => LEVEL_META[r.level].score)),
      rated: list.length,
      tags: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
      notes: list
        .filter(({ r }) => r.note)
        .slice(0, 3)
        .map(({ p, r }) => ({
          title: p.title,
          note: r.note,
          level: r.level,
          date: p.wonDate ?? r.updatedAt.slice(0, 10),
        })),
    };
  }
  return out;
}

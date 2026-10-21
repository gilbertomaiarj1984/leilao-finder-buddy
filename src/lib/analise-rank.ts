/**
 * Ordenação e filtros PUROS da página Análise (lista única de lotes). Sem I/O nem React — os
 * dados por lote (nota, conta do lance, estado, mercado) chegam resolvidos pela tela
 * (`useLotInsights`); aqui só se compara e se filtra, para poder testar.
 */
import type { LotEconomics } from "./lot-score";
import { auctionStartMs } from "./vinyl-parse";

export type SortKey = "score" | "deal" | "potential" | "time" | "demand";

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Nota da IA" },
  { key: "deal", label: "Melhor negócio" },
  { key: "potential", label: "Potencial em R$" },
  { key: "time", label: "Horário do pregão" },
  { key: "demand", label: "Procura (want ÷ have)" },
];

export function isSortKey(v: unknown): v is SortKey {
  return SORT_KEYS.some((s) => s.key === v);
}

/** Campos que a ordenação lê (um subconjunto do que a linha da tela carrega). */
export type RankInput = {
  score: number | null;
  eco: LotEconomics;
  dayKey: string;
  time: string;
  want: number | null;
  have: number | null;
};

/** Procura no Discogs: quem quer ÷ quem tem (sem dado → 0). */
export function demandRatio(want: number | null, have: number | null): number {
  if (want === null || want <= 0) return 0;
  return want / Math.max(have ?? 0, 1);
}

// Quem não tem o dado vai para o fim, qualquer que seja a direção do critério.
const MISSING = Number.POSITIVE_INFINITY;

function startOf(i: RankInput): number {
  return auctionStartMs(i.dayKey, i.time) ?? MISSING;
}

/** Comparador do critério escolhido; empates caem na nota da IA (maior primeiro). */
export function compareBy<T extends RankInput>(key: SortKey): (a: T, b: T) => number {
  const byScore = (a: T, b: T) => (b.score ?? -1) - (a.score ?? -1);
  switch (key) {
    case "score":
      return byScore;
    case "deal":
      // Menor "custo ÷ mercado" primeiro; sem referência de mercado vai para o fim.
      return (a, b) => (a.eco.ratio ?? MISSING) - (b.eco.ratio ?? MISSING) || byScore(a, b);
    case "potential":
      return (a, b) =>
        (b.eco.potential ?? Number.NEGATIVE_INFINITY) -
          (a.eco.potential ?? Number.NEGATIVE_INFINITY) || byScore(a, b);
    case "time":
      return (a, b) => {
        const sa = startOf(a);
        const sb = startOf(b);
        if (sa === sb) return byScore(a, b);
        return sa < sb ? -1 : 1;
      };
    case "demand":
      return (a, b) => demandRatio(b.want, b.have) - demandRatio(a.want, a.have) || byScore(a, b);
  }
}

const GRADE_ORDER = ["P", "F", "G", "G+", "VG", "VG+", "NM", "M"];

/** O grau do disco atinge o mínimo pedido? Sem grau conhecido nunca passa (não inventa estado). */
export function gradeAtLeast(media: string | null | undefined, min: string): boolean {
  if (!min) return true;
  const have = GRADE_ORDER.indexOf((media ?? "").trim().toUpperCase());
  const want = GRADE_ORDER.indexOf(min.trim().toUpperCase());
  return have >= 0 && want >= 0 && have >= want;
}

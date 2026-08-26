import { normalizeForMatch } from "@/lib/vinyl-parse";

/** Avaliação da IA consumida pela UI (o que compõe a nota do lote). */
export type LotAi = {
  score: number | null;
  rarity: string | null;
  deal: string | null;
  reason: string | null;
  tags: string[];
  matchesInterests?: boolean;
};

const RARITY_LABEL: Record<string, string> = {
  comum: "Comum",
  interessante: "Interessante",
  raro: "Raro",
  muito_raro: "Muito raro",
};

const DEAL_LABEL: Record<string, string> = {
  caro: "Caro",
  justo: "Preço justo",
  barato: "Barato",
  indefinido: "Preço indefinido",
};

export function rarityLabel(r: string | null): string {
  return r ? (RARITY_LABEL[r] ?? r) : "—";
}
export function dealLabel(d: string | null): string {
  return d ? (DEAL_LABEL[d] ?? d) : "—";
}

/** Classes de cor do badge por faixa de nota (verde alto → cinza baixo). */
export function scoreTone(score: number | null): string {
  if (score === null) return "bg-secondary text-muted-foreground";
  if (score >= 80) return "bg-emerald-500 text-white";
  if (score >= 60) return "bg-green-600 text-white";
  if (score >= 40) return "bg-amber-500 text-black";
  if (score >= 20) return "bg-orange-500 text-white";
  return "bg-zinc-500 text-white";
}

export function dealTone(d: string | null): string {
  if (d === "barato") return "text-emerald-600 dark:text-emerald-400";
  if (d === "caro") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

/**
 * Cria um teste "casa com meus interesses" a partir da lista do usuário. Determinístico e
 * barato (não gasta a IA): normaliza (sem acento/pontuação) e casa por substring. Ignora
 * termos muito curtos para evitar falsos positivos.
 */
export function buildInterestMatcher(interests: string[]): (text: string) => boolean {
  const terms = interests.map(normalizeForMatch).filter((s) => s.length >= 3);
  if (!terms.length) return () => false;
  return (text: string) => {
    const t = normalizeForMatch(text);
    return terms.some((term) => t.includes(term));
  };
}

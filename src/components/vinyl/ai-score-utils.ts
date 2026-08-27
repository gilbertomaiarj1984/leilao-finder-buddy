import { bidIsWinning, normalizeForMatch, parsePrice } from "@/lib/vinyl-parse";

/** Avaliação da IA consumida pela UI (o que compõe a nota do lote). */
export type LotAi = {
  score: number | null;
  rarity: string | null;
  deal: string | null;
  album: string | null;
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

/**
 * Ordem da raridade, do MENOR para o MAIOR valor. Alimenta a legenda da Análise
 * (o usuário não sabia qual extremo é o "mais raro").
 */
export const RARITY_ORDER = ["comum", "interessante", "raro", "muito_raro"] as const;
export const RARITY_LEGEND: { key: string; label: string }[] = RARITY_ORDER.map((key) => ({
  key,
  label: RARITY_LABEL[key] ?? key,
}));
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

/** Âncora de mercado do Discogs consumida pela UI (camelCase; espelha `lot_market`). */
export type LotMarket = {
  matched: boolean;
  releaseId: number | null;
  releaseTitle: string | null;
  year: number | null;
  numForSale: number | null;
  lowestPrice: number | null;
  currency: string | null;
  suggestedPrice: number | null;
  suggestedCondition: string | null;
  have: number | null;
  want: number | null;
};

/** Converte a linha do banco (snake_case) para o tipo da UI (camelCase). */
export function toLotMarket(r: {
  matched: boolean;
  release_id: number | null;
  release_title: string | null;
  year: number | null;
  num_for_sale: number | null;
  lowest_price: number | null;
  currency: string | null;
  suggested_price: number | null;
  suggested_condition: string | null;
  have: number | null;
  want: number | null;
}): LotMarket {
  return {
    matched: r.matched,
    releaseId: r.release_id,
    releaseTitle: r.release_title,
    year: r.year,
    numForSale: r.num_for_sale,
    lowestPrice: r.lowest_price,
    currency: r.currency,
    suggestedPrice: r.suggested_price,
    suggestedCondition: r.suggested_condition,
    have: r.have,
    want: r.want,
  };
}

/** Formata valor com a moeda do Discogs (BRL na maioria; cai no símbolo genérico). */
export function fmtMoney(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  try {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
      maximumFractionDigits: 0,
    });
  } catch {
    return `${currency || "R$"} ${value.toFixed(0)}`;
  }
}

/** Preço do lote (BRL) vs. mercado: barato/justo/caro. "indefinido" sem base comparável. */
export function marketDeal(
  price: string,
  m: LotMarket | undefined,
): "barato" | "justo" | "caro" | "indefinido" {
  if (!m || !m.matched) return "indefinido";
  const p = parsePrice(price);
  const ref = m.lowestPrice ?? m.suggestedPrice;
  if (p === null || ref === null || ref <= 0) return "indefinido";
  if (p <= ref * 0.7) return "barato";
  if (p >= ref * 1.15) return "caro";
  return "justo";
}

/** URL pública do release no Discogs (para tornar a âncora de mercado clicável em todo lugar). */
export function discogsUrl(releaseId: number | null | undefined): string | null {
  return releaseId ? `https://www.discogs.com/release/${releaseId}` : null;
}

/**
 * Cor da BORDA de um item conforme o padrão do site (mesma regra do `LotCard`/painel):
 * meu lance ganhando = verde; meu lance coberto = vermelho; apenas vigiado = amarelo;
 * caso contrário, neutro. Usado como borda esquerda nas linhas das tabelas da Análise.
 */
export function rowStatusTone(bidStatus: string | null | undefined, watched: boolean): string {
  const hasBid = bidStatus !== undefined && bidStatus !== null && bidStatus !== "";
  if (hasBid)
    return bidIsWinning(bidStatus)
      ? "border-l-4 border-l-green-500"
      : "border-l-4 border-l-red-500";
  if (watched) return "border-l-4 border-l-yellow-500";
  return "border-l-4 border-l-transparent";
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

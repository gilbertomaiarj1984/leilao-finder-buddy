import type { PanelConfig } from "@/lib/ai-panel-config";
import { auctionFreight } from "@/lib/auction-freight";
import {
  anchorForCondition,
  gradeToCondKey,
  normalizeSuggestionMap,
  type PriceAnchor,
  type SuggestionMap,
} from "@/lib/discogs-price";
import { normalizeGrade, type Grade } from "@/lib/grading";
import { normalizeForMatch, parsePrice, titleCase } from "@/lib/vinyl-parse";

/**
 * Quebra o `album` da IA ("Artista - Álbum (1970)") em {artist, album, year}. Versão
 * client-safe (espelha `parseAlbum`/`extractYear` de `discogs.server.ts`, que não pode
 * ser importado no cliente): separa no 1º travessão/hífen/dois-pontos/barra e extrai o
 * ano. O modelo às vezes devolve "Artista / Álbum" em vez do " - " pedido, então " / "
 * (com espaços) também conta como separador — sem isso o artista caía no heurístico do
 * título ("LP: Artista: X"), que rendia o literal "Artista" e agrupava tudo errado.
 * Sem separador, `artist` fica null e tudo vira `album`.
 */
export function parseAiAlbum(album: string | null | undefined): {
  artist: string | null;
  album: string | null;
  year: number | null;
} {
  const raw = (album ?? "").trim();
  if (!raw) return { artist: null, album: null, year: null };
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  let s = raw
    .replace(/\((?:\s*\d{4}\s*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s.split(/\s[-–—:/]\s/);
  if (parts.length >= 2 && parts[0]!.trim()) {
    const artist = parts[0]!.trim();
    const rest = parts.slice(1).join(" - ").trim();
    return { artist: artist || null, album: rest || null, year };
  }
  s = s
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { artist: null, album: s || null, year };
}

/**
 * Formato PADRÃO de exibição do artista/álbum sugerido pela IA: `Artista — Álbum (Ano)`.
 * Aplica `titleCase` no artista; usa `fallbackYear` (ex.: `market.year`) quando o texto
 * da IA não traz o ano. Sem artista, mostra só o álbum; string vazia quando não há nada.
 */
export function formatAiAlbum(
  album: string | null | undefined,
  fallbackYear?: number | null,
): string {
  const parsed = parseAiAlbum(album);
  if (!parsed.artist && !parsed.album) return (album ?? "").trim();
  const year = parsed.year ?? fallbackYear ?? null;
  const artist = parsed.artist ? titleCase(parsed.artist) : null;
  const core = artist
    ? parsed.album
      ? `${artist} — ${parsed.album}`
      : artist
    : (parsed.album ?? "");
  return year ? `${core} (${year})` : core;
}

/**
 * Linha curta do aviso de lance superado: `Lote 12 — Artista — Álbum` (sem ano). `albumRaw` é o
 * álbum resolvido pela IA ("Artista - Álbum (1970)"); sem ele, cai no título cru do lance.
 */
export function formatCoveredLot(
  lot: { lote: string; title: string },
  albumRaw: string | null | undefined,
): string {
  const parsed = parseAiAlbum(albumRaw);
  const artist = parsed.artist ? titleCase(parsed.artist) : null;
  const what =
    artist && parsed.album
      ? `${artist} — ${parsed.album}`
      : (artist ?? parsed.album ?? lot.title.trim());
  const lote = lot.lote.trim();
  return lote ? `Lote ${lote} — ${what}` : what;
}

/** Avaliação da IA consumida pela UI (o que compõe a nota do lote). */
export type LotAi = {
  score: number | null;
  rarity: string | null;
  deal: string | null;
  album: string | null;
  reason: string | null;
  tags: string[];
  /** Preço (R$) do lote quando a nota foi dada (`lot_ai.eval_price`) — ver `ai-reprice.ts`. */
  evalPrice?: number | null;
  /** Existe tracklist (faixas + fama) gravada — a lista em si vem sob demanda (`useLotTracklist`). */
  hasTracklist?: boolean;
  matchesInterests?: boolean;
};

/** Linha de `getLotAi` (banco, snake_case) → `LotAi` da UI. DUP(lot-ai-mapper): único ponto. */
export function toLotAi(r: {
  score: number | null;
  rarity: string | null;
  deal: string | null;
  album: string | null;
  reason: string | null;
  tags: string[];
  eval_price: number | null;
  hasTracklist: boolean;
}): LotAi {
  return {
    score: r.score,
    rarity: r.rarity,
    deal: r.deal,
    album: r.album,
    reason: r.reason,
    tags: r.tags,
    evalPrice: r.eval_price,
    hasTracklist: r.hasTracklist,
  };
}

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
const RARITY_ORDER = ["comum", "interessante", "raro", "muito_raro"] as const;
export const RARITY_LEGEND: { key: string; label: string }[] = RARITY_ORDER.map((key) => ({
  key,
  label: RARITY_LABEL[key] ?? key,
}));
export function dealLabel(d: string | null): string {
  return d ? (DEAL_LABEL[d] ?? d) : "—";
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
  /** Sugerido de todas as condições (BRL); null = ainda não coletado. */
  suggestedByCondition: SuggestionMap | null;
  /** Âncora para a condição do lote (preenchida por `withConditionAnchor`). */
  anchor?: PriceAnchor | null;
  /** Frete estimado do leilão (por UF), somado ao valor do lote no veredicto. */
  freight?: number | null;
  have: number | null;
  want: number | null;
  // Faixa real no mercado, só vendedores do Brasil, com TOTAL (preço + frete). BRL.
  priceLowBr: number | null;
  priceHighBr: number | null;
  numForSaleBr: number | null;
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
  suggested_by_condition?: unknown;
  have: number | null;
  want: number | null;
  price_low_br?: number | null;
  price_high_br?: number | null;
  num_for_sale_br?: number | null;
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
    suggestedByCondition: normalizeSuggestionMap(r.suggested_by_condition),
    have: r.have,
    want: r.want,
    priceLowBr: r.price_low_br ?? null,
    priceHighBr: r.price_high_br ?? null,
    numForSaleBr: r.num_for_sale_br ?? null,
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

/**
 * Faixas do veredicto "vs. mercado": barato quando o valor do lote ≤ 70% da referência; caro quando
 * ≥ 115%. O texto do prompt da IA (`ai-eval.server.ts`) usa as MESMAS constantes.
 */
export const DEAL_BAND_CHEAP = 0.7;
export const DEAL_BAND_EXPENSIVE = 1.15;

/**
 * Referência de preço do mercado (BRL), da mais para a menos confiável — ver `marketDeal`.
 * `includesShipping`: o valor já é um TOTAL com o frete do vendedor (a faixa BR do Discogs soma
 * preço + frete); os demais são preço do disco, sem frete.
 */
function marketReferenceInfo(
  m: LotMarket | undefined,
): { value: number; includesShipping: boolean } | null {
  if (!m || !m.matched) return null;
  // Âncora, da mais para a menos confiável: sugerido da CONDIÇÃO do lote; menor total (preço +
  // frete) de vendedor BR; sugerido padrão (G+); e só por último o menor global, que é o
  // anúncio mais barato do mundo em qualquer condição (ou, em disco raro, um lacrado caro).
  const anchor = m.anchor?.price;
  if (anchor !== null && anchor !== undefined && anchor > 0)
    return { value: anchor, includesShipping: false };
  if (m.priceLowBr !== null && m.priceLowBr !== undefined && m.priceLowBr > 0)
    return { value: m.priceLowBr, includesShipping: true };
  const rest = m.suggestedPrice ?? m.lowestPrice;
  return rest !== null && rest !== undefined && rest > 0
    ? { value: rest, includesShipping: false }
    : null;
}

export type LotDeal = "barato" | "justo" | "caro" | "indefinido";

/**
 * Comissão do leiloeiro estimada, SEMPRE 5% do valor do lote. Aparece à parte (como o frete) e
 * não entra na comparação com o mercado nem nos tetos de lance.
 */
export const COMMISSION_PCT = 0.05;

/** A conta do lote contra o mercado (tudo em BRL; `null` = sem base para calcular). */
export type LotEconomics = {
  /** Valor do lote (o lance): é isto que se compara com o mercado. O frete e a comissão ficam à parte. */
  total: number | null;
  /** Frete estimado do leilão (UF), SEMPRE à parte do valor do lote. */
  freight: number;
  /** Comissão estimada do leiloeiro (5% do lote), à parte do valor do lote. */
  commission: number | null;
  /**
   * Preço de referência do mercado: o que um comprador paga no Discogs, preço do disco + frete
   * (`refShipping`), pois vendedores embutem margem no frete.
   */
  ref: number | null;
  /** Parte de `ref` que é frete do Discogs (0 quando a referência já é um total com frete). */
  refShipping: number;
  /** `total ÷ ref`. */
  ratio: number | null;
  deal: LotDeal;
  /** Maior lance que ainda deixa o lote "barato" (valor do lote ≤ 70% da referência). */
  capCheap: number | null;
  /** Maior lance que ainda deixa o lote "justo" (valor do lote < 115% da referência). */
  capFair: number | null;
  /** `ref − total`: quanto o mercado paga a mais (negativo = lote acima do mercado). */
  potential: number | null;
};

/**
 * Conta do lote: valor do lote contra o Discogs (preço + frete do vendedor), veredicto e tetos de
 * lance. Regra ÚNICA em todo o app (home, Análise, e-mails, calibração e prompt da IA): o lote vale
 * o que se paga por ele, e quem leva o frete é o lado do Discogs, onde ele costuma inflar o preço.
 * É a ÚNICA fonte das faixas barato/justo/caro (`DEAL_BAND_*`) — `marketDeal` só devolve o veredicto
 * daqui.
 */
export function lotEconomics(price: string, m: LotMarket | undefined): LotEconomics {
  const hammer = parsePrice(price);
  const info = marketReferenceInfo(m);
  const freight = m?.freight ?? 0;
  const refShipping = info && !info.includesShipping ? freight : 0;
  const ref = info ? info.value + refShipping : null;
  const total = hammer;
  const commission = hammer === null ? null : hammer * COMMISSION_PCT;
  if (total === null || ref === null) {
    return {
      total,
      freight,
      commission,
      refShipping,
      ref,
      ratio: null,
      deal: "indefinido",
      capCheap: null,
      capFair: null,
      potential: null,
    };
  }
  const deal: LotDeal =
    total <= ref * DEAL_BAND_CHEAP
      ? "barato"
      : total >= ref * DEAL_BAND_EXPENSIVE
        ? "caro"
        : "justo";
  return {
    total,
    freight,
    commission,
    refShipping,
    ref,
    ratio: total / ref,
    deal,
    capCheap: Math.max(0, Math.floor(ref * DEAL_BAND_CHEAP)),
    capFair: Math.max(0, Math.ceil(ref * DEAL_BAND_EXPENSIVE) - 1),
    potential: ref - total,
  };
}

/** Preço do lote (BRL) vs. mercado: barato/justo/caro. "indefinido" sem base comparável. */
export function marketDeal(price: string, m: LotMarket | undefined): LotDeal {
  return lotEconomics(price, m).deal;
}

/**
 * Anexa ao mercado o contexto do lote: a âncora de preço da condição (mídia; sem condição usa
 * G+) e o frete estimado do leilão pela UF.
 */
export function withConditionAnchor(
  m: LotMarket | undefined,
  media: Grade | string | null | undefined,
  uf?: string | null,
  cfg?: Pick<PanelConfig, "defaultCond" | "freight">,
): LotMarket | undefined {
  if (!m) return m;
  const grade = media ? normalizeGrade(media) : null;
  const anchor = anchorForCondition(
    m.suggestedByCondition,
    gradeToCondKey(grade),
    cfg?.defaultCond,
  );
  return { ...m, ...(anchor ? { anchor } : {}), freight: auctionFreight(uf, cfg?.freight) };
}

/** URL pública do release no Discogs (para tornar a âncora de mercado clicável em todo lugar). */
export function discogsUrl(releaseId: number | null | undefined): string | null {
  return releaseId ? `https://www.discogs.com/release/${releaseId}` : null;
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

// ---- Índice de garimpo --------------------------------------------------------------------------

type GarimpoPartKey = "negocio" | "nota" | "estado" | "procura" | "casa";

export type GarimpoPart = {
  key: GarimpoPartKey;
  label: string;
  /** Peso no índice (soma 100). */
  weight: number;
  /** 0–1. Sem dado vale `neutral` (e `known` fica false) — nunca penaliza nem premia no escuro. */
  value: number;
  known: boolean;
};

export type Garimpo = {
  /** 0–100. */
  index: number;
  parts: GarimpoPart[];
  /** O disco já está na Coleção: o índice cai pela metade. */
  ownedPenalty: boolean;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Índice de garimpo (EXPERIMENTAL): um número 0–100 que junta o que decide uma boa compra, para
 * ordenar a lista — NÃO substitui a nota da IA. Cada parte vai de 0 a 1 e tem peso fixo:
 * negócio 35 (valor do lote ÷ Discogs com frete: ≤ 50% = 1, ≥ 115% = 0), nota da IA 25, estado do disco 15 (nota de
 * estado 0–100), procura 15 (want ÷ have: 3× ou mais = 1) e casa 10 (semáforo). Disco que já está
 * na Coleção vale metade. Parte sem dado fica neutra e marcada `known: false`.
 */
export function garimpoIndex(input: {
  eco: LotEconomics;
  score: number | null;
  conditionScore: number | null;
  want: number | null;
  have: number | null;
  houseLevel: "verde" | "amarelo" | "laranja" | "vermelho" | null;
  ownedConfident: boolean;
}): Garimpo {
  const ratio = input.eco.ratio;
  const heat =
    input.want !== null && input.want > 0 ? input.want / Math.max(input.have ?? 0, 1) : null;
  const house = { verde: 1, amarelo: 0.6, laranja: 0.3, vermelho: 0 } as const;
  const parts: GarimpoPart[] = [
    {
      key: "negocio",
      label: "Negócio (valor do lote ÷ Discogs)",
      weight: 35,
      known: ratio !== null,
      value:
        ratio !== null ? clamp01((DEAL_BAND_EXPENSIVE - ratio) / (DEAL_BAND_EXPENSIVE - 0.5)) : 0.4,
    },
    {
      key: "nota",
      label: "Nota da IA",
      weight: 25,
      known: input.score !== null,
      value: input.score !== null ? clamp01(input.score / 100) : 0.4,
    },
    {
      key: "estado",
      label: "Estado do disco",
      weight: 15,
      known: input.conditionScore !== null,
      value: input.conditionScore !== null ? clamp01(input.conditionScore / 100) : 0.5,
    },
    {
      key: "procura",
      label: "Procura no Discogs",
      weight: 15,
      known: heat !== null,
      value: heat !== null ? clamp01(heat / 3) : 0.3,
    },
    {
      key: "casa",
      label: "Casa (semáforo)",
      weight: 10,
      known: input.houseLevel !== null,
      value: input.houseLevel !== null ? house[input.houseLevel] : 0.6,
    },
  ];
  const raw = parts.reduce((sum, p) => sum + p.weight * p.value, 0);
  return {
    index: Math.round(input.ownedConfident ? raw / 2 : raw),
    parts,
    ownedPenalty: input.ownedConfident,
  };
}

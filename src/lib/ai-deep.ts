/**
 * Análise PROFUNDA da IA (só vigiados, lances ganhando e lances superados) — client-safe, sem I/O.
 *
 * Roda pelo botão "Analisar vigiados" (um dia por vez) e grava, além da nota de sempre, o bloco
 * `lot_ai.deep`: descritivo do álbum, estado de conservação lido do texto completo do lote,
 * sinergia com a coleção e a análise de preço contra o Analytics. O cron e os demais botões NÃO
 * usam este modo. Ver docs/areas/ia.md ("Análise profunda dos vigiados").
 */
import { extractJsonObject } from "./json-extract";
import { priceRoseSinceEval } from "./ai-reprice";

export type DeepCondition = {
  disco: string | null;
  capa: string | null;
  encarte: "sim" | "nao" | null;
  defeitos: string[];
  inclui: string[];
  /** De onde a IA tirou o estado: o texto da casa, a foto ou os dois. */
  base: "texto" | "imagem" | "misto" | null;
};

export type DeepAnalysis = {
  /** 2 a 4 frases sobre o ÁLBUM (artista, importância, prensagem, o que o lote traz). */
  descricao: string | null;
  estado: DeepCondition | null;
  /** Como o disco se relaciona com a coleção e os interesses do colecionador. */
  sinergia: string | null;
  /** Preço avaliado contra vendas passadas e Discogs. */
  analytics: string | null;
  /** Preço (R$) com que a análise foi feita: valor atual (lance ganhando) ou próximo lance. */
  preco: number | null;
  /** Quando foi gerada (ISO). */
  at: string;
};

/**
 * Preço que a análise profunda avalia: com lance MEU ganhando vale o valor ATUAL (é o que vou
 * pagar); só vigiado ou lance superado vale o PRÓXIMO lance (o que eu pagaria para entrar/voltar).
 * Sem próximo lance conhecido, cai no valor atual.
 */
export function deepPriceFor(opts: {
  winning: boolean;
  current: string;
  nextBid?: string | null;
}): string {
  if (opts.winning) return opts.current;
  return opts.nextBid?.trim() || opts.current;
}

/**
 * A nota profunda ficou desatualizada? Só vale para lote que TEM análise profunda: o preço atual
 * subiu o bastante desde a avaliação (mesma regra do reprice automático, `priceRoseSinceEval`).
 */
export function deepIsStale(
  deep: DeepAnalysis | null | undefined,
  evalPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): boolean {
  return Boolean(deep) && priceRoseSinceEval(evalPrice, currentPrice);
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.replace(/\s+/g, " ").trim().slice(0, maxLen))
        .slice(0, maxItems)
    : [];

/** Lê o bloco `deep` do JSON devolvido pela IA (campos soltos no mesmo objeto da nota). */
function parseDeepFields(
  obj: Record<string, unknown>,
  preco: number | null,
  at = new Date().toISOString(),
): DeepAnalysis | null {
  const rawEstado = obj["estado"];
  let estado: DeepCondition | null = null;
  if (rawEstado && typeof rawEstado === "object" && !Array.isArray(rawEstado)) {
    const e = rawEstado as Record<string, unknown>;
    const base = e["base"];
    const encarte = e["encarte"];
    estado = {
      disco: str(e["disco"], 40),
      capa: str(e["capa"], 40),
      encarte: encarte === "sim" || encarte === "nao" ? encarte : null,
      defeitos: strList(e["defeitos"], 8, 120),
      inclui: strList(e["inclui"], 8, 120),
      base: base === "texto" || base === "imagem" || base === "misto" ? base : null,
    };
    if (
      !estado.disco &&
      !estado.capa &&
      !estado.encarte &&
      !estado.defeitos.length &&
      !estado.inclui.length
    )
      estado = null;
  }
  const deep: DeepAnalysis = {
    descricao: str(obj["descricao"], 900),
    estado,
    sinergia: str(obj["sinergia"], 400),
    analytics: str(obj["analytics"], 600),
    preco,
    at,
  };
  return deep.descricao || deep.estado || deep.sinergia || deep.analytics ? deep : null;
}

/** Normaliza o jsonb `lot_ai.deep` vindo do banco (qualquer coisa fora do formato vira null). */
export function normalizeDeep(raw: unknown): DeepAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = typeof o["at"] === "string" ? o["at"] : "";
  const preco = typeof o["preco"] === "number" && Number.isFinite(o["preco"]) ? o["preco"] : null;
  return parseDeepFields(o, preco, at);
}

/** Texto da resposta → bloco deep (null quando o JSON não vem ou não traz nada aproveitável). */
export function parseDeepText(text: string, preco: number | null): DeepAnalysis | null {
  const obj = extractJsonObject(text);
  return obj ? parseDeepFields(obj, preco) : null;
}

/**
 * Contexto extra que acompanha cada lote no prompt da avaliação (v0.142.0): estado de conservação,
 * preço sugerido do Discogs para a condição do disco e frete estimado da casa. Funções PURAS
 * (client-safe, testáveis); a leitura das tabelas fica em `ai-context.server.ts`.
 *
 * Tudo em reais, no Brasil. Dado ausente simplesmente não entra no prompt (a IA volta a estimar
 * pelo próprio conhecimento, como antes).
 */
import { auctionFreight } from "./auction-freight";
import {
  anchorForCondition,
  gradeToCondKey,
  normalizeSuggestionMap,
  type PriceAnchor,
} from "./discogs-price";
import { normalizeGrade, scoreCondition } from "./grading";

/**
 * Versão do prompt da avaliação. Entra no hash de `lot_ai.title_hash` (ver `evalHash`): subir o
 * número reavalia todos os lotes na rodada seguinte. Mudou o texto do prompt ou os blocos de
 * contexto? Suba aqui.
 */
export const PROMPT_VERSION = 2;

export type LotContext = {
  estado: {
    disco: string | null;
    capa: string | null;
    encarte: "sim" | "nao" | null;
    nota_estado: number | null;
  } | null;
  mercado: {
    anchor: PriceAnchor;
    ano: number | null;
    querem: number | null;
    tem: number | null;
    anuncios_a_venda: number | null;
  } | null;
  frete: number;
};

type ConditionInput = {
  media?: string | null;
  sleeve?: string | null;
  insert_state?: string | null;
  score?: number | null;
} | null;

type MarketInput = {
  matched?: boolean | null;
  year?: number | null;
  num_for_sale?: number | null;
  have?: number | null;
  want?: number | null;
  suggested_by_condition?: unknown;
} | null;

/** Monta o contexto de um lote a partir das linhas de `lot_condition`, `lot_market` e da UF. */
export function buildLotContext(input: {
  condition?: ConditionInput;
  market?: MarketInput;
  uf?: string | null;
}): LotContext {
  const c = input.condition;
  const mediaRaw = c?.media ? normalizeGrade(c.media) : null;
  const sleeveRaw = c?.sleeve ? normalizeGrade(c.sleeve) : null;
  const insert: "sim" | "nao" | null =
    c?.insert_state === "sim" ? "sim" : c?.insert_state === "nao" ? "nao" : null;
  const estado =
    mediaRaw || sleeveRaw
      ? {
          disco: mediaRaw,
          capa: sleeveRaw,
          encarte: insert,
          nota_estado: typeof c?.score === "number" ? c.score : null,
        }
      : null;

  // Convenção do app: com só um lado conhecido, o outro repete (scoreCondition espelha).
  const grade = scoreCondition(mediaRaw, sleeveRaw).media;
  const m = input.market;
  const anchor = m?.matched
    ? anchorForCondition(normalizeSuggestionMap(m.suggested_by_condition), gradeToCondKey(grade))
    : null;
  const mercado =
    m && anchor
      ? {
          anchor,
          ano: m.year ?? null,
          querem: m.want ?? null,
          tem: m.have ?? null,
          anuncios_a_venda: m.num_for_sale ?? null,
        }
      : null;
  return { estado, mercado, frete: auctionFreight(input.uf) };
}

/**
 * Objeto `contexto` que vai no JSON do prompt. `priceBrl` é o valor atual do lote (sem frete);
 * com ele e a âncora do Discogs entram o total com frete e a razão entre os dois, que é o número
 * que a IA precisa para dizer "barato" ou "caro" (mesmas faixas do `marketDeal` do app).
 */
export function contextForPrompt(
  ctx: LotContext,
  priceBrl: number | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (ctx.estado) out["estado"] = ctx.estado;
  out["frete_estimado_brl"] = ctx.frete;
  const total = priceBrl != null && priceBrl > 0 ? priceBrl + ctx.frete : null;
  if (total != null) out["lote_mais_frete_brl"] = total;
  if (ctx.mercado) {
    const { anchor, ano, querem, tem, anuncios_a_venda } = ctx.mercado;
    out["mercado_discogs_brl"] = {
      preco_sugerido: Math.round(anchor.price),
      condicao_de_referencia: anchor.condition,
      estado_do_lote_conhecido: anchor.exact,
      ...(ano != null ? { ano } : {}),
      ...(querem != null ? { querem } : {}),
      ...(tem != null ? { tem } : {}),
      ...(anuncios_a_venda != null ? { anuncios_a_venda } : {}),
    };
    if (total != null)
      out["razao_lote_vs_sugerido"] = Math.round((total / anchor.price) * 100) / 100;
  }
  return out;
}

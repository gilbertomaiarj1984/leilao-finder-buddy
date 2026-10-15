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
  CONTEXT_BLOCK_IDS,
  CONTEXT_FIELDS,
  DEFAULT_PANEL_CONFIG,
  fieldOn,
  type PanelConfig,
} from "./ai-panel-config";
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
export const PROMPT_VERSION = 3;

/**
 * Descrição textual da ESTRUTURA do contexto (blocos e campos que o prompt pode levar). Entra no hash
 * da avaliação: acrescentar, renomear ou remover um bloco/campo em `ai-panel-config.ts` muda este
 * texto e reavalia a base sozinho. O que NÃO é coberto (e por isso ainda pede subir `PROMPT_VERSION`):
 * mudança na LÓGICA que calcula um valor (ex.: outra âncora, outro arredondamento) sem mudar nomes.
 */
export function contextSchemaSignature(): string {
  return CONTEXT_BLOCK_IDS.map((b) => `${b}:${CONTEXT_FIELDS[b].map((f) => f.key).join(",")}`).join(
    "|",
  );
}

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
export function buildLotContext(
  input: {
    condition?: ConditionInput;
    market?: MarketInput;
    uf?: string | null;
  },
  cfg: PanelConfig = DEFAULT_PANEL_CONFIG,
): LotContext {
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
    ? anchorForCondition(
        normalizeSuggestionMap(m.suggested_by_condition),
        gradeToCondKey(grade),
        cfg.defaultCond,
      )
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
  return { estado, mercado, frete: auctionFreight(input.uf, cfg.freight) };
}

/**
 * Objeto `contexto` que vai no JSON do prompt, na ordem dos blocos da configuração e sem os campos
 * desligados. `priceBrl` é o valor atual do lote (sem frete); com ele e a âncora do Discogs entram
 * o total com frete e a razão entre os dois, o número que a IA precisa para dizer "barato" ou
 * "caro" (mesmas faixas do `marketDeal` do app).
 */
export function contextForPrompt(
  ctx: LotContext,
  priceBrl: number | null,
  cfg: PanelConfig = DEFAULT_PANEL_CONFIG,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const total = priceBrl != null && priceBrl > 0 ? priceBrl + ctx.frete : null;
  const pick = (block: "estado" | "mercado" | "frete", all: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(all).filter(([k, v]) => v !== undefined && fieldOn(cfg, block, k)),
    );

  for (const block of cfg.blocks) {
    if (block === "estado" && ctx.estado) {
      const o = pick("estado", { ...ctx.estado });
      if (Object.keys(o).length) out["estado"] = o;
    } else if (block === "mercado" && ctx.mercado) {
      const { anchor, ano, querem, tem, anuncios_a_venda } = ctx.mercado;
      const o = pick("mercado", {
        preco_sugerido: Math.round(anchor.price),
        condicao_de_referencia: anchor.condition,
        estado_do_lote_conhecido: anchor.exact,
        ano: ano ?? undefined,
        querem: querem ?? undefined,
        tem: tem ?? undefined,
        anuncios_a_venda: anuncios_a_venda ?? undefined,
        razao_lote_vs_sugerido:
          total != null ? Math.round((total / anchor.price) * 100) / 100 : undefined,
      });
      if (Object.keys(o).length) out["mercado_discogs_brl"] = o;
    } else if (block === "frete") {
      Object.assign(
        out,
        pick("frete", {
          frete_estimado_brl: ctx.frete,
          lote_mais_frete_brl: total ?? undefined,
        }),
      );
    }
  }
  return out;
}

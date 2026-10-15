/**
 * Configuração do painel de IA (`/ia-painel`), guardada em `app_state.ai_panel`. Módulo PURO
 * (client-safe): tipos, padrões e a validação de tudo que vem do banco ou do cliente — o resto do
 * app só lê um `PanelConfig` já normalizado. Sem configuração salva, vale o comportamento padrão.
 */
import { FREIGHT_OUTRAS_REGIOES, FREIGHT_SUDESTE } from "./auction-freight";
import { MAX_WILDCARDS, type UserTextRule } from "./condition-text";
import { COND_KEYS, DEFAULT_COND, type CondKey } from "./discogs-price";
import { GRADE_ORDER } from "./grading";

/** Blocos do bloco `contexto` do prompt da avaliação (ver `ai-context.ts`). */
export const CONTEXT_BLOCK_IDS = [
  "estado",
  "mercado",
  "frete",
  "descricao",
  "vendas",
  "colecionador",
] as const;
export type ContextBlockId = (typeof CONTEXT_BLOCK_IDS)[number];

/** Campos de cada bloco, na ordem em que aparecem no JSON do prompt. */
export const CONTEXT_FIELDS: Record<ContextBlockId, readonly { key: string; label: string }[]> = {
  estado: [
    { key: "disco", label: "Disco" },
    { key: "capa", label: "Capa" },
    { key: "encarte", label: "Encarte" },
    { key: "nota_estado", label: "Nota de estado" },
  ],
  mercado: [
    { key: "preco_sugerido", label: "Preço sugerido (condição do disco)" },
    { key: "condicao_de_referencia", label: "Condição de referência" },
    { key: "estado_do_lote_conhecido", label: "Estado do lote conhecido" },
    { key: "ano", label: "Ano" },
    { key: "querem", label: "Querem (want)" },
    { key: "tem", label: "Têm (have)" },
    { key: "anuncios_a_venda", label: "Anúncios à venda" },
    { key: "razao_lote_vs_sugerido", label: "Razão lote ÷ sugerido" },
  ],
  frete: [
    { key: "frete_estimado_brl", label: "Frete estimado" },
    { key: "lote_mais_frete_brl", label: "Lote + frete" },
  ],
  descricao: [{ key: "descricao_do_lote", label: "Texto da descrição" }],
  colecionador: [
    { key: "nos_meus_interesses", label: "Combina com meus interesses" },
    { key: "de_olho", label: "É um disco que estou de olho" },
    { key: "teto_de_olho_brl", label: "Teto de preço do De olho" },
    { key: "ja_tenho", label: "Já tenho na Coleção" },
  ],
  vendas: [
    { key: "n_vendas", label: "Nº de vendas" },
    { key: "menor", label: "Menor preço" },
    { key: "mediana", label: "Mediana" },
    { key: "maior", label: "Maior preço" },
    { key: "ultima_venda", label: "Última venda" },
    { key: "ultima_venda_em", label: "Data da última venda" },
    { key: "n_estado_parecido", label: "Nº de vendas de estado parecido" },
    { key: "mediana_estado_parecido", label: "Mediana de estado parecido" },
    { key: "razao_preco_vs_mediana", label: "Razão preço ÷ mediana" },
  ],
};

export const CONTEXT_BLOCK_NAMES: Record<ContextBlockId, string> = {
  estado: "Estado de conservação",
  mercado: "Discogs · mercado em reais",
  frete: "Frete do leilão",
  descricao: "Descrição completa do lote",
  vendas: "Vendas passadas do mesmo disco",
  colecionador: "Perfil do colecionador",
};

/** Blocos que já existiam antes de `blocksSeen`: config salva sem ele conhece só estes. */
const LEGACY_BLOCKS: readonly ContextBlockId[] = ["estado", "mercado", "frete"];

export type PanelConfig = {
  /** Blocos ligados, na ordem do prompt. Bloco fora da lista = desligado. */
  blocks: ContextBlockId[];
  /**
   * Blocos que o usuário já "conheceu" (estavam disponíveis quando a config foi salva). Um bloco
   * NOVO do app, ainda não visto, entra ligado sozinho; um que ele tirou continua fora.
   */
  blocksSeen: ContextBlockId[];
  /** Campos desligados, no formato "bloco.campo" (ex.: "mercado.tem"). */
  hiddenFields: string[];
  /** Condição do Discogs usada quando o estado do lote é desconhecido. */
  defaultCond: CondKey;
  /** Frete estimado do leilão, em reais. */
  freight: { sudeste: number; outras: number };
  /** Expressões escritas pelo usuário (somam às regras do app). */
  rules: UserTextRule[];
  /** Regras do app desligadas (ids de `TEXT_RULES`). */
  disabledRules: string[];
};

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  blocks: [...CONTEXT_BLOCK_IDS],
  blocksSeen: [...CONTEXT_BLOCK_IDS],
  hiddenFields: [],
  defaultCond: DEFAULT_COND,
  freight: { sudeste: FREIGHT_SUDESTE, outras: FREIGHT_OUTRAS_REGIOES },
  rules: [],
  disabledRules: [],
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const money = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 500
    ? Math.round(v * 100) / 100
    : fallback;

/** Valida qualquer coisa vinda do banco/cliente e devolve um `PanelConfig` seguro. */
export function normalizePanelConfig(raw: unknown): PanelConfig {
  const d = DEFAULT_PANEL_CONFIG;
  if (!isObj(raw)) return { ...d, blocks: [...d.blocks] };

  const blocks: ContextBlockId[] = [];
  if (Array.isArray(raw["blocks"])) {
    for (const b of raw["blocks"]) {
      if ((CONTEXT_BLOCK_IDS as readonly unknown[]).includes(b) && !blocks.includes(b as never))
        blocks.push(b as ContextBlockId);
    }
  } else blocks.push(...d.blocks);
  const rawSeen = Array.isArray(raw["blocksSeen"]) ? raw["blocksSeen"] : LEGACY_BLOCKS;
  for (const b of CONTEXT_BLOCK_IDS)
    if (!rawSeen.includes(b) && !blocks.includes(b)) blocks.push(b);

  const valid = new Set(
    CONTEXT_BLOCK_IDS.flatMap((id) => CONTEXT_FIELDS[id].map((f) => `${id}.${f.key}`)),
  );
  const hiddenFields = Array.isArray(raw["hiddenFields"])
    ? [
        ...new Set(
          raw["hiddenFields"].filter((f): f is string => typeof f === "string" && valid.has(f)),
        ),
      ]
    : [];

  const defaultCond = (COND_KEYS as readonly unknown[]).includes(raw["defaultCond"])
    ? (raw["defaultCond"] as CondKey)
    : d.defaultCond;

  const fr = isObj(raw["freight"]) ? raw["freight"] : {};
  const freight = {
    sudeste: money(fr["sudeste"], d.freight.sudeste),
    outras: money(fr["outras"], d.freight.outras),
  };

  const rules: UserTextRule[] = [];
  if (Array.isArray(raw["rules"])) {
    for (const r of raw["rules"].slice(0, 100)) {
      if (!isObj(r)) continue;
      const phrase = typeof r["phrase"] === "string" ? r["phrase"].trim().slice(0, 80) : "";
      const grade = r["grade"];
      if (phrase.length < 3 || !(GRADE_ORDER as readonly unknown[]).includes(grade)) continue;
      if (phrase.split("*").length - 1 > MAX_WILDCARDS) continue;
      rules.push({
        id: typeof r["id"] === "string" && r["id"] ? r["id"].slice(0, 40) : `u${rules.length + 1}`,
        phrase,
        grade: grade as UserTextRule["grade"],
        effect: r["effect"] === "cap" ? "cap" : "set",
      });
    }
  }

  const disabledRules = Array.isArray(raw["disabledRules"])
    ? [
        ...new Set(
          raw["disabledRules"].filter((x): x is string => typeof x === "string").slice(0, 50),
        ),
      ]
    : [];

  return {
    blocks,
    blocksSeen: [...CONTEXT_BLOCK_IDS],
    hiddenFields,
    defaultCond,
    freight,
    rules,
    disabledRules,
  };
}

/** O campo "bloco.campo" está ligado? */
export function fieldOn(cfg: PanelConfig, block: ContextBlockId, key: string): boolean {
  return !cfg.hiddenFields.includes(`${block}.${key}`);
}

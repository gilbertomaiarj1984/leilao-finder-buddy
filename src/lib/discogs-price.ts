/**
 * Preço sugerido do Discogs POR CONDIÇÃO — funções puras (client-safe, testáveis).
 *
 * O endpoint `/marketplace/price_suggestions/{id}` devolve um preço para cada condição (M, NM,
 * VG+, VG, G+, G, F, P), na moeda da conta do token. O app guarda o mapa inteiro e compara o
 * lote com a condição DELE, em vez de sempre com o VG+ (e nunca com o "menor preço global",
 * que é o anúncio mais barato do mundo, de qualquer condição).
 */
import type { Grade } from "./grading";

/** Condições do Discogs, da melhor para a pior. */
const COND_KEYS = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"] as const;
export type CondKey = (typeof COND_KEYS)[number];

/** Preço sugerido (BRL) por condição; só as condições que o Discogs informou. */
export type SuggestionMap = Partial<Record<CondKey, number>>;

/** Condição de referência quando o estado do lote é desconhecido (decisão do usuário: G+). */
const DEFAULT_COND: CondKey = "G+";

const API_NAMES: Record<string, CondKey> = {
  "Mint (M)": "M",
  "Near Mint (NM or M-)": "NM",
  "Very Good Plus (VG+)": "VG+",
  "Very Good (VG)": "VG",
  "Good Plus (G+)": "G+",
  "Good (G)": "G",
  "Fair (F)": "F",
  "Poor (P)": "P",
};

/**
 * Lê a resposta crua de `price_suggestions`. Só aceita valores em BRL: qualquer entrada em
 * outra moeda é descartada (`foreign` = quantas), para nunca tratar dólar como real.
 */
export function parseSuggestionMap(
  raw: Record<string, { value?: number; currency?: string } | undefined> | null | undefined,
): { map: SuggestionMap; foreign: number } {
  const map: SuggestionMap = {};
  let foreign = 0;
  if (!raw || typeof raw !== "object") return { map, foreign };
  for (const [name, s] of Object.entries(raw)) {
    const key = API_NAMES[name];
    if (!key || !s || typeof s.value !== "number" || !Number.isFinite(s.value) || s.value <= 0)
      continue;
    if (s.currency && s.currency !== "BRL") {
      foreign += 1;
      continue;
    }
    map[key] = Math.round(s.value * 100) / 100;
  }
  return { map, foreign };
}

/** Normaliza o que veio do jsonb do banco (qualquer lixo vira `null`). */
export function normalizeSuggestionMap(raw: unknown): SuggestionMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SuggestionMap = {};
  for (const k of COND_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Grau do app (`grading.ts`) → condição do Discogs. EX não existe lá: vale VG+. */
export function gradeToCondKey(grade: Grade | null | undefined): CondKey | null {
  switch (grade) {
    case "M":
      return "M";
    case "NM":
      return "NM";
    case "EX":
    case "VG+":
      return "VG+";
    case "VG":
    case "VG-":
      return "VG";
    case "G+":
      return "G+";
    case "G":
    case "G-":
      return "G";
    case "F/P":
      return "F";
    default:
      return null;
  }
}

export type PriceAnchor = {
  price: number;
  /** Condição do Discogs cujo preço foi usado. */
  condition: CondKey;
  /** true = a condição do lote tinha preço; false = foi a mais próxima (ou o padrão VG+). */
  exact: boolean;
};

/**
 * Âncora de preço para a condição do lote. Sem condição conhecida usa VG+. Se o Discogs não
 * informou aquela condição, usa a mais próxima (empate: a pior, que é a mais conservadora
 * para não chamar de "barato" o que não é).
 */
export function anchorForCondition(
  map: SuggestionMap | null | undefined,
  want: CondKey | null | undefined,
): PriceAnchor | null {
  if (!map) return null;
  const target = want ?? DEFAULT_COND;
  const direct = map[target];
  if (direct !== undefined) return { price: direct, condition: target, exact: want != null };
  const ti = COND_KEYS.indexOf(target);
  let best: { key: CondKey; dist: number } | null = null;
  COND_KEYS.forEach((k, i) => {
    if (map[k] === undefined) return;
    const dist = Math.abs(i - ti);
    if (!best || dist < best.dist || (dist === best.dist && i > COND_KEYS.indexOf(best.key)))
      best = { key: k, dist };
  });
  const b = best as { key: CondKey; dist: number } | null;
  return b ? { price: map[b.key]!, condition: b.key, exact: false } : null;
}

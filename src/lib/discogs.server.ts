/**
 * Integração com o Discogs (âncora de preço/demanda de mercado). Sem SDK oficial — usa
 * `fetch` direto. API gratuita, mas com **rate limit** (60 req/min com token); por isso
 * roda em background no cron, com **throttle** e cache por lote (tabela `lot_market`).
 *
 * As funções puras (buildQuery, pickBestRelease, computeMarketDeal, parsers) são testáveis
 * com `bun -e` sem token. O parsing é DEFENSIVO: os formatos do Discogs variam e campos
 * podem faltar; nunca lançamos por causa de um campo ausente — é tudo best-effort.
 */
import { normalizeForMatch, parsePrice } from "./vinyl-parse";

const BASE = "https://api.discogs.com";
const UA = "GarimpoDeVinil/1.0 (+https://leilao-finder-buddy.vercel.app)";
const CURRENCY = "BRL";
// Intervalo mínimo entre chamadas (60/min = 1/s; usamos folga de ~1.1s).
const MIN_INTERVAL_MS = 1100;

export type MarketData = {
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

export function discogsConfigured(): boolean {
  return Boolean(process.env["DISCOGS_TOKEN"]);
}

// --- Funções puras -----------------------------------------------------------

const LOT_PREFIXES: RegExp[] = [
  /^lote\s*(n?[ºo°]?\s*\d+)?\s*[-:–]?\s*/i,
  /^\d+\s*(lps?|discos?|vinis|compactos?)\b\s*[-:–]?\s*/i,
];

// Sinais de que é coletânea/misto → não vale consultar o Discogs (não casa 1 release).
const MIXED_HINTS = [
  "varios",
  "diversos",
  "coletanea",
  "coletaneas",
  "lote com",
  "lote de",
  "sucessos",
  "seleção",
  "selecao",
];

/**
 * Monta a query de busca. Prefere o `album` identificado pela IA (melhor sinal) e cai no
 * título do lote. Limpa prefixos de "lote". Retorna null quando o texto é claramente
 * coletânea/misto ou curto demais para casar.
 */
export function buildQuery(album: string | null, title: string): string | null {
  const source = (album && album.trim()) || title || "";
  let q = source.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of LOT_PREFIXES) {
      const next = q.replace(re, "");
      if (next !== q) {
        q = next.trim();
        changed = true;
      }
    }
  }
  const norm = normalizeForMatch(q);
  if (norm.length < 4) return null;
  // Se veio do TÍTULO (sem album) e parece coletânea, não consulta.
  if (!(album && album.trim()) && MIXED_HINTS.some((h) => norm.includes(h))) return null;
  return q;
}

type SearchHit = {
  id?: number;
  title?: string;
  year?: number | string;
  format?: string[];
  community?: { have?: number; want?: number };
};

/** Escolhe o melhor release: maior similaridade de tokens com a query, vinil primeiro. */
export function pickBestRelease(query: string, results: SearchHit[]): SearchHit | null {
  const qTokens = new Set(normalizeForMatch(query).split(" ").filter(Boolean));
  if (!qTokens.size || !results?.length) return results?.[0] ?? null;
  let best: SearchHit | null = null;
  let bestScore = -1;
  for (const r of results) {
    const tokens = normalizeForMatch(r.title ?? "")
      .split(" ")
      .filter(Boolean);
    let overlap = 0;
    for (const t of tokens) if (qTokens.has(t)) overlap += 1;
    const isVinyl = (r.format ?? []).some((f) => /vinyl|lp|vinil/i.test(f)) ? 1 : 0;
    const score = overlap * 2 + isVinyl;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

/**
 * Classifica o preço do lote vs. o mercado. Usa o menor preço à venda como âncora
 * principal (mais concreto); cai no sugerido quando não há oferta. "indefinido" sem base.
 */
export function computeMarketDeal(
  lotPriceBRL: number | null,
  lowest: number | null,
  suggested: number | null,
): "barato" | "justo" | "caro" | "indefinido" {
  if (lotPriceBRL === null) return "indefinido";
  const ref = lowest ?? suggested;
  if (ref === null || ref <= 0) return "indefinido";
  if (lotPriceBRL <= ref * 0.7) return "barato";
  if (lotPriceBRL >= ref * 1.15) return "caro";
  return "justo";
}

// Condição de referência para o "preço sugerido" (ordem de preferência).
const PREF_CONDITIONS = [
  "Very Good Plus (VG+)",
  "Near Mint (NM or M-)",
  "Very Good (VG)",
  "Mint (M)",
  "Good Plus (G+)",
  "Good (G)",
];

/** Extrai {price, condition} das sugestões por condição (objeto keyed por condição). */
export function pickSuggested(
  suggestions: Record<string, { value?: number; currency?: string } | undefined> | null,
): { price: number | null; condition: string | null; currency: string | null } {
  if (!suggestions || typeof suggestions !== "object")
    return { price: null, condition: null, currency: null };
  for (const cond of PREF_CONDITIONS) {
    const s = suggestions[cond];
    if (s && typeof s.value === "number")
      return { price: s.value, condition: cond, currency: s.currency ?? null };
  }
  // fallback: primeira condição disponível
  for (const [cond, s] of Object.entries(suggestions)) {
    if (s && typeof s.value === "number")
      return { price: s.value, condition: cond, currency: s.currency ?? null };
  }
  return { price: null, condition: null, currency: null };
}

// --- Rede (throttle + token) -------------------------------------------------

let lastCallAt = 0;

async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function discogsGet(path: string): Promise<unknown | null> {
  const token = process.env["DISCOGS_TOKEN"];
  if (!token) return null;
  await throttle();
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (resp.status === 429) {
    // Rate limit estourou: espera e tenta uma vez.
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!retry.ok) return null;
    return (await retry.json()) as unknown;
  }
  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error(`[discogs] GET ${path} → ${resp.status}`);
    return null;
  }
  return (await resp.json()) as unknown;
}

/**
 * Consulta o Discogs para um lote (≤3 chamadas: search + stats + price_suggestions).
 * Retorna sempre um MarketData (matched=false quando não casou). Best-effort.
 */
export async function fetchMarket(query: string): Promise<MarketData> {
  const empty: MarketData = {
    matched: false,
    releaseId: null,
    releaseTitle: null,
    year: null,
    numForSale: null,
    lowestPrice: null,
    currency: null,
    suggestedPrice: null,
    suggestedCondition: null,
    have: null,
    want: null,
  };

  const search = (await discogsGet(
    `/database/search?type=release&per_page=5&q=${encodeURIComponent(query)}`,
  )) as { results?: SearchHit[] } | null;
  const hit = pickBestRelease(query, search?.results ?? []);
  if (!hit?.id) return empty;

  const releaseId = hit.id;
  const yearNum = Number(hit.year);
  const base: MarketData = {
    ...empty,
    matched: true,
    releaseId,
    releaseTitle: hit.title ?? null,
    year: Number.isFinite(yearNum) && yearNum > 0 ? yearNum : null,
    have: hit.community?.have ?? null,
    want: hit.community?.want ?? null,
  };

  const stats = (await discogsGet(`/marketplace/stats/${releaseId}?curr_abbr=${CURRENCY}`)) as {
    num_for_sale?: number;
    lowest_price?: { value?: number; currency?: string } | null;
  } | null;
  if (stats) {
    base.numForSale = typeof stats.num_for_sale === "number" ? stats.num_for_sale : null;
    if (stats.lowest_price && typeof stats.lowest_price.value === "number") {
      base.lowestPrice = stats.lowest_price.value;
      base.currency = stats.lowest_price.currency ?? CURRENCY;
    }
  }

  const suggestions = (await discogsGet(`/marketplace/price_suggestions/${releaseId}`)) as Record<
    string,
    { value?: number; currency?: string }
  > | null;
  const picked = pickSuggested(suggestions);
  base.suggestedPrice = picked.price;
  base.suggestedCondition = picked.condition;
  if (!base.currency && picked.currency) base.currency = picked.currency;

  return base;
}

/** Conveniência: normaliza o preço BRL do lote para comparação. */
export function lotPriceBRL(price: string): number | null {
  return parsePrice(price);
}

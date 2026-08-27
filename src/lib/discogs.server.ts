/**
 * Integração com o Discogs (âncora de preço/demanda de mercado). Sem SDK oficial — usa
 * `fetch` direto. API gratuita, mas com **rate limit** (60 req/min com token); por isso
 * roda em background no cron, com **throttle** e cache por lote (tabela `lot_market`).
 *
 * As funções puras (buildQuery, pickBestRelease, computeMarketDeal, parsers) são testáveis
 * com `bun -e` sem token. O parsing é DEFENSIVO: os formatos do Discogs variam e campos
 * podem faltar; nunca lançamos por causa de um campo ausente — é tudo best-effort.
 */
import { parse } from "node-html-parser";

import { normalizeForMatch, parsePrice } from "./vinyl-parse";

const BASE = "https://api.discogs.com";
const SITE = "https://www.discogs.com";
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
  // Faixa de preço à venda no Discogs considerando SÓ vendedores do Brasil, com o valor
  // TOTAL (preço + frete exibido) — vendedores costumam mascarar o preço no frete. BRL.
  priceLowBr: number | null; // menor total (preço + frete) entre vendedores BR
  priceHighBr: number | null; // maior total (preço + frete) entre vendedores BR
  numForSaleBr: number | null; // quantidade de anúncios de vendedores BR considerados
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

/** O que a IA identificou, quebrado em artista/álbum/ano para casar melhor no Discogs. */
export type ReleaseTarget = { artist: string | null; title: string | null; year: number | null };

/** Extrai o 1º ano (19xx/20xx) de um texto. */
export function extractYear(text: string): number | null {
  const m = (text ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/**
 * Quebra o `album` da IA ("Artista - Álbum (1970)") em {artista, título, ano}. Tolerante:
 * separa no primeiro travessão/hífen; sem separador, tudo vira título. Remove o "(ano)".
 */
export function parseAlbum(album: string): ReleaseTarget {
  const year = extractYear(album);
  let s = (album ?? "")
    .replace(/\((?:\s*\d{4}\s*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = s.split(/\s[-–—:]\s/);
  if (parts.length >= 2 && parts[0].trim()) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(" - ").trim();
    return { artist: artist || null, title: title || null, year };
  }
  s = s
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { artist: null, title: s || null, year };
}

// Sinais de coletânea/"greatest hits" no título do release (para não casar com elas quando
// o alvo é um álbum de estúdio específico).
const COMP_HINTS = [
  "greatest hits",
  "best of",
  "the best",
  "anthology",
  "collection",
  "compilation",
  "essential",
  "singles",
];
function looksCompilation(title: string, formats: string[]): boolean {
  const t = (title ?? "").toLowerCase();
  if (/\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/.test(t)) return true; // faixa de anos "1967-1970"
  if (COMP_HINTS.some((h) => t.includes(h))) return true;
  return (formats ?? []).some((f) => /comp|compilation/i.test(f));
}

function coverage(targetTokens: string[], resultTokens: Set<string>): number {
  if (!targetTokens.length) return 1;
  let hit = 0;
  for (const t of targetTokens) if (resultTokens.has(t)) hit += 1;
  return hit / targetTokens.length;
}

/**
 * Escolhe o melhor release para o alvo (artista+álbum+ano). Pontua pela **cobertura dos
 * tokens do ÁLBUM** (peso maior) + cobertura do artista + ano + vinil, com **penalidade para
 * coletâneas**. Rejeita (null) quando a cobertura mínima do álbum/artista não é atingida —
 * melhor não casar do que casar com o disco errado (ex.: "Let It Be" vs "1967-1970").
 */
export function pickBestRelease(target: ReleaseTarget, results: SearchHit[]): SearchHit | null {
  if (!results?.length) return null;
  const titleToks = target.title ? normalizeForMatch(target.title).split(" ").filter(Boolean) : [];
  const artistToks = target.artist
    ? normalizeForMatch(target.artist).split(" ").filter(Boolean)
    : [];
  let best: SearchHit | null = null;
  let bestScore = -Infinity;
  let bestTitleCov = 0;
  let bestArtistCov = 0;
  for (const r of results) {
    const rTokens = new Set(
      normalizeForMatch(r.title ?? "")
        .split(" ")
        .filter(Boolean),
    );
    const titleCov = coverage(titleToks, rTokens);
    const artistCov = coverage(artistToks, rTokens);
    const isVinyl = (r.format ?? []).some((f) => /vinyl|lp|vinil/i.test(f)) ? 0.5 : 0;
    const ry = Number(r.year);
    let yearBonus = 0;
    if (target.year && Number.isFinite(ry) && ry > 0) {
      if (ry === target.year) yearBonus = 2;
      else if (Math.abs(ry - target.year) <= 1) yearBonus = 0.5;
      else yearBonus = -1.5;
    }
    let score = titleCov * 5 + artistCov * 3 + isVinyl + yearBonus;
    // Coletânea só é penalizada quando NÃO é exatamente o álbum buscado.
    if (looksCompilation(r.title ?? "", r.format ?? []) && titleCov < 0.999) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = r;
      bestTitleCov = titleCov;
      bestArtistCov = artistCov;
    }
  }
  // Piso de aceitação: o álbum precisa aparecer bem no título e o artista bater.
  if (!best) return null;
  if (titleToks.length && bestTitleCov < 0.6) return null;
  if (artistToks.length && bestArtistCov < 0.5) return null;
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

/**
 * Extrai um valor monetário BRL de um texto do Discogs (ex.: "R$ 1.234,56", "R$45,00").
 * Formato pt-BR: ponto = milhar, vírgula = decimal. Retorna null se não achar número.
 */
export function parseBrMoney(text: string): number | null {
  const m = (text ?? "").match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê o valor de um anúncio: prefere o atributo `data-pricevalue` (número já normalizado
 * pelo próprio Discogs, com ponto decimal), caindo no texto pt-BR visível.
 */
function readMoney(el: {
  getAttribute: (n: string) => string | undefined;
  text: string;
}): number | null {
  const dv = el.getAttribute("data-pricevalue");
  if (dv) {
    const n = Number(dv);
    if (Number.isFinite(n)) return n;
  }
  return parseBrMoney(el.text);
}

export type SellListing = { price: number; shipping: number; total: number };

/**
 * Faz o parsing da página de venda do Discogs (`/sell/release/<id>`), já filtrada por
 * vendedores do Brasil e moeda BRL na URL. Para cada anúncio, soma **preço + frete** (o
 * frete pode não ter valor fixo → conta como 0). Estrutura-resiliente: varre as células
 * `.item_price` e busca `.price`/`.item_shipping` dentro delas.
 */
export function parseSellPage(html: string): SellListing[] {
  const root = parse(html);
  const cells = root.querySelectorAll(".item_price");
  const out: SellListing[] = [];
  for (const cell of cells) {
    const priceEl = cell.querySelector(".price");
    if (!priceEl) continue;
    const price = readMoney(priceEl);
    if (price === null || price <= 0) continue;
    const shipEl = cell.querySelector(".item_shipping");
    const shipping = shipEl ? (readMoney(shipEl) ?? 0) : 0;
    out.push({ price, shipping, total: price + Math.max(0, shipping) });
  }
  return out;
}

/** Menor/maior total (preço + frete) e a contagem de anúncios. */
export function summarizeListings(listings: SellListing[]): {
  low: number | null;
  high: number | null;
  count: number;
} {
  if (!listings.length) return { low: null, high: null, count: 0 };
  let low = Infinity;
  let high = -Infinity;
  for (const l of listings) {
    if (l.total < low) low = l.total;
    if (l.total > high) high = l.total;
  }
  return { low, high, count: listings.length };
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
 * Busca a faixa de preço no MERCADO (página pública `/sell/release/<id>`), filtrando por
 * **vendedores do Brasil** (`ships_from=Brazil`) e **moeda BRL** (`currency=BRL`), ordenado
 * por preço. Considera o TOTAL (preço + frete) de cada anúncio. Sem token (página pública);
 * best-effort — devolve tudo nulo se a página não vier/parsear.
 */
export async function fetchBrListings(
  releaseId: number,
): Promise<{ low: number | null; high: number | null; count: number }> {
  await throttle();
  const url =
    `${SITE}/sell/release/${releaseId}` +
    `?ships_from=Brazil&currency=${CURRENCY}&sort=price%2Casc&limit=100`;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!resp.ok) return { low: null, high: null, count: 0 };
    const html = await resp.text();
    return summarizeListings(parseSellPage(html));
  } catch (e) {
    console.error(`[discogs] sell/release/${releaseId} falhou`, (e as Error)?.message);
    return { low: null, high: null, count: 0 };
  }
}

/**
 * Consulta o Discogs para um lote (≤3 chamadas: search + stats + price_suggestions).
 * Retorna sempre um MarketData (matched=false quando não casou). Best-effort.
 */
async function searchReleases(qs: string): Promise<SearchHit[]> {
  const res = (await discogsGet(`/database/search?${qs}`)) as { results?: SearchHit[] } | null;
  return res?.results ?? [];
}

export async function fetchMarket(album: string | null, title: string): Promise<MarketData> {
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
    priceLowBr: null,
    priceHighBr: null,
    numForSaleBr: null,
  };

  const query = buildQuery(album, title);
  if (!query) return empty;

  // Alvo (artista/álbum/ano) para casar com precisão. Sem album da IA, usa a query como
  // título e tenta o ano do próprio texto do lote.
  const target: ReleaseTarget =
    album && album.trim() ? parseAlbum(album) : { artist: null, title: query, year: null };
  if (target.year == null) target.year = extractYear(title);

  // 1ª tentativa: busca ESTRUTURADA (artista + título do álbum + vinil) — bem mais precisa
  // que texto livre (evita casar "Let It Be" com a coletânea "1967-1970").
  let hit: SearchHit | null = null;
  if (target.artist && target.title) {
    const qs =
      `type=release&format=Vinyl&per_page=25` +
      `&artist=${encodeURIComponent(target.artist)}` +
      `&release_title=${encodeURIComponent(target.title)}`;
    hit = pickBestRelease(target, await searchReleases(qs));
  }
  // 2ª tentativa: texto livre (fallback), ainda pontuado pelo alvo.
  if (!hit?.id) {
    const qs = `type=release&per_page=25&q=${encodeURIComponent(query)}`;
    hit = pickBestRelease(target, await searchReleases(qs));
  }
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

  // Faixa real no mercado (só vendedores BR, total = preço + frete) — scraping da página
  // pública de venda. Best-effort: se não vier, os campos ficam nulos e a UI cai no `stats`.
  const br = await fetchBrListings(releaseId);
  base.priceLowBr = br.low;
  base.priceHighBr = br.high;
  base.numForSaleBr = br.count || null;
  if ((base.priceLowBr ?? base.priceHighBr) !== null) base.currency = CURRENCY;

  return base;
}

/** Conveniência: normaliza o preço BRL do lote para comparação. */
export function lotPriceBRL(price: string): number | null {
  return parsePrice(price);
}

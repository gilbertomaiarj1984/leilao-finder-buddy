/**
 * Integração com o Discogs (âncora de preço/demanda de mercado). Sem SDK oficial — usa
 * `fetch` direto. API gratuita, mas com **rate limit** (60 req/min com token); por isso
 * roda em background no cron, com **throttle** e cache por lote (tabela `lot_market`).
 *
 * As funções puras (buildQuery, pickBestRelease, parsers) são testáveis
 * com `bun -e` sem token. O parsing é DEFENSIVO: os formatos do Discogs variam e campos
 * podem faltar; nunca lançamos por causa de um campo ausente — é tudo best-effort.
 */
import { parse } from "node-html-parser";

import type { DiscCode, DiscogsCodeInfo } from "./disc-code";
import {
  extractYear,
  parseAlbum,
  pickBestRelease,
  toMatchInfo,
  type MatchInfo,
  type ReleaseTarget,
  type SearchHit,
} from "./discogs-match";
import { parseSuggestionMap, type SuggestionMap } from "./discogs-price";
import { parseDiscogsTracklist, type RawTrack } from "./tracklist";
import { isSelfTitledAlbum, normalizeForMatch } from "./vinyl-parse";

const BASE = "https://api.discogs.com";
const SITE = "https://www.discogs.com";
// PUBLIC_BASE_URL é o domínio real no VPS; sem ela (dev local), cai num placeholder
// só como identificação — não afeta nenhuma chamada.
const UA = `GarimpoDeVinil/1.0 (+${process.env["PUBLIC_BASE_URL"] || "https://garimpo.local"})`;
const CURRENCY = "BRL";
// Intervalo mínimo entre chamadas (60/min = 1/s; usamos folga de ~1.1s).
const MIN_INTERVAL_MS = 1100;

type MarketData = {
  matched: boolean;
  releaseId: number | null;
  releaseTitle: string | null;
  year: number | null;
  numForSale: number | null;
  lowestPrice: number | null;
  currency: string | null;
  suggestedPrice: number | null;
  suggestedCondition: string | null;
  // Preço sugerido de TODAS as condições (BRL); o veredicto usa a do lote (ver discogs-price.ts).
  suggestedByCondition: SuggestionMap | null;
  have: number | null;
  want: number | null;
  // Faixa de preço à venda no Discogs considerando SÓ vendedores do Brasil, com o valor
  // TOTAL (preço + frete exibido) — vendedores costumam mascarar o preço no frete. BRL.
  priceLowBr: number | null; // menor total (preço + frete) entre vendedores BR
  priceHighBr: number | null; // maior total (preço + frete) entre vendedores BR
  numForSaleBr: number | null; // quantidade de anúncios de vendedores BR considerados
  /** Evidência do casamento (país, formato, cobertura) para auditar um preço estranho. */
  matchInfo: MatchInfo | null;
  /** Master do release casado (liga o álbum às reedições): 0 = release sem master; null = não casou. */
  masterId: number | null;
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
function buildQuery(album: string | null, title: string): string | null {
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
function pickSuggested(
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
function parseBrMoney(text: string): number | null {
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

type SellListing = { price: number; shipping: number; total: number };

/**
 * Faz o parsing da página de venda do Discogs (`/sell/release/<id>`), já filtrada por
 * vendedores do Brasil e moeda BRL na URL. Para cada anúncio, soma **preço + frete** (o
 * frete pode não ter valor fixo → conta como 0). Estrutura-resiliente: varre as células
 * `.item_price` e busca `.price`/`.item_shipping` dentro delas.
 */
function parseSellPage(html: string): SellListing[] {
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
function summarizeListings(listings: SellListing[]): {
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

// Falhas TRANSITÓRIAS (rede, 429 após a nova tentativa, 5xx, 401/403) são contadas: um 404 é "não
// existe" e pode ser gravado como tal, mas uma falha de rede não — gravar `matched=false` (ou `{}`)
// por causa dela faria o lote nunca mais ser consultado. `fetchMarket` e `fetchSuggestionMap`
// lançam `DiscogsTransientError` quando a contagem sobe durante a chamada.
let transientErrors = 0;

class DiscogsTransientError extends Error {
  constructor() {
    super("Discogs indisponível no momento (erro transitório); nada foi gravado.");
  }
}

async function discogsGet(path: string): Promise<unknown | null> {
  const token = process.env["DISCOGS_TOKEN"];
  if (!token) return null;
  await throttle();
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const headers = { "User-Agent": UA, Accept: "application/json" };
  try {
    let resp = await fetch(url, { headers });
    if (resp.status === 429) {
      // Rate limit estourou: espera e tenta uma vez.
      await new Promise((r) => setTimeout(r, 2000));
      resp = await fetch(url, { headers });
    }
    if (resp.status === 404) return null;
    if (!resp.ok) {
      console.error(`[discogs] GET ${path} → ${resp.status}`);
      transientErrors += 1;
      return null;
    }
    return (await resp.json()) as unknown;
  } catch (error) {
    console.error(`[discogs] GET ${path} falhou`, (error as Error)?.message);
    transientErrors += 1;
    return null;
  }
}

/**
 * Busca a faixa de preço no MERCADO (página pública `/sell/release/<id>`), filtrando por
 * **vendedores do Brasil** (`ships_from=Brazil`) e **moeda BRL** (`currency=BRL`), ordenado
 * por preço. Considera o TOTAL (preço + frete) de cada anúncio. Sem token (página pública);
 * best-effort — devolve tudo nulo se a página não vier/parsear.
 */
// O Discogs serve essa página atrás de Cloudflare: em servidor ela responde 403 de forma
// persistente. Depois do primeiro 403 do processo, para de tentar (cada tentativa custaria um
// intervalo do throttle por lote). Reinicia junto com o app.
let sellPageBlocked = false;

async function fetchBrListings(
  releaseId: number,
): Promise<{ low: number | null; high: number | null; count: number }> {
  if (sellPageBlocked) return { low: null, high: null, count: 0 };
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
    if (resp.status === 403) {
      sellPageBlocked = true;
      console.warn("[discogs] página de venda bloqueada (403/Cloudflare): faixa BR desativada");
    }
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

/**
 * Acha o release do Discogs para o álbum/título (busca estruturada artista+álbum+vinil, depois
 * texto livre; sempre pontuada por `pickBestRelease`). `null` quando não casa com segurança.
 */
async function findRelease(
  album: string | null,
  title: string,
): Promise<{ hit: SearchHit; info: MatchInfo } | null> {
  const query = buildQuery(album, title);
  if (!query) return null;

  // Alvo (artista/álbum/ano) para casar com precisão. Sem album da IA, usa a query como
  // título e tenta o ano do próprio texto do lote.
  const target: ReleaseTarget =
    album && album.trim() ? parseAlbum(album) : { artist: null, title: query, year: null };
  if (target.year == null) target.year = extractYear(title);

  // 1ª tentativa: busca ESTRUTURADA (artista + título do álbum + vinil) — bem mais precisa
  // que texto livre (evita casar "Let It Be" com a coletânea "1967-1970").
  if (target.artist && target.title) {
    const base =
      `type=release&format=Vinyl&per_page=25` +
      `&artist=${encodeURIComponent(target.artist)}` +
      `&release_title=${encodeURIComponent(target.title)}`;
    // Os lotes são de leilões brasileiros, e a prensagem brasileira costuma valer bem menos (ou mais)
    // que a original estrangeira: prefere o release do Brasil quando existe, e só depois a busca
    // sem país.
    const br = pickBestRelease(target, await searchReleases(`${base}&country=Brazil`));
    if (br?.hit.id) return { hit: br.hit, info: toMatchInfo(br, "br") };
    const any = pickBestRelease(target, await searchReleases(base));
    if (any?.hit.id) return { hit: any.hit, info: toMatchInfo(any, "any") };
  }
  // 2ª tentativa: texto livre (fallback), ainda pontuado pelo alvo.
  const free = pickBestRelease(
    target,
    await searchReleases(`type=release&per_page=25&q=${encodeURIComponent(query)}`),
  );
  return free?.hit.id ? { hit: free.hit, info: toMatchInfo(free, "any") } : null;
}

/**
 * Faixas (e lado) de um release do Discogs, na ordem do disco — fonte da `tracklist` do app.
 * Usa o `releaseId` já conhecido (`lot_market`) ou busca pelo álbum. `null` = sem token, sem
 * match ou release sem faixas.
 */
export async function fetchDiscogsTracklist(
  album: string,
  releaseId: number | null = null,
): Promise<RawTrack[] | null> {
  let id = releaseId;
  if (!id) id = (await findRelease(album, album))?.hit.id ?? null;
  if (!id) return null;
  const rel = (await discogsGet(`/releases/${id}`)) as { tracklist?: unknown } | null;
  return parseDiscogsTracklist(rel?.tracklist);
}

/** O Discogs numera artistas homônimos: "Nome (2)" → "Nome". */
function cleanDiscogsArtist(name: string): string {
  return name.replace(/\s*\(\d+\)$/, "").trim();
}

/**
 * Acha o release pelo código impresso: `barcode=` (EAN/UPC) ou `catno=` (nº de catálogo),
 * preferindo vinil. Bem mais certeiro que a busca por nome. `null` sem token ou sem resultado.
 */
export async function findReleaseByCode(code: DiscCode): Promise<DiscogsCodeInfo | null> {
  if (!discogsConfigured()) return null;
  const param = code.kind === "barcode" ? "barcode" : "catno";
  const base = `type=release&per_page=10&${param}=${encodeURIComponent(code.value)}`;
  let hits = await searchReleases(`${base}&format=Vinyl`);
  if (!hits.length) hits = await searchReleases(base);
  const id = hits.find((h) => h.id)?.id;
  if (!id) return null;
  const rel = (await discogsGet(`/releases/${id}`)) as {
    title?: string;
    year?: number;
    artists?: { name?: string }[];
    images?: { uri?: string; type?: string }[];
    tracklist?: unknown;
  } | null;
  if (!rel) return null;
  const artist = (rel.artists ?? [])
    .map((a) => cleanDiscogsArtist(a.name ?? ""))
    .filter(Boolean)
    .join(", ");
  const cover = (rel.images ?? []).find((i) => i.type === "primary")?.uri ?? rel.images?.[0]?.uri;
  return {
    releaseId: id,
    artist,
    album: (rel.title ?? "").trim(),
    year: rel.year && rel.year > 1900 ? rel.year : null,
    cover: cover ?? null,
    tracks: parseDiscogsTracklist(rel.tracklist)?.length ?? 0,
  };
}

export async function fetchMarket(album: string | null, title: string): Promise<MarketData> {
  const before = transientErrors;
  const result = await fetchMarketOnce(album, title);
  if (transientErrors > before) throw new DiscogsTransientError();
  return result;
}

async function fetchMarketOnce(album: string | null, title: string): Promise<MarketData> {
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
    suggestedByCondition: null,
    have: null,
    want: null,
    priceLowBr: null,
    priceHighBr: null,
    numForSaleBr: null,
    matchInfo: null,
    masterId: null,
  };

  const found = await findRelease(album, title);
  const releaseId = found?.hit.id;
  if (!found || !releaseId) return empty;
  const { hit } = found;

  const yearNum = Number(hit.year);
  const base: MarketData = {
    ...empty,
    matched: true,
    releaseId,
    releaseTitle: hit.title ?? null,
    year: Number.isFinite(yearNum) && yearNum > 0 ? yearNum : null,
    have: hit.community?.have ?? null,
    want: hit.community?.want ?? null,
    matchInfo: found.info,
    masterId: hit.master_id && hit.master_id > 0 ? hit.master_id : 0,
  };

  const stats = (await discogsGet(`/marketplace/stats/${releaseId}?curr_abbr=${CURRENCY}`)) as {
    num_for_sale?: number;
    lowest_price?: { value?: number; currency?: string } | null;
  } | null;
  if (stats) {
    base.numForSale = typeof stats.num_for_sale === "number" ? stats.num_for_sale : null;
    // Só aceita BRL: se a API ignorar `curr_abbr` e devolver outra moeda, descarta em vez de
    // gravar dólar como se fosse real (o rótulo de moeda é um só para os dois valores).
    if (stats.lowest_price && typeof stats.lowest_price.value === "number") {
      if ((stats.lowest_price.currency ?? CURRENCY) === CURRENCY) {
        base.lowestPrice = stats.lowest_price.value;
        base.currency = CURRENCY;
      } else {
        console.warn(
          `[discogs] release ${releaseId}: menor preço em ${stats.lowest_price.currency}, ignorado`,
        );
      }
    }
  }

  const suggestions = (await discogsGet(`/marketplace/price_suggestions/${releaseId}`)) as Record<
    string,
    { value?: number; currency?: string }
  > | null;
  const { map, foreign } = parseSuggestionMap(suggestions);
  if (foreign) console.warn(`[discogs] release ${releaseId}: ${foreign} sugestão(ões) fora de BRL`);
  base.suggestedByCondition = Object.keys(map).length ? map : null;
  const picked = pickSuggested(
    suggestions
      ? Object.fromEntries(
          Object.entries(suggestions).filter(([, v]) => !v?.currency || v.currency === CURRENCY),
        )
      : null,
  );
  base.suggestedPrice = picked.price;
  base.suggestedCondition = picked.condition;
  if (!base.currency && picked.price !== null) base.currency = CURRENCY;

  // Faixa real no mercado (só vendedores BR, total = preço + frete) — scraping da página
  // pública de venda. Best-effort: se não vier, os campos ficam nulos e a UI cai no `stats`.
  const br = await fetchBrListings(releaseId);
  base.priceLowBr = br.low;
  base.priceHighBr = br.high;
  base.numForSaleBr = br.count || null;
  if ((base.priceLowBr ?? base.priceHighBr) !== null) base.currency = CURRENCY;

  return base;
}

/**
 * Master do Discogs do álbum (todas as reedições compartilham o master; discos HOMÔNIMOS têm
 * masters diferentes) — usado para separar "outro álbum com o mesmo nome" de "reedição". Busca
 * `type=master` (o `year` do master é o do lançamento ORIGINAL) pontuada por `pickBestRelease`;
 * sem master no resultado, tenta o `master_id` de um release de vinil. `null` quando não casa
 * com segurança — e, para álbum homônimo sem ano, também (adivinhar traria o master errado).
 */
export async function lookupMaster(
  artist: string,
  album: string,
  year: number | null,
): Promise<{ masterId: number; year: number | null } | null> {
  const a = artist.trim();
  const t = album.trim();
  if (!a || !t || !discogsConfigured()) return null;
  if (!year && isSelfTitledAlbum(a, t)) return null;
  const target: ReleaseTarget = { artist: a, title: t, year };
  const qs = `artist=${encodeURIComponent(a)}&release_title=${encodeURIComponent(t)}&per_page=25`;
  const masters = pickBestRelease(target, await searchReleases(`type=master&${qs}`));
  if (masters?.hit.id) {
    const y = Number(masters.hit.year);
    return { masterId: masters.hit.id, year: Number.isFinite(y) && y > 0 ? y : null };
  }
  const release = pickBestRelease(target, await searchReleases(`type=release&format=Vinyl&${qs}`));
  const mid = release?.hit.master_id;
  if (mid && mid > 0) {
    const y = Number(release.hit.year);
    return { masterId: mid, year: Number.isFinite(y) && y > 0 ? y : null };
  }
  return null;
}

/**
 * Só o mapa de sugestões por condição de um release já casado (1 chamada) — usado para
 * preencher linhas antigas de `lot_market` sem refazer a busca/estatísticas.
 */
export async function fetchSuggestionMap(releaseId: number): Promise<SuggestionMap | null> {
  const before = transientErrors;
  const map = await fetchSuggestionMapOnce(releaseId);
  if (transientErrors > before) throw new DiscogsTransientError();
  return map;
}

async function fetchSuggestionMapOnce(releaseId: number): Promise<SuggestionMap | null> {
  const suggestions = (await discogsGet(`/marketplace/price_suggestions/${releaseId}`)) as Record<
    string,
    { value?: number; currency?: string }
  > | null;
  const { map } = parseSuggestionMap(suggestions);
  return Object.keys(map).length ? map : null;
}

// --- Capas (seletor de capa da Coleção) -------------------------------------

export type CoverOption = {
  id: number;
  title: string;
  year: number | null;
  thumb: string;
  cover: string;
};

/** Só aceita imagem servida pelo próprio Discogs (https) — evita SSRF no download da capa. */
export function isDiscogsImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "discogs.com" || u.hostname.endsWith(".discogs.com"))
    );
  } catch {
    return false;
  }
}

/** Transforma os resultados da busca em opções de capa (descarta os sem imagem real). */
export function toCoverOptions(hits: SearchHit[], max = 12): CoverOption[] {
  const out: CoverOption[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const cover = h.cover_image || h.thumb || "";
    if (!h.id || !isDiscogsImageUrl(cover) || /spacer\.gif/i.test(cover) || seen.has(cover))
      continue;
    seen.add(cover);
    const year = Number(h.year);
    out.push({
      id: h.id,
      title: h.title ?? "",
      year: Number.isFinite(year) && year > 0 ? year : null,
      thumb: isDiscogsImageUrl(h.thumb ?? "") ? (h.thumb as string) : cover,
      cover,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Busca releases no Discogs (vinil primeiro, depois texto livre) para o usuário escolher a capa. */
export async function searchCoverOptions(artist: string, album: string): Promise<CoverOption[]> {
  const a = artist.trim();
  const t = album.trim();
  if (!a && !t) return [];
  let hits: SearchHit[] = [];
  if (a && t) {
    hits = await searchReleases(
      `type=release&format=Vinyl&per_page=25&artist=${encodeURIComponent(a)}&release_title=${encodeURIComponent(t)}`,
    );
  }
  if (hits.length < 4) {
    const more = await searchReleases(
      `type=release&per_page=25&q=${encodeURIComponent(`${a} ${t}`.trim())}`,
    );
    hits = [...hits, ...more];
  }
  return toCoverOptions(hits);
}

/** Baixa a imagem escolhida (só hosts do Discogs). Devolve bytes + content-type. */
export async function downloadDiscogsImage(
  url: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (!isDiscogsImageUrl(url)) throw new Error("Imagem inválida (só capas do Discogs).");
  const token = process.env["DISCOGS_TOKEN"];
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "image/*",
      ...(token ? { Authorization: `Discogs token=${token}` } : {}),
    },
  });
  if (!resp.ok) throw new Error(`Não foi possível baixar a capa (${resp.status}).`);
  if (!isDiscogsImageUrl(resp.url || url)) throw new Error("Redirecionamento inválido.");
  const contentType = (resp.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("A resposta não é uma imagem.");
  return { bytes: Buffer.from(await resp.arrayBuffer()), contentType };
}

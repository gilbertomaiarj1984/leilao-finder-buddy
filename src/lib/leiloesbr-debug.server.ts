// Ferramentas de DIAGNÓSTICO do scraping (não persistem nada): localizar um leilão/lote na
// listagem geral, na busca e por categoria, e inspecionar páginas da listagem. Chamadas só pelos
// steps de debug do cron (`step=findlot*`, `step=debuglisting` — ver `cron.server.ts` e
// `.github/workflows/debug-cron.yml`). Separadas de `leiloesbr-scrape.server.ts` para o fluxo
// principal de varredura ficar legível.

import { parse } from "node-html-parser";

import {
  fetchPage,
  fetchPageSearch,
  lastPage,
  listUrlSearch,
  MAX_PAGES,
  parseCard,
  parseCards,
  VINYL_CATEGORY,
  WINDOW_DAYS,
} from "./leiloesbr-scrape.server";
import { looksNonVinyl, upcomingDayKeys, type VinylLot } from "./vinyl-parse";

type FindLotMatch = {
  page: number;
  idLeilao: string;
  house: string;
  title: string;
  dayKey: string;
  url: string;
  wouldKeep: boolean; // passaria no filtro `looksNonVinyl`?
};

/**
 * Diagnóstico: varre TODAS as páginas da listagem geral (mesma categoria travada
 * "Disco de Vinil", sem filtro de dia/`looksNonVinyl`) procurando `query` como
 * idLeilao exato, substring do nome da casa ou substring da URL do lote. Serve para
 * distinguir "o item nem está na categoria vinil da LeilõesBR" (nada a fazer do nosso
 * lado — categorização é da casa/plataforma) de "está na categoria mas o NOSSO
 * parser/filtro descartou" (bug nosso). Não persiste nada.
 */
export async function findLotDebug(query: string): Promise<{
  query: string;
  totalPages: number;
  scannedPages: number;
  failedPages: string[];
  emptyPages: number[];
  matches: FindLotMatch[];
}> {
  const q = query.trim().toLowerCase();
  const firstHtml = await fetchPage(1);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  const failedPages: string[] = [];
  const emptyPages: number[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPage(page);
    } catch (error) {
      failedPages.push(`${page}: ${(error as Error)?.message ?? "falha"}`);
      continue;
    }
    const lots = parseCards(html);
    if (!lots.length) emptyPages.push(page);
    for (const lot of lots) {
      const hit =
        lot.idLeilao === q ||
        lot.house.toLowerCase().includes(q) ||
        lot.url.toLowerCase().includes(q);
      if (!hit) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { query, totalPages: total, scannedPages: scanned, failedPages, emptyPages, matches };
}

/**
 * Diagnóstico nível 2: para o caso em que `findLotDebug` NÃO achou o idLeilao em
 * NENHUMA página da categoria "Disco de Vinil" (mesmo a casa marcando o item como
 * vinil no catálogo DELA — categoria interna da casa, não necessariamente a mesma
 * tag que ela manda pra LeilõesBR). Aqui usamos `pesquisa` (busca por texto livre do
 * próprio site, filtrada no SERVIDOR — mantém o total de páginas viável) e
 * OPCIONALMENTE sem travar `tp=` (categoria), pra achar o mesmo `idLeilao` em
 * QUALQUER categoria. Se achar aqui com `lockToVinyl:false` mas `findLotDebug` não
 * achou nada, confirma que o item está categorizado FORA de "Disco de Vinil" na
 * LeilõesBR (decisão da casa/plataforma, não um bug nosso). Não persiste nada.
 */
export async function findLotSearch(
  idLeilao: string,
  pesquisa: string,
  lockToVinyl: boolean,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  lockToVinyl: boolean;
  totalPages: number;
  scannedPages: number;
  matches: FindLotMatch[];
}> {
  const tp = lockToVinyl ? VINYL_CATEGORY : null;
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    for (const lot of parseCards(html)) {
      if (lot.idLeilao !== idLeilao) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { idLeilao, pesquisa, lockToVinyl, totalPages: total, scannedPages: scanned, matches };
}

/**
 * Diagnóstico nível 3: `findLotSearch` confirmou que um `idLeilao` está na listagem
 * geral (com `pesquisa`, sem travar categoria) mas fora de "Disco de Vinil" — porém
 * `VinylLot`/`parseCard` não capturam NENHUM campo de categoria (não existia motivo
 * até agora). Aqui devolvemos o HTML BRUTO do(s) card(s) que batem o `idLeilao`
 * (truncado, pra não estourar o log) — permite inspecionar visualmente onde/como o
 * site representa a categoria de cada item na listagem geral, sem precisar de
 * acesso de rede/browser no ambiente de dev. Não persiste nada.
 */
export async function findLotRawCard(
  idLeilao: string,
  pesquisa: string,
  lockToVinyl: boolean,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  lockToVinyl: boolean;
  totalPages: number;
  cards: string[];
}> {
  const tp = lockToVinyl ? VINYL_CATEGORY : null;
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const cards: string[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    const root = parse(html);
    for (const card of root.querySelectorAll(".mostbidded .product")) {
      const href = card.querySelector('a[href*="abre_catalogo.asp"]')?.getAttribute("href") ?? "";
      if (!href.includes(`|${idLeilao}|`)) continue;
      cards.push(card.outerHTML.slice(0, 4000));
    }
  }
  return { idLeilao, pesquisa, lockToVinyl, totalPages: total, cards };
}

/**
 * Diagnóstico nível 4: no catálogo PRÓPRIO da casa (fora do escopo da LeilõesBR),
 * "Disco de vinil" filtra por `tipo=|129|` — um CÓDIGO NUMÉRICO local da casa, bem
 * diferente do `tp=|446973636F2064652076696E696C|` (texto "Disco de vinil" em hex)
 * que a LeilõesBR usa na busca geral. Podem ser esquemas de categoria DIFERENTES
 * (numérico por casa vs. texto/hex da plataforma) — aqui testamos um `tp` CRU
 * qualquer (ex.: `|129|`) direto na busca geral da LeilõesBR, pra ver se esse código
 * também filtra por lá e se o `idLeilao` aparece com ele. Não persiste nada.
 */
export async function findLotByCategory(
  idLeilao: string,
  pesquisa: string,
  tp: string,
): Promise<{
  idLeilao: string;
  pesquisa: string;
  tp: string;
  totalPages: number;
  scannedPages: number;
  matches: FindLotMatch[];
}> {
  const firstHtml = await fetchPageSearch(1, pesquisa, tp);
  const total = lastPage(firstHtml);
  const matches: FindLotMatch[] = [];
  let scanned = 0;
  for (let page = total; page >= 1 && scanned < MAX_PAGES; page -= 1) {
    scanned += 1;
    let html: string;
    try {
      html = await fetchPageSearch(page, pesquisa, tp);
    } catch {
      continue;
    }
    for (const lot of parseCards(html)) {
      if (lot.idLeilao !== idLeilao) continue;
      matches.push({
        page,
        idLeilao: lot.idLeilao,
        house: lot.house,
        title: lot.title,
        dayKey: lot.dayKey,
        url: lot.url,
        wouldKeep: !looksNonVinyl(lot.title),
      });
    }
  }
  return { idLeilao, pesquisa, tp, totalPages: total, scannedPages: scanned, matches };
}

/**
 * Diagnóstico por PÁGINA da listagem (`step=pagedebug`, v0.85.1). Achado de produção
 * (2026-09-26, casa "Miss leilões" ausente com 96 lotes no dia): a listagem geral tem 85
 * páginas, mas só 1-2 páginas por chamada de `chunk` rendem lotes — `findlot q=flavia`
 * varreu as 85 páginas em ~3s e não achou NENHUM lote da Flavia Santos (que tem 39 no dia
 * e está na lista de galerias da categoria vinil). `fetchPage`/`parseCards` falham ou vêm
 * vazios em silêncio (`catch { continue }` / `if (!lots.length) continue`). Aqui cada página
 * é buscada com `publicFetchRaw` (sem retry, sem lançar) e devolvemos status HTTP, URL
 * final, tempo, nº de cards/lotes parseados, histograma de dia/casa e, quando não vier
 * card nenhum, um trecho do corpo — pra ver O QUE o site responde. Modos pra testar as
 * hipóteses de uma vez: `cookie=1` (reaproveita o `ASPSESSIONID` da 1ª página, hipótese
 * de paginação por sessão ASP) e `delayMs` (pausa entre páginas, hipótese de limite de
 * taxa). Não persiste nada.
 */
export async function debugListingPages(opts: {
  pages: string;
  ga?: string;
  tp?: string | null;
  pesquisa?: string;
  useCookie?: boolean;
  delayMs?: number;
}): Promise<unknown> {
  const { publicFetchRaw } = await import("./leiloesbr-auth.server");
  const tp = opts.tp === undefined ? VINYL_CATEGORY : opts.tp;
  const pesquisa = opts.pesquisa ?? "";
  const days = upcomingDayKeys(WINDOW_DAYS);
  const windowStart = days[0]!;
  const windowEnd = days[days.length - 1]!;
  const delayMs = Math.min(Math.max(opts.delayMs ?? 0, 0), 5000);

  const first = await publicFetchRaw(listUrlSearch(1, pesquisa, tp, opts.ga));
  const total = lastPage(first.body);
  let cookie = opts.useCookie ? first.cookie : "";

  const wanted = opts.pages
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^last(?:-(\d+))?$/);
      return m ? total - Number(m[1] ?? 0) : Number(p);
    })
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= total)
    .slice(0, 12);

  const describe = (page: number, res: Awaited<ReturnType<typeof publicFetchRaw>>) => {
    const root = parse(res.body);
    const cards = root.querySelectorAll(".mostbidded .product");
    const lots = cards.map(parseCard);
    const parsed = lots.filter((lot): lot is VinylLot => lot !== null);
    const byDay: Record<string, number> = {};
    const byHouse: Record<string, number> = {};
    for (const lot of parsed) {
      byDay[lot.dayKey] = (byDay[lot.dayKey] ?? 0) + 1;
      byHouse[lot.house] = (byHouse[lot.house] ?? 0) + 1;
    }
    const firstUnparsed = cards.find((_, i) => lots[i] === null);
    const bodyText = res.body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      page,
      status: res.status,
      error: res.error,
      finalUrl: res.finalUrl,
      redirected: res.redirected,
      ms: res.ms,
      contentType: res.contentType,
      retryAfter: res.retryAfter,
      server: res.server,
      len: res.body.length,
      htmlTitle: res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
      maxPagLink: lastPage(res.body),
      cards: cards.length,
      parsed: parsed.length,
      unparsed: cards.length - parsed.length,
      inWindow: parsed.filter((l) => l.dayKey >= windowStart && l.dayKey <= windowEnd).length,
      byDay,
      byHouse,
      firstTitle: parsed[0]?.title ?? null,
      firstUnparsedCard: firstUnparsed ? firstUnparsed.outerHTML.slice(0, 1500) : null,
      bodyTextSnippet: cards.length ? null : bodyText.slice(0, 1200),
    };
  };

  const results = [describe(1, first)];
  for (const page of wanted) {
    if (page === 1) continue;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const res = await publicFetchRaw(listUrlSearch(page, pesquisa, tp, opts.ga), {
      cookie: cookie || undefined,
    });
    if (opts.useCookie) cookie = res.cookie;
    results.push(describe(page, res));
  }

  return {
    url1: listUrlSearch(1, pesquisa, tp, opts.ga),
    totalPages: total,
    window: [windowStart, windowEnd],
    useCookie: Boolean(opts.useCookie),
    cookieNames: cookie
      .split("; ")
      .map((c) => c.split("=")[0])
      .filter(Boolean),
    delayMs,
    results,
  };
}

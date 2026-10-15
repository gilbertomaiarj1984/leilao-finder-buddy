import { toLotMarket } from "@/components/vinyl/ai-score-utils";
import { getAnalyticsAliases } from "@/lib/app-state.server";
import type { AnalyticsAliases, SaleRow } from "@/lib/analytics";
import { shiftDayKey } from "@/lib/day-bar";
import { getAllLotAiLean } from "@/lib/lot-ai.server";
import { getAllLotIdent } from "@/lib/lot-ident.server";
import { getAllLotMarket } from "@/lib/lot-market.server";
import { getAllLotSales } from "@/lib/lot-sales.server";
import {
  addLookoutNotified,
  getAllLookout,
  getLookoutArtistGroups,
  getLookoutLinks,
  getLookoutNotified,
  getLookoutSeen,
  type LookoutRow,
} from "@/lib/lookout.server";
import { buildLookoutEmail, type LookoutEmailEntry } from "@/lib/email-templates.server";
import { emailEnabled, sendEmail } from "@/lib/email.server";
import { pushReady, sendPushToAll } from "@/lib/push.server";
import { readLotsRange } from "@/lib/leiloesbr-scrape.server";
import { fetchLotDetails } from "@/lib/leiloesbr-lot-details.server";
import { analyticsHistoryForItems } from "@/lib/lookout-analytics";
import {
  buildLotIdentity,
  lookoutCandidates,
  matchLookoutForLot,
  notifyKey,
  pickNotifiable,
  LOOKOUT_CONFIDENT_MIN,
  type LookoutArtistGroups,
  type LookoutItem,
} from "@/lib/lookout-match";
import { parsePrice, upcomingDayKeys } from "@/lib/vinyl-parse";

/**
 * Cálculo dos matches do "ficar de olho" no SERVIDOR — fonte única da página `/olho`, do
 * contador do menu e do aviso externo (ntfy) do cron. A home calcula o destaque do card por
 * conta própria (já tem as identidades dos lotes na tela) com o MESMO motor (`lookout-match`).
 */

/** Lote futuro que casou com um item de olho, com o necessário para exibir. */
export type LookoutUpcoming = {
  lotId: string;
  itemId: string;
  score: number;
  confirmed: boolean;
  /** Ainda não visto na página `/olho` (alimenta o contador do menu e o selo "novo"). */
  isNew: boolean;
  /** Ids do lote no site (para vigiar direto da página). */
  idPeca: string;
  idLeilao: string;
  base: string;
  title: string;
  image: string | null;
  house: string;
  uf: string;
  dayKey: string;
  time: string;
  url: string;
  lote: string;
  /** Valor atual da listagem (texto BR, ex.: "R$ 70,00") e numérico. */
  price: string;
  priceNum: number | null;
  /** Álbum resolvido pela IA (`lot_ai`/`lot_ident`), quando houver. */
  album: string | null;
  aiScore: number | null;
  /** Faixa de mercado no Brasil (Discogs), quando casada. */
  marketLowBr: number | null;
  marketHighBr: number | null;
  /** Disco de nome genérico cujo ano não deu para validar (usuário valida com ✓/✕). */
  yearPending?: boolean;
  /** É o lote que o usuário marcou (origem do disco): aparece em "por vir", sem aviso nem "novo". */
  isOrigin?: boolean;
};

/**
 * Chave-mestra da função "aparições anteriores também a partir do Analytics" (v0.109.0, ver
 * `lookout-analytics.ts`). `false` = volta ao comportamento anterior (só casamento direto em
 * `lot_sales`); a UI funciona igual com os campos extras ausentes.
 */
const LOOKOUT_HISTORY_FROM_ANALYTICS = true;

/** Aparição passada do disco (venda arquivada em `lot_sales`). */
export type LookoutPastSale = {
  lotId: string;
  itemId: string;
  score: number;
  title: string;
  house: string;
  soldPrice: number | null;
  soldDate: string | null;
  image: string | null;
  /** Grau do disco/capa e link da venda (quando a venda traz) — v0.109.0. */
  media?: string;
  sleeve?: string;
  url?: string;
  /** Veio do casamento direto em `lot_sales` ou do agrupamento curado do Analytics. */
  source?: "direct" | "analytics";
  /**
   * Disco de nome genérico (ex.: homônimo do artista) sem ano que confirme que é ESTE disco: fica
   * "a validar" pelo usuário e não entra na contagem/estatística (v0.111.0).
   */
  pending?: boolean;
};

export type LookoutOverview = {
  items: LookoutRow[];
  upcoming: LookoutUpcoming[];
  history: LookoutPastSale[];
  /** Matches futuros ainda não vistos. */
  newCount: number;
  /** Artistas juntados na página (só exibição). */
  artistGroups: LookoutArtistGroups;
};

function asItems(rows: LookoutRow[]): LookoutItem[] {
  return rows;
}

/**
 * Aparições "a validar" (disco de nome genérico sem ano no título): olha o DESCRITIVO completo do
 * catálogo (`lot_sales.orig_text`, coluna pesada — só dos pendentes, até 300) e, se ele cita o ano
 * do item, confirma. Nunca rejeita por aqui (o texto pode citar outros anos de passagem): o que
 * continuar sem prova fica "a validar" para o usuário.
 */
async function confirmPendingByDescription(
  history: LookoutPastSale[],
  items: LookoutRow[],
): Promise<void> {
  const pending = history.filter((h) => h.pending).slice(0, 300);
  if (!pending.length) return;
  const yearByItem = new Map(items.map((i) => [i.id, i.year]));
  try {
    const rows = await getAllLotSales({ ids: pending.map((h) => h.lotId), withOrig: true });
    const textById = new Map(rows.map((r) => [r.lot_id, r.orig_text ?? ""]));
    for (const h of pending) {
      const year = yearByItem.get(h.itemId);
      const text = textById.get(h.lotId);
      if (year && text && new RegExp(`\\b${year}\\b`).test(text)) h.pending = undefined;
    }
  } catch (error) {
    console.error("[lookout] não foi possível ler os descritivos das vendas a validar", error);
  }
}

/** Teto de lotes por vir consultados ao vivo (1 requisição por lote, 100 por chamada). */
const LIVE_PRICE_MAX = 200;
/** Cache curto do valor ao vivo por lote — evita refazer ~200 requisições a cada abertura da página. */
const LIVE_PRICE_TTL_MS = 3 * 60 * 1000;
const livePriceCache = new Map<string, { at: number; value: string | null }>();

/**
 * Sobrescreve o valor atual dos lotes por vir com o valor AO VIVO do `peca.asp` — o `price` de
 * `lots` vem da varredura geral (cron 3×/dia) e fica defasado (ex.: R$ 35 na varredura, R$ 88 no
 * site). Os mais próximos do pregão vêm primeiro (a lista já está ordenada por dia/hora).
 * Best-effort: lote que falhar mantém o valor da varredura.
 */
async function applyLivePrices(upcoming: LookoutUpcoming[]): Promise<void> {
  const now = Date.now();
  const targets = upcoming
    .filter(
      (u) => u.idPeca && u.url && (livePriceCache.get(u.lotId)?.at ?? 0) + LIVE_PRICE_TTL_MS < now,
    )
    .slice(0, LIVE_PRICE_MAX)
    .map((u) => ({ id: u.lotId, idPeca: u.idPeca, url: u.url }));
  try {
    for (let i = 0; i < targets.length; i += 100) {
      const chunk = targets.slice(i, i + 100);
      const details = await fetchLotDetails(chunk);
      for (const t of chunk) {
        livePriceCache.set(t.id, { at: now, value: details[t.id]?.currentValue ?? null });
      }
    }
  } catch (error) {
    console.error("[lookout] não foi possível ler os valores ao vivo (usando a varredura)", error);
  }
  for (const u of upcoming) {
    const live = livePriceCache.get(u.lotId)?.value;
    const n = live ? parsePrice(live) : null;
    if (live && n != null) {
      u.price = live;
      u.priceNum = n;
    }
  }
}

/**
 * Casa os itens de olho ativos com os lotes por vir (hoje até o fim da retenção) e, se
 * `withHistory`, com as vendas passadas arquivadas. Best-effort por fonte: falha numa leitura
 * auxiliar (aliases, mercado…) degrada o casamento, não derruba.
 */
export async function computeLookout(withHistory = true, live = true): Promise<LookoutOverview> {
  const [items, artistGroups] = await Promise.all([getAllLookout(), getLookoutArtistGroups()]);
  if (!items.some((i) => i.status === "active")) {
    return { items, upcoming: [], history: [], newCount: 0, artistGroups };
  }

  const [fullAliases, links, seen, aiRows, identRows, marketRows] = await Promise.all([
    getAnalyticsAliases().catch(() => ({}) as AnalyticsAliases),
    getLookoutLinks(),
    getLookoutSeen(),
    getAllLotAiLean().catch(() => []),
    getAllLotIdent().catch(() => []),
    getAllLotMarket().catch(() => []),
  ]);
  const aliases: Record<string, string> = fullAliases.artists ?? {};
  // Os candidatos dependem dos apelidos de artista (grafias fundidas no Analytics).
  const aliased = lookoutCandidates(asItems(items), aliases);
  if (!aliased.length) return { items, upcoming: [], history: [], newCount: 0, artistGroups };

  const albumById = new Map<string, string>();
  for (const r of identRows) if (r.album) albumById.set(r.id, r.album);
  for (const r of aiRows) if (r.album) albumById.set(r.id, r.album);
  // Ano da identificação por IA (`lot_ident.year`) — ajuda a validar discos de nome genérico.
  const identYearById = new Map<string, number>();
  for (const r of identRows) if (r.year) identYearById.set(r.id, r.year);
  const scoreById = new Map<string, number | null>();
  for (const r of aiRows) scoreById.set(r.id, r.score);
  const marketById = new Map(
    marketRows.map((r) => [
      r.id,
      toLotMarket({ ...r, price_low_br: r.price_low_br, price_high_br: r.price_high_br }),
    ]),
  );
  const seenSet = new Set(seen);

  const today = upcomingDayKeys(1)[0]!;
  // Sem teto de hoje+14: vigia/lance da conta além da janela também são "por vir" (ficam em
  // `lots` via `ensureAccountLotStubs`; a varredura nunca grava lote futuro além da janela).
  const end = shiftDayKey(today, 365);
  const dbLots = await readLotsRange(today, end, true);
  // Vigiados e lances da conta também entram: lote ainda sem linha em `lots` (casa parceira, ou
  // nunca avaliado pela IA) não pode ficar invisível pro De olho. O de `lots` vence (tem preço
  // da varredura); o resto da conta só conta de hoje em diante.
  const lots = [...dbLots];
  try {
    const { getAccountLots } = await import("./lot-orphan-guard.server");
    const have = new Set(dbLots.map((l) => l.id));
    for (const l of await getAccountLots()) {
      if (!have.has(l.id) && l.dayKey >= today) lots.push(l);
    }
  } catch (error) {
    console.error("[lookout] não foi possível ler vigiados/lances da conta", error);
  }

  const upcoming: LookoutUpcoming[] = [];
  for (const lot of lots) {
    const market = marketById.get(lot.id);
    const identity = buildLotIdentity({
      title: lot.title,
      artist: lot.artist,
      album: albumById.get(lot.id) ?? null,
      marketTitle: market?.releaseTitle ?? null,
      marketYear: market?.year ?? null,
      knownYear: identYearById.get(lot.id) ?? null,
      aliases,
    });
    const hit = matchLookoutForLot(aliased, lot.id, identity, links, {
      includeOrigin: true,
    });
    if (!hit) continue;
    upcoming.push({
      lotId: lot.id,
      itemId: hit.itemId,
      score: hit.score,
      confirmed: hit.confirmed,
      isNew: !hit.isOrigin && !seenSet.has(notifyKey({ lotId: lot.id, itemId: hit.itemId })),
      idPeca: lot.idPeca,
      idLeilao: lot.idLeilao,
      base: lot.base,
      title: lot.title,
      image: lot.image,
      house: lot.house,
      uf: lot.uf,
      dayKey: lot.dayKey,
      time: lot.time,
      url: lot.url,
      lote: lot.lote,
      price: lot.price,
      priceNum: parsePrice(lot.price),
      album: albumById.get(lot.id) ?? null,
      aiScore: scoreById.get(lot.id) ?? null,
      marketLowBr: market?.priceLowBr ?? null,
      marketHighBr: market?.priceHighBr ?? null,
      yearPending: hit.yearPending || undefined,
      isOrigin: hit.isOrigin || undefined,
    });
  }
  upcoming.sort(
    (a, b) => (a.dayKey + a.time).localeCompare(b.dayKey + b.time) || b.score - a.score,
  );
  if (live) await applyLivePrices(upcoming);

  const history: LookoutPastSale[] = [];
  if (withHistory) {
    try {
      const sales = await getAllLotSales({ withOrig: false });
      // Vendas ocultadas no Analytics (por venda) não contam como aparição.
      const hidden = new Set(Object.keys(fullAliases.excludedSales ?? {}));
      for (const s of sales) {
        if (s.bundle || hidden.has(s.lot_id)) continue;
        const identity = buildLotIdentity({
          title: s.title,
          artist: s.artist,
          album: albumById.get(s.lot_id) ?? null,
          knownYear: identYearById.get(s.lot_id) ?? null,
          aliases,
        });
        const hit = matchLookoutForLot(aliased, s.lot_id, identity, links);
        // Casamento incerto só entra quando é por falta de ano num disco de nome genérico ("a
        // validar"); os demais incertos continuam de fora.
        if (!hit || (hit.score < LOOKOUT_CONFIDENT_MIN && !hit.yearPending)) continue;
        history.push({
          lotId: s.lot_id,
          itemId: hit.itemId,
          score: hit.score,
          title: s.title,
          house: s.house,
          soldPrice: s.sold_price != null ? Number(s.sold_price) : null,
          soldDate: s.sold_date,
          image: s.image && s.image.length > 0 ? s.image : null,
          media: s.media || undefined,
          sleeve: s.sleeve || undefined,
          url: s.source_url || undefined,
          source: "direct",
          pending: hit.yearPending || undefined,
        });
      }
      if (LOOKOUT_HISTORY_FROM_ANALYTICS) {
        // Soma o que o Analytics já agrupou/curou; em duplicata (mesmo lote), vale a linha dele.
        const byLot = new Map(history.map((h) => [h.lotId, h]));
        const extra = analyticsHistoryForItems({
          sales: sales as unknown as SaleRow[],
          aliases: fullAliases,
          cands: aliased,
          links,
          yearOf: (lotId) => identYearById.get(lotId) ?? null,
        });
        for (const a of extra) {
          // Se o casamento direto já validou este lote (ano ok), não rebaixa para "a validar".
          const already = byLot.get(a.sale.lot_id);
          const pending = a.pending && (already ? already.pending === true : true);
          byLot.set(a.sale.lot_id, {
            lotId: a.sale.lot_id,
            itemId: a.itemId,
            score: a.score,
            title: a.sale.title,
            house: a.sale.house,
            soldPrice: a.sale.sold_price != null ? Number(a.sale.sold_price) : null,
            soldDate: a.sale.sold_date,
            image: a.sale.image && a.sale.image.length > 0 ? a.sale.image : null,
            media: a.sale.media || undefined,
            sleeve: a.sale.sleeve || undefined,
            url: a.sale.source_url || undefined,
            source: "analytics",
            pending: pending || undefined,
          });
        }
        history.length = 0;
        history.push(...byLot.values());
      }
      await confirmPendingByDescription(history, items);
      history.sort((a, b) => (b.soldDate ?? "").localeCompare(a.soldDate ?? ""));
    } catch (error) {
      console.error("[lookout] não foi possível ler o histórico de vendas (usando vazio)", error);
    }
  }

  return {
    items,
    upcoming,
    history,
    newCount: upcoming.filter((m) => m.isNew).length,
    artistGroups,
  };
}

// ---------------------------------------------------------------------------
// Aviso externo (ntfy.sh e e-mail) — step `lookoutnotify` do cron
// ---------------------------------------------------------------------------

/** Máximo de pushes individuais por rodada; o excedente vira UM resumo (evita inundar o celular). */
const MAX_PUSHES_PER_RUN = 8;

function brl(n: number | null): string {
  return n == null ? "—" : `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/** "2026-10-12" → "12/10". */
function shortDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return m && d ? `${d}/${m}` : dayKey;
}

async function pushNtfy(msg: {
  title: string;
  message: string;
  click?: string;
  priority?: number;
}): Promise<void> {
  const topic = process.env["NTFY_TOPIC"];
  const server = (process.env["NTFY_SERVER"] || "https://ntfy.sh").replace(/\/$/, "");
  // Publicação por JSON (UTF-8): cabeçalhos HTTP não aceitam emoji/acento sem codificação.
  const res = await fetch(server, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      topic,
      title: msg.title,
      message: msg.message,
      click: msg.click,
      tags: ["eyes"],
      priority: msg.priority ?? 3,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy respondeu ${res.status}`);
}

/**
 * Envia a mensagem por todos os canais de push ligados (ntfy e/ou Web Push do PWA). Conta como
 * entregue se ALGUM canal entregou; se todos falharem, lança (o lote volta a ser candidato).
 */
async function pushAll(
  msg: { title: string; message: string; click?: string; priority?: number; tag: string },
  channels: { ntfy: boolean; web: boolean },
): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (channels.ntfy) jobs.push(pushNtfy(msg));
  if (channels.web) {
    jobs.push(
      sendPushToAll({ title: msg.title, body: msg.message, url: "/olho", tag: msg.tag }).then(
        (r) => {
          if (r.sent === 0) throw new Error("nenhum aparelho recebeu o push");
        },
      ),
    );
  }
  const results = await Promise.allSettled(jobs);
  if (!results.some((r) => r.status === "fulfilled")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
}

/**
 * Avisa cada lote NOVO que casa com um "olho" com confiança — uma vez só por (lote × item), com
 * dedupe em `app_state` gravado SÓ depois do envio. Três canais independentes, todos opcionais
 * (sem nenhum configurado é no-op, como a IA sem chaves): push no ntfy e/ou Web Push do PWA (um por lote) e e-mail
 * pelo Gmail (UM com todos os matches da rodada). Um match conta como avisado se QUALQUER canal
 * entregou; falha de canal é best-effort — o lote volta a ser candidato na próxima rodada.
 */
export async function notifyLookoutMatches(): Promise<{
  enabled: boolean;
  matches: number;
  notified: number;
  failed: number;
}> {
  const ntfyOn = Boolean(process.env["NTFY_TOPIC"]);
  const webOn = await pushReady();
  const emailOn = emailEnabled();
  if (!ntfyOn && !webOn && !emailOn) return { enabled: false, matches: 0, notified: 0, failed: 0 };
  const overview = await computeLookout(false);
  const notifiedSet = new Set(await getLookoutNotified());
  // O lote que o próprio usuário marcou (origem) nunca gera aviso.
  const fresh = pickNotifiable(
    overview.upcoming.filter((m) => !m.isOrigin),
    notifiedSet,
  );
  if (!fresh.length) return { enabled: true, matches: 0, notified: 0, failed: 0 };

  const itemById = new Map(overview.items.map((i) => [i.id, i]));
  const base = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
  const page = base ? `${base}/olho` : undefined;
  const byLot = new Map(overview.upcoming.map((m) => [m.lotId, m]));

  const done = new Set<string>();
  let failed = 0;

  if (ntfyOn || webOn) {
    const channels = { ntfy: ntfyOn, web: webOn };
    const individual = fresh.slice(0, MAX_PUSHES_PER_RUN);
    for (const m of individual) {
      const up = byLot.get(m.lotId);
      const item = itemById.get(m.itemId);
      if (!up || !item) continue;
      const label = [item.artist, item.album].filter(Boolean).join(" — ");
      const ceiling = item.maxPrice != null ? ` · teto ${brl(item.maxPrice)}` : "";
      try {
        await pushAll(
          {
            title: `👁 De olho: ${label}`,
            message: `${up.house} · ${shortDay(up.dayKey)}${up.time ? ` ${up.time}` : ""} · atual ${brl(up.priceNum)}${ceiling} · ${Math.round(m.score * 100)}%`,
            click: page,
            priority:
              item.maxPrice != null && up.priceNum != null && up.priceNum <= item.maxPrice ? 4 : 3,
            tag: `lookout-${m.lotId}`,
          },
          channels,
        );
        done.add(notifyKey(m));
      } catch (error) {
        failed++;
        console.error("[lookout] falha ao avisar (push)", error);
      }
    }
    const rest = fresh.slice(MAX_PUSHES_PER_RUN);
    if (rest.length) {
      try {
        await pushAll(
          {
            title: `👁 De olho: +${rest.length} matches`,
            message:
              "Mais lotes casam com os discos que você está de olho — abra a página De olho.",
            click: page,
            tag: "lookout-more",
          },
          channels,
        );
        for (const m of rest) done.add(notifyKey(m));
      } catch (error) {
        failed++;
        console.error("[lookout] falha ao avisar o resumo (push)", error);
      }
    }
  }

  if (emailOn) {
    const entries: LookoutEmailEntry[] = [];
    const keys: string[] = [];
    for (const m of fresh) {
      const up = byLot.get(m.lotId);
      const item = itemById.get(m.itemId);
      if (!up || !item) continue;
      keys.push(notifyKey(m));
      entries.push({
        label: [item.artist, item.album].filter(Boolean).join(" — "),
        house: up.house,
        dayKey: up.dayKey,
        time: up.time,
        lote: up.lote,
        url: up.url,
        price: up.priceNum,
        ceiling: item.maxPrice,
        score: m.score,
        aiScore: up.aiScore,
        rarity: null,
        deal: null,
        marketLow: up.marketLowBr,
        marketHigh: up.marketHighBr,
      });
    }
    if (entries.length) {
      try {
        await sendEmail(buildLookoutEmail(entries, page));
        for (const k of keys) done.add(k);
      } catch (error) {
        failed++;
        console.error("[lookout] falha ao avisar (e-mail)", error);
      }
    }
  }

  await addLookoutNotified([...done]);
  return { enabled: true, matches: fresh.length, notified: done.size, failed };
}

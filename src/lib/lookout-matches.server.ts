import { toLotMarket } from "@/components/vinyl/ai-score-utils";
import { getAnalyticsAliases } from "@/lib/app-state.server";
import { BAR_FORWARD_DAYS, shiftDayKey } from "@/lib/day-bar";
import { getAllLotAi } from "@/lib/lot-ai.server";
import { getAllLotIdent } from "@/lib/lot-ident.server";
import { getAllLotMarket } from "@/lib/lot-market.server";
import { getAllLotSales } from "@/lib/lot-sales.server";
import {
  addLookoutNotified,
  getAllLookout,
  getLookoutLinks,
  getLookoutNotified,
  getLookoutSeen,
  type LookoutRow,
} from "@/lib/lookout.server";
import { readLotsRange } from "@/lib/leiloesbr-scrape.server";
import {
  buildLotIdentity,
  lookoutCandidates,
  matchLookoutForLot,
  notifyKey,
  pickNotifiable,
  LOOKOUT_CONFIDENT_MIN,
  type LookoutItem,
} from "@/lib/lookout-match";
import { auctionFinished, parsePrice, upcomingDayKeys } from "@/lib/vinyl-parse";

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
};

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
};

export type LookoutOverview = {
  items: LookoutRow[];
  upcoming: LookoutUpcoming[];
  history: LookoutPastSale[];
  /** Matches futuros ainda não vistos. */
  newCount: number;
};

function asItems(rows: LookoutRow[]): LookoutItem[] {
  return rows;
}

/**
 * Casa os itens de olho ativos com os lotes por vir (hoje até o fim da retenção) e, se
 * `withHistory`, com as vendas passadas arquivadas. Best-effort por fonte: falha numa leitura
 * auxiliar (aliases, mercado…) degrada o casamento, não derruba.
 */
export async function computeLookout(withHistory = true): Promise<LookoutOverview> {
  const items = await getAllLookout();
  if (!items.some((i) => i.status === "active")) {
    return { items, upcoming: [], history: [], newCount: 0 };
  }

  const [aliases, links, seen, aiRows, identRows, marketRows] = await Promise.all([
    getAnalyticsAliases()
      .then((a) => a.artists)
      .catch(() => ({}) as Record<string, string>),
    getLookoutLinks(),
    getLookoutSeen(),
    getAllLotAi().catch(() => []),
    getAllLotIdent().catch(() => []),
    getAllLotMarket().catch(() => []),
  ]);
  // Os candidatos dependem dos apelidos de artista (grafias fundidas no Analytics).
  const aliased = lookoutCandidates(asItems(items), aliases);
  if (!aliased.length) return { items, upcoming: [], history: [], newCount: 0 };

  const albumById = new Map<string, string>();
  for (const r of identRows) if (r.album) albumById.set(r.id, r.album);
  for (const r of aiRows) if (r.album) albumById.set(r.id, r.album);
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
  const end = shiftDayKey(today, BAR_FORWARD_DAYS - 1);
  const lots = await readLotsRange(today, end);

  const upcoming: LookoutUpcoming[] = [];
  for (const lot of lots) {
    if (lot.dayKey && lot.time && auctionFinished(lot.dayKey, lot.time)) continue;
    const market = marketById.get(lot.id);
    const identity = buildLotIdentity({
      title: lot.title,
      artist: lot.artist,
      album: albumById.get(lot.id) ?? null,
      marketTitle: market?.releaseTitle ?? null,
      marketYear: market?.year ?? null,
      aliases,
    });
    const hit = matchLookoutForLot(aliased, lot.id, identity, links);
    if (!hit) continue;
    upcoming.push({
      lotId: lot.id,
      itemId: hit.itemId,
      score: hit.score,
      confirmed: hit.confirmed,
      isNew: !seenSet.has(notifyKey({ lotId: lot.id, itemId: hit.itemId })),
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
    });
  }
  upcoming.sort(
    (a, b) => (a.dayKey + a.time).localeCompare(b.dayKey + b.time) || b.score - a.score,
  );

  const history: LookoutPastSale[] = [];
  if (withHistory) {
    try {
      const sales = await getAllLotSales({ withOrig: false });
      for (const s of sales) {
        if (s.bundle) continue;
        const identity = buildLotIdentity({
          title: s.title,
          artist: s.artist,
          album: albumById.get(s.lot_id) ?? null,
          aliases,
        });
        const hit = matchLookoutForLot(aliased, s.lot_id, identity, links);
        if (!hit || hit.score < LOOKOUT_CONFIDENT_MIN) continue;
        history.push({
          lotId: s.lot_id,
          itemId: hit.itemId,
          score: hit.score,
          title: s.title,
          house: s.house,
          soldPrice: s.sold_price != null ? Number(s.sold_price) : null,
          soldDate: s.sold_date,
          image: s.image && s.image.length > 0 ? s.image : null,
        });
      }
      history.sort((a, b) => (b.soldDate ?? "").localeCompare(a.soldDate ?? ""));
    } catch (error) {
      console.error("[lookout] não foi possível ler o histórico de vendas (usando vazio)", error);
    }
  }

  return { items, upcoming, history, newCount: upcoming.filter((m) => m.isNew).length };
}

// ---------------------------------------------------------------------------
// Aviso externo (ntfy.sh) — step `lookoutnotify` do cron
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
 * Avisa (push) cada lote NOVO que casa com um "olho" com confiança — uma vez só por
 * (lote × item), com dedupe em `app_state` gravado SÓ depois do envio. Sem `NTFY_TOPIC` é no-op
 * (como a IA sem chaves). Falha do ntfy é best-effort: o lote volta a ser candidato na próxima rodada.
 */
export async function notifyLookoutMatches(): Promise<{
  enabled: boolean;
  matches: number;
  notified: number;
  failed: number;
}> {
  if (!process.env["NTFY_TOPIC"]) return { enabled: false, matches: 0, notified: 0, failed: 0 };
  const overview = await computeLookout(false);
  const notifiedSet = new Set(await getLookoutNotified());
  const fresh = pickNotifiable(overview.upcoming, notifiedSet);
  if (!fresh.length) return { enabled: true, matches: 0, notified: 0, failed: 0 };

  const itemById = new Map(overview.items.map((i) => [i.id, i]));
  const base = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
  const page = base ? `${base}/olho` : undefined;
  const byLot = new Map(overview.upcoming.map((m) => [m.lotId, m]));

  const done: string[] = [];
  let failed = 0;
  const individual = fresh.slice(0, MAX_PUSHES_PER_RUN);
  for (const m of individual) {
    const up = byLot.get(m.lotId);
    const item = itemById.get(m.itemId);
    if (!up || !item) continue;
    const label = [item.artist, item.album].filter(Boolean).join(" — ");
    const ceiling = item.maxPrice != null ? ` · teto ${brl(item.maxPrice)}` : "";
    try {
      await pushNtfy({
        title: `👁 De olho: ${label}`,
        message: `${up.house} · ${shortDay(up.dayKey)}${up.time ? ` ${up.time}` : ""} · atual ${brl(up.priceNum)}${ceiling} · ${Math.round(m.score * 100)}%`,
        click: page,
        priority:
          item.maxPrice != null && up.priceNum != null && up.priceNum <= item.maxPrice ? 4 : 3,
      });
      done.push(notifyKey(m));
    } catch (error) {
      failed++;
      console.error("[lookout] falha ao avisar (ntfy)", error);
    }
  }
  const rest = fresh.slice(MAX_PUSHES_PER_RUN);
  if (rest.length) {
    try {
      await pushNtfy({
        title: `👁 De olho: +${rest.length} matches`,
        message: "Mais lotes casam com os discos que você está de olho — abra a página De olho.",
        click: page,
      });
      done.push(...rest.map(notifyKey));
    } catch (error) {
      failed++;
      console.error("[lookout] falha ao avisar o resumo (ntfy)", error);
    }
  }
  await addLookoutNotified(done);
  return { enabled: true, matches: fresh.length, notified: done.length, failed };
}

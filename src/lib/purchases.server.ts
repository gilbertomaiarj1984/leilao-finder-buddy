import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesInsert } from "@/integrations/supabase/types";

import type { WonLot } from "./leiloesbr-purchases.server";

/**
 * Uma compra (vinil) gravada em `purchases` — espelha a página "Minhas compras" (l=6), mas
 * PERSISTIDA (diferente de Vigia/Lances, que são lidos ao vivo). Alimentada por
 * `syncPurchasesIncremental` (cron + botão "Atualizar"), independente de `collection_items`.
 */
export type Purchase = {
  id: string;
  lotId: string;
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string;
  title: string;
  wonPrice: string;
  wonDate: string | null; // yyyy-mm-dd
  url: string;
  image: string | null;
  house: string;
  uf: string;
  domain: string | null;
  createdAt: string;
};

const COLS =
  "id, lot_id, id_peca, id_leilao, base, lote, title, won_price, won_date, url, image, house, uf, domain, created_at";
const PAGE = 1000;

type DbRow = {
  id: string;
  lot_id: string;
  id_peca: string;
  id_leilao: string;
  base: string;
  lote: string;
  title: string;
  won_price: string;
  won_date: string | null;
  url: string;
  image: string | null;
  house: string;
  uf: string;
  domain: string | null;
  created_at: string;
};

function toPurchase(r: DbRow): Purchase {
  return {
    id: r.id,
    lotId: r.lot_id,
    idPeca: r.id_peca,
    idLeilao: r.id_leilao,
    base: r.base,
    lote: r.lote,
    title: r.title,
    wonPrice: r.won_price,
    wonDate: r.won_date,
    url: r.url,
    image: r.image,
    house: r.house,
    uf: r.uf,
    domain: r.domain,
    createdAt: r.created_at,
  };
}

/** dd/mm/yyyy (site) -> yyyy-mm-dd, ou null quando não casa OU é uma data inválida
 * (mesma validação de `collection.server.ts` — o site traz "00/00/0000" às vezes). */
function brDateToIso(value: string): string | null {
  const m = (value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!day || !month || !year || month > 12 || day > 31 || year < 1900) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) {
    return null;
  }
  return iso;
}

function toRow(w: WonLot): TablesInsert<"purchases"> {
  return {
    lot_id: w.id,
    id_peca: w.idPeca,
    id_leilao: w.idLeilao,
    base: w.base,
    lote: w.lote,
    title: w.title,
    won_price: w.wonPrice,
    won_date: brDateToIso(w.wonDate),
    url: w.url,
    image: w.image,
    house: w.house,
    uf: w.uf,
    domain: w.domain,
  };
}

/** Lê todas as compras gravadas, mais recente primeiro. */
export async function getAllPurchases(): Promise<Purchase[]> {
  const rows: Purchase[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("purchases")
      .select(COLS)
      .order("won_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as DbRow[];
    for (const r of batch) rows.push(toPurchase(r));
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function upsertWonLots(won: WonLot[]): Promise<{ added: number; scanned: number }> {
  if (!won.length) return { added: 0, scanned: 0 };
  const { data: existing, error: readError } = await supabaseAdmin
    .from("purchases")
    .select("lot_id");
  if (readError) throw readError;
  const have = new Set((existing ?? []).map((r) => r.lot_id));
  const payload = won.filter((w) => !have.has(w.id)).map(toRow);
  if (payload.length) {
    const { error } = await supabaseAdmin
      .from("purchases")
      .upsert(payload, { onConflict: "lot_id" });
    if (error) {
      console.error("[purchases] falha ao gravar", error);
      throw new Error(`Não foi possível gravar as compras: ${error.message}`);
    }
  }
  return { added: payload.length, scanned: won.length };
}

/**
 * Varredura INCREMENTAL: descobre os leilões vencidos pelos lances (`l=4`,
 * `wonAuctionIdsFromBids`) e varre só esses (`l=6&id=<idLeilao>`,
 * `listVinylPurchasesForAuctions`) — bem mais barato que repaginar tudo. Idempotente
 * (upsert por `lot_id`), então pode reprocessar leilões já vistos sem duplicar. Usada
 * pelo cron (`step=purchases`) e pelo botão "Atualizar" da página `/compras`.
 */
export async function syncPurchasesIncremental(): Promise<{
  added: number;
  scanned: number;
  auctionsChecked: number;
}> {
  const { listMyBidsFromSite, wonAuctionIdsFromBids } = await import("./leiloesbr-bids.server");
  const { listVinylPurchasesForAuctions } = await import("./leiloesbr-purchases.server");
  const bids = await listMyBidsFromSite().catch(() => []);
  const auctionIds = wonAuctionIdsFromBids(bids);
  if (!auctionIds.length) return { added: 0, scanned: 0, auctionsChecked: 0 };

  const won = await listVinylPurchasesForAuctions(auctionIds);
  const { added, scanned } = await upsertWonLots(won);
  return { added, scanned, auctionsChecked: auctionIds.length };
}

/**
 * Escape hatch manual: varredura COMPLETA (`t=1`+`t=0`, `id=0`, até 50 páginas cada) — cara,
 * NÃO é o caminho do cron. Só para quando um leilão vencido escapou da incremental (ex.:
 * sumiu de `l=4` antes do usuário atualizar).
 */
export async function syncPurchasesFull(): Promise<{ added: number; scanned: number }> {
  const { listVinylPurchases } = await import("./leiloesbr-purchases.server");
  const won = await listVinylPurchases();
  return upsertWonLots(won);
}

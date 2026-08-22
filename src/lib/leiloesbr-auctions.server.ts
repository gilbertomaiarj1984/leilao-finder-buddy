import type { VinylLot } from "./vinyl-parse";

export type LiveAuction = {
  idLeilao: string;
  house: string;
  houseUrl: string | null;
  entryUrl: string | null;
  dayKey: string;
  time: string;
  startsAt: string | null;
  lotCount: number;
  sampleTitles: string[];
  uf: string | null;
};

/** "19:30h" + "2026-08-21" -> ISO instant in São Paulo time (UTC-3). */
export function auctionStartsAt(dayKey: string, time: string): string | null {
  const match = time.match(/(\d{1,2})[:h.]?(\d{2})?/);
  if (!match) return null;
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = (match[2] ?? "00").padStart(2, "0");
  const date = new Date(`${dayKey}T${hh}:${mm}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type Row = {
  id_leilao: string;
  house: string;
  house_url: string | null;
  entry_url: string | null;
  day_key: string;
  start_time: string;
  starts_at: string | null;
  lot_count: number;
  sample_titles: string[];
  uf: string | null;
};

function toAuction(row: Row): LiveAuction {
  return {
    idLeilao: row.id_leilao,
    house: row.house,
    houseUrl: row.house_url,
    entryUrl: row.entry_url,
    dayKey: row.day_key,
    time: row.start_time,
    startsAt: row.starts_at,
    lotCount: row.lot_count,
    sampleTitles: row.sample_titles ?? [],
    uf: row.uf,
  };
}

/** Stores every auction seen in a scrape so it stays reachable after it goes live. */
export async function recordAuctions(lots: VinylLot[]): Promise<void> {
  if (!lots.length) return;
  const byAuction = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const key = lot.idLeilao || lot.id;
    const list = byAuction.get(key);
    if (list) list.push(lot);
    else byAuction.set(key, [lot]);
  }

  const rows = [...byAuction.entries()].map(([idLeilao, group]) => {
    const first = group[0]!;
    return {
      id_leilao: idLeilao,
      house: first.house,
      house_url: first.houseUrl,
      entry_url: first.url,
      day_key: first.dayKey,
      start_time: first.time,
      starts_at: auctionStartsAt(first.dayKey, first.time),
      lot_count: group.length,
      sample_titles: group.slice(0, 4).map((lot) => lot.title),
      uf: first.uf,
      last_seen_at: new Date().toISOString(),
    };
  });

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("seen_auctions").upsert(rows, { onConflict: "id_leilao" });
  } catch (error) {
    console.error("[leiloesbr] falha ao registrar leilões vistos", error);
  }
}

/**
 * Auctions that already started (within the last `windowHours`) and had vinyl lots.
 * They vanish from the public listing once live, so we serve them from history.
 * O site não informa a hora de término, então usamos a janela de horas como
 * regra de finalização (checagem por lote vendido foi removida temporariamente).
 */
export async function listLiveAuctions(windowHours = 3): Promise<LiveAuction[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = Date.now();
    const from = new Date(now - windowHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("seen_auctions")
      .select(
        "id_leilao, house, house_url, entry_url, day_key, start_time, starts_at, lot_count, sample_titles, uf",
      )
      .not("starts_at", "is", null)
      .gte("starts_at", from)
      .lte("starts_at", new Date(now).toISOString())
      .order("starts_at", { ascending: false });
    if (error) throw error;
    return (data as Row[] | null)?.map(toAuction) ?? [];
  } catch (error) {
    console.error("[leiloesbr] falha ao listar leilões ao vivo", error);
    return [];
  }
}

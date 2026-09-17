import { auctionFinished, auctionStarted, presencialUrlFrom, type VinylLot } from "./vinyl-parse";

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

/** Leilão do dia com a URL do pregão presencial e o status derivado do horário. */
export type PresencialAuction = LiveAuction & {
  presencialUrl: string | null;
  status: "upcoming" | "live" | "ended";
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

/** `toAuction` + status derivado do horário + URL do pregão presencial. */
function toPresencialAuction(row: Row, now: number): PresencialAuction {
  const auction = toAuction(row);
  const finished = auctionFinished(auction.dayKey, auction.time, now);
  const started = auctionStarted(auction.dayKey, auction.time, now);
  const status: PresencialAuction["status"] = finished ? "ended" : started ? "live" : "upcoming";
  return { ...auction, presencialUrl: presencialUrlFrom(auction.entryUrl), status };
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
export async function listLiveAuctions(windowHours = 3): Promise<PresencialAuction[]> {
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
    return (data as Row[] | null)?.map((row) => toPresencialAuction(row, now)) ?? [];
  } catch (error) {
    console.error("[leiloesbr] falha ao listar leilões ao vivo", error);
    return [];
  }
}

// Fase 5 da migração para VPS (docs/economia-fase-2-vps-unico.md): `seen_auctions` nunca
// era podada, só cresce. Só removemos leilões cujas vendas JÁ foram capturadas
// (`app_state.sales_captured` — ver `getSalesCaptured` e `captureFinishedSales` em
// `lot-sales.server.ts`), então nunca perdemos o backlog de um leilão ainda pendente; a
// janela de dias é só uma margem de segurança sobre isso, não o critério principal.
const SEEN_AUCTIONS_RETENTION_DAYS = 14;

/**
 * Remove de `seen_auctions` os leilões com vendas já capturadas e mais antigos que
 * `SEEN_AUCTIONS_RETENTION_DAYS`. Best-effort e idempotente — chamado pelo cron
 * (`step=prune`). Nunca mexe em `lots`/`lot_sales`.
 */
export async function pruneSeenAuctions(): Promise<{ pruned: number }> {
  try {
    const { getSalesCaptured } = await import("./app-state.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const captured = await getSalesCaptured();
    if (!captured.size) return { pruned: 0 };

    const cutoff = new Date(Date.now() - SEEN_AUCTIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from("seen_auctions")
      .select("id_leilao")
      .in("id_leilao", [...captured])
      .lt("day_key", cutoff);
    if (error) throw error;
    const ids = (data as { id_leilao: string }[] | null)?.map((r) => r.id_leilao) ?? [];
    if (!ids.length) return { pruned: 0 };

    const { error: delError } = await supabaseAdmin
      .from("seen_auctions")
      .delete()
      .in("id_leilao", ids);
    if (delError) throw delError;
    return { pruned: ids.length };
  } catch (error) {
    console.error("[leiloesbr] não foi possível podar seen_auctions", error);
    return { pruned: 0 };
  }
}

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo — mesmo formato de `day_key`. */
function todayDayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/**
 * Todos os leilões de vinil do DIA (data de hoje em São Paulo), com o link do
 * pregão presencial de cada casa e o status (em breve / ao vivo / encerrado),
 * derivado do horário de início. Best-effort: [] em erro.
 */
export async function listTodayAuctions(): Promise<PresencialAuction[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = todayDayKey();
    const { data, error } = await supabaseAdmin
      .from("seen_auctions")
      .select(
        "id_leilao, house, house_url, entry_url, day_key, start_time, starts_at, lot_count, sample_titles, uf",
      )
      .eq("day_key", today)
      .order("starts_at", { ascending: true });
    if (error) throw error;
    const now = Date.now();
    return (data as Row[] | null)?.map((row) => toPresencialAuction(row, now)) ?? [];
  } catch (error) {
    console.error("[leiloesbr] falha ao listar leilões do dia", error);
    return [];
  }
}

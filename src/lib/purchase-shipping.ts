import { parsePrice } from "@/lib/vinyl-parse";

// Acompanhamento de pagamento/envio das compras POR PREGÃO (`id_leilao`). Módulo puro/client-safe:
// o estado persistido vem de `purchase-shipping.server.ts`; aqui só agrupamento e regras.

export const AUCTION_STATUSES = [
  "aberto",
  "frete",
  "pago",
  "guarda",
  "transito",
  "recebido",
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const STATUS_LABEL: Record<AuctionStatus, string> = {
  aberto: "Em aberto · novo",
  frete: "Em aberto · aguardando frete",
  pago: "Pago · a enviar",
  guarda: "Na guarda",
  transito: "Em trânsito",
  recebido: "Recebido",
};

/** Ainda não pago: "novo" (aberto) ou aguardando o vendedor responder o frete. */
export function isUnpaid(status: AuctionStatus): boolean {
  return status === "aberto" || status === "frete";
}

/** Dias na guarda a partir dos quais o pregão ganha o aviso de prazo. */
export const GUARD_ALERT_DAYS = 15;
/** Taxa (comissão) do leiloeiro somada ao valor arrematado nos totais por casa. */
export const AUCTIONEER_FEE_RATE = 0.05;
/** Frete médio por envio, só para estimar a economia de juntar pregões numa remessa. */
export const REFERENCE_FREIGHT = 38;

export function isAuctionStatus(v: unknown): v is AuctionStatus {
  return typeof v === "string" && (AUCTION_STATUSES as readonly string[]).includes(v);
}

/** Estado gravado de um pregão (ausência de linha = "aberto"). */
export type AuctionState = {
  idLeilao: string;
  status: AuctionStatus;
  paidAt: string | null; // yyyy-mm-dd
  receivedAt: string | null;
  note: string;
  shipmentId: string | null;
};

export type Shipment = {
  id: string;
  house: string;
  freight: number;
  tracking: string;
  createdAt: string;
};

export type ShippingData = { auctions: AuctionState[]; shipments: Shipment[] };

type PurchaseLike = {
  idLeilao: string;
  house: string;
  uf: string;
  wonDate: string | null;
  wonPrice: string;
};

export type PregaoGroup<P extends PurchaseLike> = {
  idLeilao: string;
  house: string;
  uf: string;
  date: string | null;
  purchases: P[];
  total: number;
  state: AuctionState;
  shipment: Shipment | null;
};

function defaultState(idLeilao: string): AuctionState {
  return { idLeilao, status: "aberto", paidAt: null, receivedAt: null, note: "", shipmentId: null };
}

/** Agrupa as compras por pregão, do mais recente ao mais antigo (data, depois id do leilão). */
export function groupByPregao<P extends PurchaseLike>(
  purchases: P[],
  shipping: ShippingData,
): PregaoGroup<P>[] {
  const states = new Map(shipping.auctions.map((a) => [a.idLeilao, a]));
  const shipments = new Map(shipping.shipments.map((s) => [s.id, s]));
  const map = new Map<string, P[]>();
  for (const p of purchases) {
    const list = map.get(p.idLeilao) ?? [];
    list.push(p);
    map.set(p.idLeilao, list);
  }
  const groups: PregaoGroup<P>[] = [];
  for (const [idLeilao, list] of map) {
    const first = list[0]!;
    const dates = list.map((p) => p.wonDate).filter((d): d is string => !!d);
    const state = states.get(idLeilao) ?? defaultState(idLeilao);
    groups.push({
      idLeilao,
      house: first.house,
      uf: first.uf,
      date: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      purchases: list,
      total: list.reduce((s, p) => s + (parsePrice(p.wonPrice) ?? 0), 0),
      state,
      shipment: state.shipmentId ? (shipments.get(state.shipmentId) ?? null) : null,
    });
  }
  return groups.sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      Number(b.idLeilao) - Number(a.idLeilao) ||
      b.idLeilao.localeCompare(a.idLeilao),
  );
}

type StatusSummary = Record<AuctionStatus, { auctions: number; discs: number; total: number }>;

export function summarizeByStatus<P extends PurchaseLike>(groups: PregaoGroup<P>[]): StatusSummary {
  const out = Object.fromEntries(
    AUCTION_STATUSES.map((s) => [s, { auctions: 0, discs: 0, total: 0 }]),
  ) as StatusSummary;
  for (const g of groups) {
    const row = out[g.state.status];
    row.auctions += 1;
    row.discs += g.purchases.length;
    row.total += g.total;
  }
  return out;
}

/** Dias inteiros entre `iso` (yyyy-mm-dd) e `today` (também yyyy-mm-dd). */
export function daysBetween(iso: string, today: string): number {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Dias na guarda, ou null quando o pregão não está na guarda (ou sem data de pagamento). */
export function guardDays(g: { state: AuctionState }, today: string): number | null {
  if (g.state.status !== "guarda" || !g.state.paidAt) return null;
  return daysBetween(g.state.paidAt, today);
}

/** Só pregões "na guarda" da MESMA casa podem seguir juntos numa remessa. */
export function canBundle(groups: { state: AuctionState; house: string }[]): boolean {
  if (!groups.length) return false;
  return groups.every((g) => g.state.status === "guarda" && g.house === groups[0]!.house);
}

/** Status em que pregões da mesma casa podem seguir "juntos" (mesma remessa), arrastando um sobre o outro. */
export const JOINABLE_STATUSES: readonly AuctionStatus[] = ["pago", "transito"];

/** Status que mantêm o vínculo com a remessa (juntos, o status muda para todos de uma vez). */
export const SHIPMENT_STATUSES: readonly AuctionStatus[] = ["pago", "transito", "recebido"];

/** `from` pode ser solto sobre `onto`: casas e status (a enviar/em trânsito) iguais, remessas diferentes. */
export function canJoinShipment(
  from: { idLeilao: string; house: string; state: AuctionState },
  onto: { idLeilao: string; house: string; state: AuctionState },
): boolean {
  if (from.idLeilao === onto.idLeilao) return false;
  if (!from.house || from.house !== onto.house) return false;
  if (from.state.status !== onto.state.status) return false;
  if (!JOINABLE_STATUSES.includes(from.state.status)) return false;
  return !(from.state.shipmentId && from.state.shipmentId === onto.state.shipmentId);
}

/**
 * Pregões "a enviar"/"em trânsito" da mesma remessa viram um bloco (em ordem de entrada, na posição
 * do primeiro membro); os demais seguem soltos. Remessa de um pregão só não vira bloco.
 */
export function bundleShipments<P extends PurchaseLike>(
  groups: PregaoGroup<P>[],
): (
  | { kind: "single"; group: PregaoGroup<P> }
  | { kind: "bundle"; shipment: Shipment; groups: PregaoGroup<P>[] }
)[] {
  const members = new Map<string, PregaoGroup<P>[]>();
  for (const g of groups) {
    if (!g.shipment || !JOINABLE_STATUSES.includes(g.state.status)) continue;
    const key = `${g.shipment.id}|${g.state.status}`;
    members.set(key, [...(members.get(key) ?? []), g]);
  }
  const out: ReturnType<typeof bundleShipments<P>> = [];
  const placed = new Set<string>();
  for (const g of groups) {
    const key = g.shipment ? `${g.shipment.id}|${g.state.status}` : "";
    const list = key ? members.get(key) : undefined;
    if (!list || list.length < 2) {
      out.push({ kind: "single", group: g });
    } else if (!placed.has(key)) {
      placed.add(key);
      out.push({ kind: "bundle", shipment: g.shipment!, groups: list });
    }
  }
  return out;
}

type ShipmentPreview = {
  house: string;
  auctions: number;
  discs: number;
  total: number;
  /** Envios separados evitados ao juntar (n - 1). */
  savedShipments: number;
  estimatedSaving: number;
};

export function previewShipment<P extends PurchaseLike>(
  groups: PregaoGroup<P>[],
  referenceFreight = REFERENCE_FREIGHT,
): ShipmentPreview {
  const saved = Math.max(0, groups.length - 1);
  return {
    house: groups[0]?.house ?? "",
    auctions: groups.length,
    discs: groups.reduce((s, g) => s + g.purchases.length, 0),
    total: groups.reduce((s, g) => s + g.total, 0),
    savedShipments: saved,
    estimatedSaving: saved * referenceFreight,
  };
}

type HouseTotal = {
  house: string;
  auctions: number;
  discs: number;
  subtotal: number;
  fee: number;
  total: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Totais por casa (ordem alfabética) com a taxa do leiloeiro, mais o total geral. */
export function totalsByHouse<P extends PurchaseLike>(
  groups: PregaoGroup<P>[],
  feeRate = AUCTIONEER_FEE_RATE,
): { houses: HouseTotal[]; grand: HouseTotal } {
  const map = new Map<string, HouseTotal>();
  for (const g of groups) {
    const row = map.get(g.house) ?? {
      house: g.house,
      auctions: 0,
      discs: 0,
      subtotal: 0,
      fee: 0,
      total: 0,
    };
    row.auctions += 1;
    row.discs += g.purchases.length;
    row.subtotal += g.total;
    map.set(g.house, row);
  }
  const houses = [...map.values()]
    .map((r) => ({ ...r, subtotal: cents(r.subtotal), fee: cents(r.subtotal * feeRate) }))
    .map((r) => ({ ...r, total: cents(r.subtotal + r.fee) }))
    .sort((a, b) => a.house.localeCompare(b.house, "pt-BR"));
  const grand = houses.reduce<HouseTotal>(
    (acc, r) => ({
      house: "Total geral",
      auctions: acc.auctions + r.auctions,
      discs: acc.discs + r.discs,
      subtotal: cents(acc.subtotal + r.subtotal),
      fee: cents(acc.fee + r.fee),
      total: cents(acc.total + r.total),
    }),
    { house: "Total geral", auctions: 0, discs: 0, subtotal: 0, fee: 0, total: 0 },
  );
  return { houses, grand };
}

/** Pregões agrupados por casa (ordem alfabética), mantendo a ordem de entrada dentro de cada casa. */
export function groupByHouse<P extends PurchaseLike>(
  groups: PregaoGroup<P>[],
): { house: string; groups: PregaoGroup<P>[] }[] {
  const map = new Map<string, PregaoGroup<P>[]>();
  for (const g of groups) map.set(g.house, [...(map.get(g.house) ?? []), g]);
  return [...map.entries()]
    .map(([house, list]) => ({ house, groups: list }))
    .sort((a, b) => a.house.localeCompare(b.house, "pt-BR"));
}

type SpendingRow = {
  /** "2026" (ano), "2026-10" (mês) ou "" (sem data). */
  key: string;
  auctions: number;
  discs: number;
  subtotal: number;
  fee: number;
  total: number;
};

/**
 * Quanto foi gasto por ano ou por mês (data do pregão), do mais recente ao mais antigo, com a
 * taxa do leiloeiro somada, mais o histórico geral. Considera TODOS os pregões (qualquer status).
 */
export function spendingByPeriod<P extends PurchaseLike>(
  groups: PregaoGroup<P>[],
  by: "year" | "month",
  feeRate = AUCTIONEER_FEE_RATE,
): { rows: SpendingRow[]; overall: SpendingRow } {
  const len = by === "year" ? 4 : 7;
  const map = new Map<string, SpendingRow>();
  for (const g of groups) {
    const key = g.date ? g.date.slice(0, len) : "";
    const row = map.get(key) ?? { key, auctions: 0, discs: 0, subtotal: 0, fee: 0, total: 0 };
    row.auctions += 1;
    row.discs += g.purchases.length;
    row.subtotal += g.total;
    map.set(key, row);
  }
  const finish = (r: SpendingRow): SpendingRow => {
    const subtotal = cents(r.subtotal);
    const fee = cents(subtotal * feeRate);
    return { ...r, subtotal, fee, total: cents(subtotal + fee) };
  };
  const rows = [...map.values()].map(finish).sort((a, b) => b.key.localeCompare(a.key));
  const sum = (f: (r: SpendingRow) => number) => cents(rows.reduce((n, r) => n + f(r), 0));
  const overall: SpendingRow = {
    key: "geral",
    auctions: rows.reduce((n, r) => n + r.auctions, 0),
    discs: rows.reduce((n, r) => n + r.discs, 0),
    subtotal: sum((r) => r.subtotal),
    fee: sum((r) => r.fee),
    total: sum((r) => r.total),
  };
  return { rows, overall };
}

import { parsePrice } from "@/lib/vinyl-parse";

// Acompanhamento de pagamento/envio das compras POR PREGÃO (`id_leilao`). Módulo puro/client-safe:
// o estado persistido vem de `purchase-shipping.server.ts`; aqui só agrupamento e regras.

export const AUCTION_STATUSES = ["aberto", "pago", "guarda", "transito", "recebido"] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const STATUS_LABEL: Record<AuctionStatus, string> = {
  aberto: "Em aberto",
  pago: "Pago · a enviar",
  guarda: "Na guarda",
  transito: "Em trânsito",
  recebido: "Recebido",
};

/** Dias na guarda a partir dos quais o pregão ganha o aviso de prazo. */
export const GUARD_ALERT_DAYS = 15;
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

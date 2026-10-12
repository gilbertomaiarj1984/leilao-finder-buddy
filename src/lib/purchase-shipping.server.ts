import { db } from "@/lib/db-client.server";

import {
  isAuctionStatus,
  type AuctionState,
  type AuctionStatus,
  type Shipment,
  type ShippingData,
} from "./purchase-shipping";

type AuctionRow = {
  id_leilao: string;
  status: string;
  paid_at: string | null;
  received_at: string | null;
  note: string;
  shipment_id: string | null;
};
type ShipmentRow = {
  id: string;
  house: string;
  freight: string | number;
  tracking: string;
  created_at: string;
};

const AUCTION_COLS = "id_leilao, status, paid_at, received_at, note, shipment_id";

/** Data de hoje (yyyy-mm-dd) no fuso de Brasília — a data gravada em pago/recebido. */
function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** `date` do Postgres pode vir como Date ou texto, conforme o driver. */
function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toState(r: AuctionRow): AuctionState {
  return {
    idLeilao: r.id_leilao,
    status: isAuctionStatus(r.status) ? r.status : "aberto",
    paidAt: dateOnly(r.paid_at),
    receivedAt: dateOnly(r.received_at),
    note: r.note ?? "",
    shipmentId: r.shipment_id,
  };
}

function toShipment(r: ShipmentRow): Shipment {
  return {
    id: r.id,
    house: r.house,
    freight: Number(r.freight) || 0,
    tracking: r.tracking ?? "",
    createdAt: r.created_at,
  };
}

export async function getShippingData(): Promise<ShippingData> {
  const [a, s] = await Promise.all([
    db.from<AuctionRow>("purchase_auctions").select(AUCTION_COLS),
    db.from<ShipmentRow>("shipments").select("id, house, freight, tracking, created_at"),
  ]);
  if (a.error) throw a.error;
  if (s.error) throw s.error;
  return {
    auctions: (a.data ?? []).map(toState),
    shipments: (s.data ?? []).map(toShipment),
  };
}

async function readState(idLeilao: string): Promise<AuctionState | null> {
  const { data, error } = await db
    .from<AuctionRow>("purchase_auctions")
    .select(AUCTION_COLS)
    .eq("id_leilao", idLeilao);
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? toState(row) : null;
}

/**
 * Muda o status de UM pregão. Datas automáticas: `paid_at` ao sair de "aberto" (mantém a já
 * gravada), `received_at` ao virar "recebido"; voltar a "aberto" limpa pagamento e remessa.
 * Sair de "em trânsito" desvincula a remessa (se ficar órfã, ela é apagada).
 */
export async function setAuctionStatus(idLeilao: string, status: AuctionStatus): Promise<void> {
  const prev = await readState(idLeilao);
  const today = todayIso();
  const paidAt = status === "aberto" ? null : (prev?.paidAt ?? today);
  const receivedAt = status === "recebido" ? (prev?.receivedAt ?? today) : null;
  const keepShipment = status === "transito" || status === "recebido";
  const shipmentId = keepShipment ? (prev?.shipmentId ?? null) : null;
  const { error } = await db.from("purchase_auctions").upsert(
    {
      id_leilao: idLeilao,
      status,
      paid_at: paidAt,
      received_at: receivedAt,
      shipment_id: shipmentId,
      note: prev?.note ?? "",
    },
    { onConflict: "id_leilao" },
  );
  if (error) throw new Error(`Não foi possível salvar o status: ${error.message}`);
  if (prev?.shipmentId && !shipmentId) await deleteOrphanShipment(prev.shipmentId);
}

export async function setAuctionNote(idLeilao: string, note: string): Promise<void> {
  const prev = await readState(idLeilao);
  const { error } = await db.from("purchase_auctions").upsert(
    {
      id_leilao: idLeilao,
      status: prev?.status ?? "aberto",
      paid_at: prev?.paidAt ?? null,
      received_at: prev?.receivedAt ?? null,
      shipment_id: prev?.shipmentId ?? null,
      note: note.slice(0, 500),
    },
    { onConflict: "id_leilao" },
  );
  if (error) throw new Error(`Não foi possível salvar a observação: ${error.message}`);
}

async function deleteOrphanShipment(shipmentId: string): Promise<void> {
  const { data } = await db
    .from<{ id_leilao: string }>("purchase_auctions")
    .select("id_leilao")
    .eq("shipment_id", shipmentId);
  if ((data ?? []).length === 0) await db.from("shipments").delete().eq("id", shipmentId);
}

/**
 * Remessa aprovada: junta pregões "na guarda" da MESMA casa. Valida no servidor (status e casa
 * vêm do banco, não do cliente) e marca todos como "em trânsito" apontando para a remessa.
 */
export async function createShipment(input: {
  idLeiloes: string[];
  freight: number;
  tracking: string;
}): Promise<{ shipmentId: string }> {
  const ids = [...new Set(input.idLeiloes)];
  if (!ids.length) throw new Error("Escolha ao menos um pregão.");

  const [states, purchases] = await Promise.all([
    db.from<AuctionRow>("purchase_auctions").select(AUCTION_COLS).in("id_leilao", ids),
    db
      .from<{ id_leilao: string; house: string }>("purchases")
      .select("id_leilao, house")
      .in("id_leilao", ids),
  ]);
  if (states.error) throw states.error;
  if (purchases.error) throw purchases.error;

  const statusOf = new Map((states.data ?? []).map((r) => [r.id_leilao, r.status]));
  if (!ids.every((id) => statusOf.get(id) === "guarda")) {
    throw new Error('Só pregões "Na guarda" entram numa remessa.');
  }
  const houses = new Set((purchases.data ?? []).map((p) => p.house));
  if (houses.size !== 1) throw new Error("Os pregões da remessa precisam ser da mesma casa.");

  const freight = Number.isFinite(input.freight) && input.freight > 0 ? input.freight : 0;
  const { data: created, error: shipError } = await db
    .from<ShipmentRow>("shipments")
    .insert({ house: [...houses][0]!, freight, tracking: input.tracking.trim().slice(0, 80) })
    .select("id")
    .single();
  if (shipError || !created) {
    throw new Error(`Não foi possível criar a remessa: ${shipError?.message ?? "sem retorno"}`);
  }
  const { error } = await db
    .from("purchase_auctions")
    .update({ status: "transito", shipment_id: created.id })
    .in("id_leilao", ids);
  if (error) {
    await db.from("shipments").delete().eq("id", created.id);
    throw new Error(`Não foi possível iniciar o envio: ${error.message}`);
  }
  return { shipmentId: created.id };
}

/** Atualiza rastreio/frete de uma remessa já criada (ex.: o código só sai depois). */
export async function updateShipment(
  id: string,
  patch: { freight?: number; tracking?: string },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.freight !== undefined && Number.isFinite(patch.freight) && patch.freight >= 0) {
    row["freight"] = patch.freight;
  }
  if (patch.tracking !== undefined) row["tracking"] = patch.tracking.trim().slice(0, 80);
  if (!Object.keys(row).length) return;
  const { error } = await db.from("shipments").update(row).eq("id", id);
  if (error) throw new Error(`Não foi possível salvar a remessa: ${error.message}`);
}

/** Chegou: marca como recebidos todos os pregões da remessa de uma vez. */
export async function markShipmentReceived(shipmentId: string): Promise<void> {
  const { error } = await db
    .from("purchase_auctions")
    .update({ status: "recebido", received_at: todayIso() })
    .eq("shipment_id", shipmentId);
  if (error) throw new Error(`Não foi possível marcar como recebido: ${error.message}`);
}

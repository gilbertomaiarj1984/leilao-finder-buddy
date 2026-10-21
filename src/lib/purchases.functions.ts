import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/lib/auth-middleware";

/** Compras (vinil) gravadas em `purchases`, mais recente primeiro. Best-effort: [] em erro. */
export const getPurchases = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    try {
      const { getAllPurchases } = await import("./purchases.server");
      return await getAllPurchases();
    } catch (error) {
      console.error("[purchases] não foi possível ler", error);
      return [];
    }
  });

/** Botão "Atualizar": dispara a mesma sync incremental do cron (leilões vencidos via `l=4`). */
export const scanPurchases = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { syncPurchasesIncremental } = await import("./purchases.server");
    return await syncPurchasesIncremental();
  });

/** Escape hatch: varredura completa manual de "Minhas compras" — cara, usar com moderação. */
export const scanPurchasesFull = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { assertAllowed } = await import("./access.server");
    assertAllowed(context.claims?.["email"] as string | undefined);
    const { syncPurchasesFull } = await import("./purchases.server");
    return await syncPurchasesFull();
  });

async function guard(context: { claims?: Record<string, unknown> }) {
  const { assertAllowed } = await import("./access.server");
  assertAllowed(context.claims?.["email"] as string | undefined);
}

/** Estado de pagamento/envio por pregão + remessas. Best-effort: vazio em erro. */
export const getPurchaseShipping = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await guard(context);
    try {
      const { getShippingData } = await import("./purchase-shipping.server");
      return await getShippingData();
    } catch (error) {
      console.error("[purchases] não foi possível ler o acompanhamento", error);
      return { auctions: [], shipments: [] };
    }
  });

export const setPregaoStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { idLeilao?: string; status?: string } | undefined) => {
    if (!input?.idLeilao || typeof input.idLeilao !== "string") throw new Error("Pregão inválido.");
    return { idLeilao: input.idLeilao, status: input.status };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { isAuctionStatus } = await import("./purchase-shipping");
    if (!isAuctionStatus(data.status)) throw new Error("Status inválido.");
    const { setAuctionStatus } = await import("./purchase-shipping.server");
    await setAuctionStatus(data.idLeilao, data.status);
  });

export const setPregaoNote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { idLeilao?: string; note?: string } | undefined) => {
    if (!input?.idLeilao || typeof input.idLeilao !== "string") throw new Error("Pregão inválido.");
    return { idLeilao: input.idLeilao, note: typeof input.note === "string" ? input.note : "" };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { setAuctionNote } = await import("./purchase-shipping.server");
    await setAuctionNote(data.idLeilao, data.note);
  });

export const approveShipment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { idLeiloes?: string[]; freight?: number; tracking?: string } | undefined) => {
      if (
        !Array.isArray(input?.idLeiloes) ||
        !input.idLeiloes.every((i) => typeof i === "string")
      ) {
        throw new Error("Pregões inválidos.");
      }
      return {
        idLeiloes: input.idLeiloes,
        freight: Number(input.freight) || 0,
        tracking: typeof input.tracking === "string" ? input.tracking : "",
      };
    },
  )
  .handler(async ({ context, data }) => {
    await guard(context);
    const { createShipment } = await import("./purchase-shipping.server");
    return await createShipment(data);
  });

export const editShipment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id?: string; freight?: number; tracking?: string } | undefined) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("Remessa inválida.");
    return {
      id: input.id,
      freight: typeof input.freight === "number" ? input.freight : undefined,
      tracking: typeof input.tracking === "string" ? input.tracking : undefined,
    };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { updateShipment } = await import("./purchase-shipping.server");
    await updateShipment(data.id, { freight: data.freight, tracking: data.tracking });
  });

export const receiveShipment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { shipmentId?: string } | undefined) => {
    if (!input?.shipmentId || typeof input.shipmentId !== "string")
      throw new Error("Remessa inválida.");
    return { shipmentId: input.shipmentId };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { markShipmentReceived } = await import("./purchase-shipping.server");
    await markShipmentReceived(data.shipmentId);
  });

export const joinPregoes = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { fromId?: string; ontoId?: string } | undefined) => {
    if (!input?.fromId || typeof input.fromId !== "string") throw new Error("Pregão inválido.");
    if (!input.ontoId || typeof input.ontoId !== "string") throw new Error("Pregão inválido.");
    return { fromId: input.fromId, ontoId: input.ontoId };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { joinShipment } = await import("./purchase-shipping.server");
    return await joinShipment(data.fromId, data.ontoId);
  });

export const leavePregaoShipment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { idLeilao?: string } | undefined) => {
    if (!input?.idLeilao || typeof input.idLeilao !== "string") throw new Error("Pregão inválido.");
    return { idLeilao: input.idLeilao };
  })
  .handler(async ({ context, data }) => {
    await guard(context);
    const { leaveShipment } = await import("./purchase-shipping.server");
    await leaveShipment(data.idLeilao);
  });

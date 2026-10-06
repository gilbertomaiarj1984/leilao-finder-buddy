import { describe, expect, test } from "bun:test";

import { lotCardState } from "../src/components/vinyl/mobile/lot-card-state";

const base = { watched: false, price: "R$ 100,00", dayKey: "", time: "", lookoutActive: false };

describe("lotCardState", () => {
  test("lance vence vigia e de olho", () => {
    const s = lotCardState({
      ...base,
      watched: true,
      lookoutActive: true,
      bidStatus: "Vencendo",
      myBid: "R$ 120,00",
    });
    expect(s.tone).toBe("win");
    expect(s.currentPrice).toBe("R$ 120,00");
  });
  test("coberto: valor atual é o da listagem", () => {
    const s = lotCardState({ ...base, bidStatus: "Coberto", myBid: "R$ 90,00" });
    expect(s.tone).toBe("lose");
    expect(s.currentPrice).toBe("R$ 100,00");
  });
  test("vigia vence de olho; de olho; nada", () => {
    expect(lotCardState({ ...base, watched: true, lookoutActive: true }).tone).toBe("watch");
    expect(lotCardState({ ...base, lookoutActive: true }).tone).toBe("eye");
    expect(lotCardState(base).tone).toBe("none");
  });
  test("vendido pelo status do lance; 'Não vendido' nunca marca", () => {
    expect(lotCardState({ ...base, bidStatus: "Coberto e Vendido" }).soldLabel).toBe("Vendido");
    expect(lotCardState({ ...base, bidStatus: "Não vendido" }).soldLabel).toBeUndefined();
  });
  test("leilão que não começou não pode ter lote vendido", () => {
    const s = lotCardState({ ...base, dayKey: "2999-01-01", time: "10:00", sold: "R$ 50,00" });
    expect(s.soldLabel).toBeUndefined();
  });
  test("preço vendido capturado vence o rótulo genérico", () => {
    expect(lotCardState({ ...base, sold: "R$ 50,00", bidStatus: "Vendido" }).soldLabel).toBe(
      "R$ 50,00",
    );
  });
});

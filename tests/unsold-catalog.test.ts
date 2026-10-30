import { describe, expect, test } from "bun:test";

import { catalogLotFromPeca, isUnsoldCatalogLot } from "../src/lib/leiloesbr-catalog.server";

const peca = (extra: Record<string, unknown>) =>
  catalogLotFromPeca({ ID: "1", LOTE: "36", DESCRICAO: "LP Curved Air", ...extra });

describe("isUnsoldCatalogLot", () => {
  test("vendido com valor de venda não é sem lance", () => {
    const lot = peca({ MOSTRABTN_CLASS: "is-vendido", VALOR_VENDA: "45", QTDLANCE: 3 });
    expect(lot.sold).toBe(true);
    expect(isUnsoldCatalogLot(lot)).toBe(false);
  });

  test("vendido com valor de venda vazio (sold=false) continua fora da lista", () => {
    const lot = peca({ MOSTRABTN_CLASS: "is-vendido", VALOR_VENDA: "", QTDLANCE: 0 });
    expect(lot.sold).toBe(false);
    expect(lot.mark).toBe("sold");
    expect(isUnsoldCatalogLot(lot)).toBe(false);
  });

  test("lote com lances e sem marca (venda ainda não registrada) não é sem lance", () => {
    expect(isUnsoldCatalogLot(peca({ MOSTRABTN_CLASS: "is-aberto", QTDLANCE: 2 }))).toBe(false);
    expect(isUnsoldCatalogLot(peca({ QTDLANCE: "4" }))).toBe(false);
  });

  test("lote com lances mesmo marcado não vendido não é sem lance", () => {
    expect(isUnsoldCatalogLot(peca({ MOSTRABTN_CLASS: "is-naovendido", QTDLANCE: 1 }))).toBe(false);
  });

  test("não vendido explícito e sem lances é sem lance", () => {
    expect(isUnsoldCatalogLot(peca({ MOSTRABTN_CLASS: "is-naovendido", QTDLANCE: 0 }))).toBe(true);
    expect(isUnsoldCatalogLot(peca({ MOSTRABTN_CLASS: "is-naovendido" }))).toBe(true);
  });

  test("sem marca, QTDLANCE=0 confirmado é sem lance", () => {
    expect(isUnsoldCatalogLot(peca({ QTDLANCE: 0 }))).toBe(true);
  });

  test("fallback HTML (sem QTDLANCE nem marca) segue como antes: não vendido", () => {
    expect(isUnsoldCatalogLot({ lote: "5", sold: false, soldPrice: null, text: "x" })).toBe(true);
    expect(
      isUnsoldCatalogLot({ lote: "5", sold: false, soldPrice: null, mark: "sold", text: "x" }),
    ).toBe(false);
  });
});

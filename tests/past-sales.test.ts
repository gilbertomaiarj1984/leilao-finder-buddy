import { describe, expect, test } from "bun:test";

import { buildAnalytics, makeSalePlacer, type SaleRow } from "../src/lib/analytics";
import { buildLotContext, contextForPrompt } from "../src/lib/ai-context";
import { buildPastSalesIndex, lookupPastSales, lotAsSale, median } from "../src/lib/past-sales";

const sale = (
  id: string,
  artist: string,
  title: string,
  price: number,
  date: string,
  score: number | null = null,
): SaleRow => ({
  lot_id: id,
  id_leilao: "1",
  id_peca: id,
  artist,
  title,
  sold_price: price,
  sold_price_raw: `R$ ${price}`,
  sold_date: date,
  house: "Casa",
  uf: "SP",
  media: "",
  sleeve: "",
  score,
  faixa: "",
  insert_state: "",
  source_url: "",
});

const rows = [
  sale("a1", "Gilberto Gil", "Gilberto Gil - Raça Humana", 30, "2026-05-01", 60),
  sale("a2", "Gilberto Gil", "Gilberto Gil - Raça Humana", 50, "2026-09-10", 80),
  sale("a3", "Gilberto Gil", "Gilberto Gil - Raça Humana", 90, "2026-07-02", 85),
  sale("b1", "Gilberto Gil", "Gilberto Gil - Refazenda", 70, "2026-06-01", 70),
  sale("c1", "Tim Maia", "Tim Maia - (álbum não identificado)", 10, "2026-06-01"),
];

describe("vendas passadas — comparação com o Analytics", () => {
  test("median", () => {
    expect(median([5])).toBe(5);
    expect(median([1, 9, 5])).toBe(5);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  test("o lote cai no mesmo grupo do Analytics (grafia, caixa e plural não importam)", () => {
    const aliases = {};
    const index = buildPastSalesIndex(buildAnalytics(rows, aliases));
    const place = makeSalePlacer(aliases);
    const lot = lotAsSale(
      { id: "L1", title: "GILBERTO GIL RACA HUMANA LP", artist: "Gilberto Gil" },
      "Gilberto Gil - Raça Humana",
    );
    const got = lookupPastSales(index, place(lot), 82);
    expect(got).toMatchObject({
      artist: "Gilberto Gil",
      album: "Raça Humana",
      count: 3,
      min: 30,
      median: 50,
      max: 90,
    });
    expect(got?.last).toEqual({ price: 50, date: "2026-09-10" }); // a mais recente por data
    expect(got?.similar).toEqual({ count: 2, median: 70 }); // notas 80 e 85 (|Δ| ≤ 12 de 82)
    // as chaves do link são as do grupo mostrado no Analytics
    expect(got?.artistKey).toBe("gilberto gil");
  });

  test("sem grupo, balaio não identificado ou lote sem artista não compara", () => {
    const index = buildPastSalesIndex(buildAnalytics(rows, {}));
    const place = makeSalePlacer({});
    expect(
      lookupPastSales(
        index,
        place(lotAsSale({ id: "L2", title: "Caetano Veloso - Transa", artist: "Caetano Veloso" })),
        null,
      ),
    ).toBeNull();
    expect(
      lookupPastSales(
        index,
        place(lotAsSale({ id: "L3", title: "Tim Maia - Racional", artist: "Tim Maia" })),
        null,
      ),
    ).toBeNull();
    expect(lookupPastSales(index, null, null)).toBeNull();
  });

  test("apelidos do usuário no Analytics valem para a comparação", () => {
    const aliases = { albums: { "gilberto gil|refazenda": "Raça Humana" } }; // funde Refazenda em Raça Humana
    const index = buildPastSalesIndex(buildAnalytics(rows, aliases));
    const lot = lotAsSale(
      { id: "L1", title: "x", artist: "Gilberto Gil" },
      "Gilberto Gil - Raça Humana",
    );
    expect(lookupPastSales(index, makeSalePlacer(aliases)(lot), null)?.count).toBe(4);
  });

  test("venda excluída no Analytics sai da comparação", () => {
    const aliases = { excludedSales: { a3: "Gilberto Gil — Raça Humana" } };
    const index = buildPastSalesIndex(buildAnalytics(rows, aliases));
    const lot = lotAsSale(
      { id: "L1", title: "x", artist: "Gilberto Gil" },
      "Gilberto Gil - Raça Humana",
    );
    const got = lookupPastSales(index, makeSalePlacer(aliases)(lot), null);
    expect(got?.count).toBe(2);
    expect(got?.max).toBe(50);
    expect(got?.similar).toBeNull();
  });

  test("vai ao prompt só com o bloco ligado; a razão usa o preço do lote", () => {
    const index = buildPastSalesIndex(buildAnalytics(rows, {}));
    const lot = lotAsSale(
      { id: "L1", title: "x", artist: "Gilberto Gil" },
      "Gilberto Gil - Raça Humana",
    );
    const ps = lookupPastSales(index, makeSalePlacer({})(lot), null);
    const ctx = buildLotContext({ uf: "SP", pastSales: ps });
    const out = contextForPrompt(ctx, 25);
    expect(out["vendas_passadas_brl"]).toMatchObject({
      n_vendas: 3,
      menor: 30,
      mediana: 50,
      maior: 90,
      ultima_venda: 50,
      ultima_venda_em: "2026-09-10",
      razao_preco_vs_mediana: 0.5,
    });
    expect(
      contextForPrompt(buildLotContext({ uf: "SP" }), 25)["vendas_passadas_brl"],
    ).toBeUndefined();
  });
});

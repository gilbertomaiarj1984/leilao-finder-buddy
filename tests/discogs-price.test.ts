import { describe, expect, test } from "bun:test";

import {
  anchorForCondition,
  gradeToCondKey,
  normalizeSuggestionMap,
  parseSuggestionMap,
} from "../src/lib/discogs-price";
import {
  lotEconomics,
  marketDeal,
  withConditionAnchor,
} from "../src/components/vinyl/ai-score-utils";

const RAW = {
  "Mint (M)": { currency: "BRL", value: 74.0694705 },
  "Near Mint (NM or M-)": { currency: "BRL", value: 66.2726842 },
  "Very Good Plus (VG+)": { currency: "BRL", value: 50.6791114 },
  "Very Good (VG)": { currency: "BRL", value: 35.0855386 },
};

describe("discogs-price — sugerido por condição", () => {
  test("parseSuggestionMap mapeia os nomes do Discogs e arredonda a centavos", () => {
    const { map, foreign } = parseSuggestionMap(RAW);
    expect(map).toEqual({ M: 74.07, NM: 66.27, "VG+": 50.68, VG: 35.09 });
    expect(foreign).toBe(0);
  });

  test("parseSuggestionMap descarta moeda que não é BRL (nunca trata dólar como real)", () => {
    const { map, foreign } = parseSuggestionMap({
      "Mint (M)": { currency: "USD", value: 14 },
      "Very Good Plus (VG+)": { currency: "BRL", value: 50 },
    });
    expect(map).toEqual({ "VG+": 50 });
    expect(foreign).toBe(1);
  });

  test("parseSuggestionMap tolera lixo", () => {
    expect(parseSuggestionMap(null).map).toEqual({});
    expect(parseSuggestionMap({ "Nome Estranho": { value: 5, currency: "BRL" } }).map).toEqual({});
    expect(parseSuggestionMap({ "Mint (M)": { value: -1, currency: "BRL" } }).map).toEqual({});
  });

  test("normalizeSuggestionMap só aceita números positivos das condições conhecidas", () => {
    expect(normalizeSuggestionMap({ NM: 10, X: 3, VG: "5", G: 0 })).toEqual({ NM: 10 });
    expect(normalizeSuggestionMap(null)).toBeNull();
    expect(normalizeSuggestionMap([])).toBeNull();
    expect(normalizeSuggestionMap({})).toBeNull();
  });

  test("gradeToCondKey: EX vale VG+, sinais viram a condição base", () => {
    expect(gradeToCondKey("EX")).toBe("VG+");
    expect(gradeToCondKey("VG-")).toBe("VG");
    expect(gradeToCondKey("G-")).toBe("G");
    expect(gradeToCondKey("F/P")).toBe("F");
    expect(gradeToCondKey(null)).toBeNull();
  });

  test("anchorForCondition usa a condição do lote; sem condição, G+ (não exata)", () => {
    const { map } = parseSuggestionMap({
      ...RAW,
      "Good Plus (G+)": { currency: "BRL", value: 22.4 },
    });
    expect(anchorForCondition(map, "NM")).toEqual({ price: 66.27, condition: "NM", exact: true });
    expect(anchorForCondition(map, null)).toEqual({ price: 22.4, condition: "G+", exact: false });
    // Sem G+ no mapa, cai na mais próxima (VG).
    expect(anchorForCondition(parseSuggestionMap(RAW).map, null)?.condition).toBe("VG");
  });

  test("anchorForCondition cai na condição mais próxima; empate vai para a pior", () => {
    const { map } = parseSuggestionMap(RAW); // M, NM, VG+, VG
    // G+ não existe: VG (distância 1) ganha de VG+ (distância 2).
    expect(anchorForCondition(map, "G+")).toEqual({ price: 35.09, condition: "VG", exact: false });
    // Só M e VG: para VG+ (distância 2 e 1) vence VG; para NM (1 e 2) vence M.
    expect(anchorForCondition({ M: 80, VG: 30 }, "VG+")?.condition).toBe("VG");
    // Empate de distância: NM(1) e VG(1) para VG+ → a pior (VG).
    expect(anchorForCondition({ NM: 70, VG: 30 }, "VG+")?.condition).toBe("VG");
    expect(anchorForCondition(null, "NM")).toBeNull();
    expect(anchorForCondition({}, "NM")).toBeNull();
  });
});

describe("marketDeal — âncora por condição", () => {
  const base = {
    matched: true,
    releaseId: 1,
    releaseTitle: null,
    year: null,
    numForSale: null,
    lowestPrice: 5.6,
    currency: "BRL",
    suggestedPrice: 50,
    suggestedCondition: "Very Good Plus (VG+)",
    suggestedByCondition: { NM: 66, "VG+": 50, VG: 35, "G+": 25 },
    have: null,
    want: null,
    priceLowBr: null,
    priceHighBr: null,
    numForSaleBr: null,
  };

  test("o menor global (R$ 5,60) não ancora mais o veredicto", () => {
    // Antes: qualquer lote acima de R$ 6,44 era "caro" (vs. o menor global de R$ 5,60).
    // Agora a âncora é o sugerido da condição (VG+ = 50) + o frete do vendedor (25) = 75: R$ 60 é justo.
    const vgp = withConditionAnchor(base, "VG+", "SP")!;
    expect(marketDeal("R$ 60,00", vgp)).toBe("justo");
  });

  test("usa a condição do lote: o mesmo preço é barato para um NM e caro para um VG", () => {
    const nm = withConditionAnchor(base, "NM", "SP")!;
    const vg = withConditionAnchor(base, "VG", "SP")!;
    expect(nm.anchor).toEqual({ price: 66, condition: "NM", exact: true });
    expect(marketDeal("R$ 60,00", nm)).toBe("barato"); // 60 <= (66 + 25) × 0,7 = 63,7
    expect(marketDeal("R$ 70,00", vg)).toBe("caro"); // 70 >= (35 + 25) × 1,15 = 69
    expect(marketDeal("R$ 70,00", nm)).toBe("justo");
  });

  test("o frete do Discogs entra na referência: Sudeste R$ 25, fora R$ 35", () => {
    const se = withConditionAnchor(base, "NM", "RJ")!;
    const ne = withConditionAnchor(base, "NM", "BA")!;
    expect(se.freight).toBe(25);
    expect(ne.freight).toBe(35);
    // O lote não leva o frete; a referência leva: 66 + 25 = 91 (limite barato 63,7) e 66 + 35 = 101 (70,7).
    expect(marketDeal("R$ 66,00", se)).toBe("justo");
    expect(marketDeal("R$ 66,00", ne)).toBe("barato");
  });

  test("sem mapa por condição (linha antiga) cai no sugerido, depois no menor global", () => {
    const old = { ...base, suggestedByCondition: null };
    expect(marketDeal("R$ 100,00", old)).toBe("caro"); // 100 >= 50 × 1,15
    expect(marketDeal("R$ 40,00", { ...old, suggestedPrice: null })).toBe("caro"); // vs 5,6
    expect(marketDeal("R$ 40,00", { ...old, matched: false })).toBe("indefinido");
  });

  test("withConditionAnchor aceita a sigla do disco; sem estado usa G+", () => {
    expect(withConditionAnchor(base, "EX")?.anchor?.condition).toBe("VG+");
    expect(withConditionAnchor(base, "xyz")?.anchor).toEqual({
      price: 25,
      condition: "G+",
      exact: false,
    });
    expect(withConditionAnchor(undefined, "NM")).toBeUndefined();
  });
});

describe("selectMarketBackfill", () => {
  test("só pega linhas casadas, com release e sem mapa; {} (sem sugestões) não repete", async () => {
    const { selectMarketBackfill } = await import("../src/lib/lot-market.server");
    const rows = [
      { id: "a", matched: true, release_id: 1, suggested_by_condition: null },
      { id: "b", matched: true, release_id: 2, suggested_by_condition: {} },
      { id: "c", matched: true, release_id: 3, suggested_by_condition: { NM: 5 } },
      { id: "d", matched: false, release_id: null, suggested_by_condition: null },
      { id: "e", matched: true, release_id: 5, suggested_by_condition: null },
    ];
    expect(selectMarketBackfill(rows, 10)).toEqual([
      { id: "a", release_id: 1 },
      { id: "e", release_id: 5 },
    ]);
    expect(selectMarketBackfill(rows, 1)).toEqual([{ id: "a", release_id: 1 }]);
  });
});

describe("lotEconomics — conta do lance", () => {
  const mk = (over: Record<string, unknown>) =>
    ({
      matched: true,
      releaseId: 1,
      releaseTitle: null,
      year: null,
      numForSale: null,
      lowestPrice: null,
      currency: "BRL",
      suggestedPrice: null,
      suggestedCondition: null,
      suggestedByCondition: null,
      anchor: { price: 200, condition: "VG+", exact: true },
      freight: 25,
      have: null,
      want: null,
      priceLowBr: null,
      priceHighBr: null,
      numForSaleBr: null,
      ...over,
    }) as unknown as Parameters<typeof lotEconomics>[1];

  test("o lote vale só o lance; o frete e a comissão ficam à parte e o Discogs leva preço + frete", () => {
    const e = lotEconomics("R$ 150,00", mk({}));
    expect(e.total).toBe(150); // sem frete do leilão
    expect(e.freight).toBe(25); // informativo
    expect(e.commission).toBe(7.5); // 5% do lote, informativo
    expect(e.refShipping).toBe(25);
    expect(e.ref).toBe(225); // 200 do disco + 25 de frete do vendedor
    expect(e.ratio).toBeCloseTo(150 / 225, 5);
    expect(e.deal).toBe("barato"); // 66,7% do mercado (≤ 70%)
    expect(e.potential).toBe(75);
  });
  test("tetos de lance sem frete nem comissão", () => {
    const e = lotEconomics("R$ 100,00", mk({}));
    expect(e.capCheap).toBe(157); // 225 × 0,7
    expect(e.capFair).toBe(258); // < 225 × 1,15 = 258,75
    expect(lotEconomics("R$ 157,00", mk({})).deal).toBe("barato");
    expect(lotEconomics("R$ 158,00", mk({})).deal).toBe("justo");
    expect(lotEconomics("R$ 258,00", mk({})).deal).toBe("justo");
    expect(lotEconomics("R$ 259,00", mk({})).deal).toBe("caro");
  });
  test("faixa BR já é total com frete: não soma frete de novo", () => {
    const e = lotEconomics("R$ 100,00", mk({ anchor: null, priceLowBr: 180 }));
    expect(e.refShipping).toBe(0);
    expect(e.ref).toBe(180);
  });
  test("a comissão não muda o veredicto", () => {
    const withFee = lotEconomics("R$ 157,00", mk({}));
    expect(withFee.deal).toBe("barato");
    expect(withFee.commission).toBeCloseTo(7.85, 5);
  });
  test("sem mercado ou sem preço: indefinido", () => {
    expect(lotEconomics("R$ 100,00", undefined).deal).toBe("indefinido");
    expect(lotEconomics("sem valor", mk({})).total).toBeNull();
    expect(lotEconomics("sem valor", mk({})).commission).toBeNull();
  });
});

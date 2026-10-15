import { describe, expect, test } from "bun:test";

import {
  anchorForCondition,
  gradeToCondKey,
  normalizeSuggestionMap,
  parseSuggestionMap,
} from "../src/lib/discogs-price";
import { marketDeal, withConditionAnchor } from "../src/components/vinyl/ai-score-utils";

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

  test("anchorForCondition usa a condição do lote; sem condição, VG+ (não exata)", () => {
    const { map } = parseSuggestionMap(RAW);
    expect(anchorForCondition(map, "NM")).toEqual({ price: 66.27, condition: "NM", exact: true });
    expect(anchorForCondition(map, null)).toEqual({
      price: 50.68,
      condition: "VG+",
      exact: false,
    });
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
    suggestedByCondition: { NM: 66, "VG+": 50, VG: 35 },
    have: null,
    want: null,
    priceLowBr: null,
    priceHighBr: null,
    numForSaleBr: null,
  };

  test("o menor global (R$ 5,60) não ancora mais o veredicto: lote a R$ 40 é justo, não caro", () => {
    // Antes: 40 >= 5,6 × 1,15 → "caro". Agora a âncora é o sugerido (VG+ = 50).
    expect(marketDeal("R$ 40,00", base)).toBe("justo");
  });

  test("usa a condição do lote: o mesmo preço é barato para um NM e caro para um VG", () => {
    const nm = withConditionAnchor(base, "NM")!;
    const vg = withConditionAnchor(base, "VG")!;
    expect(nm.anchor).toEqual({ price: 66, condition: "NM", exact: true });
    expect(marketDeal("R$ 45,00", nm)).toBe("barato"); // 45 <= 66 × 0,7
    expect(marketDeal("R$ 45,00", vg)).toBe("caro"); // 45 >= 35 × 1,15
  });

  test("sem mapa por condição (linha antiga) cai no sugerido, depois no menor global", () => {
    const old = { ...base, suggestedByCondition: null };
    expect(marketDeal("R$ 100,00", old)).toBe("caro"); // 100 >= 50 × 1,15
    expect(marketDeal("R$ 40,00", { ...old, suggestedPrice: null })).toBe("caro"); // vs 5,6
    expect(marketDeal("R$ 40,00", { ...old, matched: false })).toBe("indefinido");
  });

  test("withConditionAnchor aceita a sigla do disco e ignora lixo", () => {
    expect(withConditionAnchor(base, "EX")?.anchor?.condition).toBe("VG+");
    expect(withConditionAnchor(base, "xyz")?.anchor).toEqual({
      price: 50,
      condition: "VG+",
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

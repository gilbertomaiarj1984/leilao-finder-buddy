import { describe, expect, test } from "bun:test";

import { garimpoIndex, type LotEconomics } from "@/lib/lot-score";

const eco = (ratio: number | null): LotEconomics => ({
  total: 100,
  ref: ratio ? 100 / ratio : null,
  ratio,
  deal: "justo",
  capCheap: null,
  capFair: null,
  potential: null,
});
const base = {
  eco: eco(0.5),
  score: 100,
  conditionScore: 100,
  want: 600,
  have: 100,
  houseLevel: "verde" as const,
  ownedConfident: false,
};

describe("garimpoIndex", () => {
  test("lote perfeito vale 100 e os pesos somam 100", () => {
    const g = garimpoIndex(base);
    expect(g.index).toBe(100);
    expect(g.parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
  });
  test("custo igual ou acima de 115% do mercado zera a parte do negócio", () => {
    const g = garimpoIndex({ ...base, eco: eco(1.15) });
    expect(g.parts.find((p) => p.key === "negocio")?.value).toBe(0);
    expect(g.index).toBe(65);
  });
  test("sem dado a parte fica neutra e marcada como desconhecida", () => {
    const g = garimpoIndex({
      ...base,
      eco: eco(null),
      conditionScore: null,
      want: null,
      houseLevel: null,
    });
    expect(g.parts.filter((p) => !p.known).map((p) => p.key)).toEqual([
      "negocio",
      "estado",
      "procura",
      "casa",
    ]);
    expect(g.index).toBeGreaterThan(0);
    expect(g.index).toBeLessThan(70);
  });
  test("casa vermelha tira os 10 pontos; já tenho corta pela metade", () => {
    expect(garimpoIndex({ ...base, houseLevel: "vermelho" }).index).toBe(90);
    const owned = garimpoIndex({ ...base, ownedConfident: true });
    expect(owned.index).toBe(50);
    expect(owned.ownedPenalty).toBe(true);
  });
  test("procura: 3× ou mais é o máximo", () => {
    const hot = garimpoIndex({ ...base, want: 900, have: 100 }).parts.find(
      (p) => p.key === "procura",
    );
    expect(hot?.value).toBe(1);
    const cold = garimpoIndex({ ...base, want: 50, have: 100 }).parts.find(
      (p) => p.key === "procura",
    );
    expect(cold!.value).toBeLessThan(0.2);
  });
});

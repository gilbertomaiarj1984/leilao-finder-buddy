import { describe, expect, test } from "bun:test";

import {
  buildRanking,
  fameFromRank,
  fameFromRanking,
  normTitle,
} from "../src/lib/track-popularity";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Musica ${i}`, listens: 100000 - i * 100 }));

describe("normTitle", () => {
  test("ignora acento, caixa, pontuação, parênteses e ' e '", () => {
    expect(normTitle("Com Açúcar e com Afeto")).toBe(normTitle("Com açúcar, com afeto"));
    expect(normTitle("Quem te viu, quem te vê (Ao Vivo)")).toBe("quem te viu quem te ve");
  });
});

describe("buildRanking", () => {
  test("soma gravações da mesma música e ordena", () => {
    const r = buildRanking([
      ...many(12),
      { name: "Musica 5", listens: 500000 },
      { name: "música 5 (ao vivo)", listens: 1 },
    ])!;
    expect(r.ranks.get("musica 5")).toBe(1);
    expect(r.total).toBe(12);
  });
  test("dado fraco devolve null", () => {
    expect(buildRanking(many(5))).toBeNull();
    expect(buildRanking(many(20).map((x) => ({ ...x, listens: 10 })))).toBeNull();
  });
});

describe("fameFromRank", () => {
  test("obra grande: teto de 40 verdes e 150 amarelas", () => {
    expect(fameFromRank(40, 516)).toBe("alta");
    expect(fameFromRank(41, 516)).toBe("media");
    expect(fameFromRank(150, 516)).toBe("media");
    expect(fameFromRank(151, 516)).toBe("baixa");
  });
  test("obra pequena: proporcional", () => {
    expect(fameFromRank(1, 20)).toBe("alta");
    expect(fameFromRank(5, 20)).toBe("media");
    expect(fameFromRank(20, 20)).toBe("baixa");
  });
});

describe("fameFromRanking", () => {
  test("null onde o título não está no ranking", () => {
    const r = buildRanking(many(30))!;
    expect(fameFromRanking([{ title: "Musica 0" }, { title: "Outra" }], r)).toEqual(["alta", null]);
  });
});

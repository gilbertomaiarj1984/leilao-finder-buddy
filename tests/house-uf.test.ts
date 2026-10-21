import { describe, expect, test } from "bun:test";

import { pickHouseUfs } from "@/lib/house-uf";

describe("pickHouseUfs", () => {
  test("usa a UF mais frequente da casa, com chave normalizada", () => {
    const got = pickHouseUfs([
      { house: "Casa Alfa Leilões", uf: "sp", n: 40 },
      { house: "Casa Alfa Leilões", uf: "RJ", n: 2 },
      { house: "Beta  Leilões", uf: "RJ", n: 5 },
    ]);
    expect(got["casa alfa leiloes"]).toBe("SP");
    expect(got["beta leiloes"]).toBe("RJ");
  });
  test("ignora UF vazia/inválida e casa sem nome", () => {
    expect(
      pickHouseUfs([
        { house: "Gama", uf: "", n: 3 },
        { house: "Gama", uf: "São Paulo", n: 9 },
        { house: "", uf: "SP", n: 1 },
      ]),
    ).toEqual({});
  });
});

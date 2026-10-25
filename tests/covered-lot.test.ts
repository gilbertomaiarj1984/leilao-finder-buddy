import { describe, expect, test } from "bun:test";

import { formatCoveredLot, formatCoveredWhere } from "../src/components/vinyl/ai-score-utils";

describe("formatCoveredLot", () => {
  test("lote + artista + álbum, sem o ano", () => {
    expect(formatCoveredLot({ lote: "12", title: "LP x" }, "pink floyd - The Wall (1979)")).toBe(
      "Lote 12 — Pink Floyd — The Wall",
    );
  });
  test("sem álbum da IA cai no título do lance", () => {
    expect(formatCoveredLot({ lote: "7", title: " LP Raul Seixas " }, null)).toBe(
      "Lote 7 — LP Raul Seixas",
    );
  });
  test("sem nº de lote omite o prefixo", () => {
    expect(formatCoveredLot({ lote: "", title: "LP y" }, null)).toBe("LP y");
  });
});

describe("formatCoveredWhere", () => {
  test("dia da semana, data, casa e leilão", () => {
    expect(formatCoveredWhere({ date: "25/10/2026", house: " Casa X ", idLeilao: "1234" })).toBe(
      "dom 25/10/2026 · Casa X · leilão 1234",
    );
  });

  test("data fora do formato e leilão vazio são omitidos", () => {
    expect(formatCoveredWhere({ date: "", house: "Casa X", idLeilao: "" })).toBe("Casa X");
    expect(formatCoveredWhere({ date: "hoje", house: "Casa X", idLeilao: "9" })).toBe(
      "Casa X · leilão 9",
    );
  });
});

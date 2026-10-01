import { describe, expect, test } from "bun:test";

import { formatCoveredLot } from "../src/components/vinyl/ai-score-utils";

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

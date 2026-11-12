import { describe, expect, test } from "bun:test";

import {
  formatDayList,
  formatHouseList,
  formatListEntry,
  priceLabel,
  shortNote,
  splitArtistAlbum,
  type HouseListEntry,
} from "../src/lib/house-lot-list";

const base: HouseListEntry = {
  lote: "12",
  artist: "Djavan",
  album: "Luz (1982)",
  nextBid: "",
  price: "R$ 80,00",
  noBid: false,
  condition: "Disco VG+ · Capa VG",
  note: "Prensagem original",
};

describe("house-lot-list", () => {
  test("sem lance avisa e usa o valor do primeiro lance", () => {
    expect(priceLabel({ nextBid: "", price: "R$ 50,00", noBid: true })).toBe(
      "1º lance R$ 50,00 (SEM LANCE)",
    );
    expect(priceLabel({ nextBid: "R$ 55,00", price: "R$ 50,00", noBid: true })).toBe(
      "1º lance R$ 55,00 (SEM LANCE)",
    );
  });
  test("com lance prefere o próximo lance, senão o atual", () => {
    expect(priceLabel({ nextBid: "R$ 90,00", price: "R$ 80,00", noBid: false })).toBe(
      "próximo lance R$ 90,00",
    );
    expect(priceLabel({ nextBid: "", price: "R$ 80,00", noBid: false })).toBe("atual R$ 80,00");
  });
  test("linha e lista", () => {
    expect(formatListEntry(base)).toBe(
      "Lote 12 | Djavan — Luz (1982) | atual R$ 80,00 | Estado: Disco VG+ · Capa VG | Prensagem original",
    );
    expect(formatListEntry({ ...base, condition: "", note: "" })).toContain(
      "Estado: não informado",
    );
    const text = formatHouseList("Casa X", [
      { ...base, lote: "20" },
      { ...base, lote: "3" },
    ]);
    expect(text.split("\n")[0]).toBe("Casa X — 2 lote(s)");
    expect(text.split("\n")[1]).toContain("Lote 3");
  });
  test("shortNote corta sem partir palavra", () => {
    expect(shortNote("  curto  ")).toBe("curto");
    const out = shortNote("palavra ".repeat(40), 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
  });
  test("artista/álbum: IA primeiro, senão fallback", () => {
    expect(splitArtistAlbum("Djavan - Luz (1982)", "x", "t")).toEqual({
      artist: "Djavan",
      album: "Luz (1982)",
    });
    expect(splitArtistAlbum(null, "Gal", "LP Gal Costa")).toEqual({
      artist: "Gal",
      album: "LP Gal Costa",
    });
  });
  test("export do dia separa por casa e ignora casa vazia", () => {
    const text = formatDayList("Hoje 08/11", [
      { house: "Casa A", entries: [base] },
      {
        house: "Casa B",
        entries: [
          { ...base, lote: "7" },
          { ...base, lote: "2" },
        ],
      },
      { house: "Casa C", entries: [] },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Hoje 08/11 — 3 lote(s) em 2 casa(s)");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Casa A — 1 lote(s)");
    expect(lines).toContain("Casa B — 2 lote(s)");
    expect(text).not.toContain("Casa C");
  });
});

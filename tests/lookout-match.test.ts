import { describe, expect, test } from "bun:test";

import {
  buildLotIdentity,
  lookoutCandidates,
  matchLookoutForLot,
  notifyKey,
  pickNotifiable,
  priceVsCeiling,
  type LookoutItem,
  type LookoutMatch,
} from "@/lib/lookout-match";

function item(over: Partial<LookoutItem> = {}): LookoutItem {
  return {
    id: "it1",
    lotId: "100-1",
    artist: "Chico Buarque",
    album: "Construção",
    year: 1971,
    title: "LP Chico Buarque Construção 1971",
    house: "Casa A",
    image: null,
    url: "",
    dayKey: "2026-10-01",
    maxPrice: null,
    note: "",
    status: "active",
    ...over,
  };
}

const ident = (title: string, artist: string, album?: string) =>
  buildLotIdentity({ title, artist, album: album ?? null });

describe("matchLookoutForLot", () => {
  test("reconhece o mesmo disco em outro lote (artista + álbum)", () => {
    const cands = lookoutCandidates([item()]);
    const hit = matchLookoutForLot(
      cands,
      "200-9",
      ident("LP Chico Buarque - Construção - 1971", "Chico Buarque"),
    );
    expect(hit?.itemId).toBe("it1");
    expect(hit!.score).toBeGreaterThanOrEqual(0.8);
  });

  test("não casa outro disco do mesmo artista", () => {
    const cands = lookoutCandidates([item()]);
    const hit = matchLookoutForLot(
      cands,
      "200-9",
      ident("LP Chico Buarque - Almanaque - 1981", "Chico Buarque", "Chico Buarque - Almanaque"),
    );
    expect(hit).toBeNull();
  });

  test("nunca casa com o próprio lote de origem", () => {
    const cands = lookoutCandidates([item()]);
    expect(
      matchLookoutForLot(cands, "100-1", ident("LP Chico Buarque - Construção", "Chico Buarque")),
    ).toBeNull();
  });

  test("lote descartado pelo usuário não casa; confirmado casa mesmo sem texto", () => {
    const cands = lookoutCandidates([item()]);
    const id = ident("LP Chico Buarque - Construção", "Chico Buarque");
    expect(matchLookoutForLot(cands, "200-9", id, { "200-9": false })).toBeNull();
    const forced = matchLookoutForLot(cands, "300-3", ident("Disco qualquer", "Fulano"), {
      "300-3": "it1",
    });
    expect(forced).toMatchObject({ itemId: "it1", score: 1, confirmed: true });
  });

  test("itens adquiridos/descartados e sem artista real não viram candidatos", () => {
    expect(lookoutCandidates([item({ status: "acquired" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ status: "dismissed" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ artist: "Lote" })])).toHaveLength(0);
    expect(lookoutCandidates([item({ album: "" })])).toHaveLength(0);
  });
});

describe("pickNotifiable", () => {
  const m = (lotId: string, itemId: string, score: number, confirmed = false): LookoutMatch => ({
    lotId,
    itemId,
    score,
    confirmed,
  });

  test("só confiantes e ainda não avisados", () => {
    const matches = [m("a", "i", 0.9), m("b", "i", 0.65), m("c", "i", 1, true), m("d", "i", 0.85)];
    const notified = new Set([notifyKey({ lotId: "d", itemId: "i" })]);
    expect(pickNotifiable(matches, notified).map((x) => x.lotId)).toEqual(["a", "c"]);
  });
});

describe("priceVsCeiling", () => {
  test("compara com o teto", () => {
    expect(priceVsCeiling(50, 80)).toBe("under");
    expect(priceVsCeiling(80, 80)).toBe("under");
    expect(priceVsCeiling(120, 80)).toBe("over");
    expect(priceVsCeiling(null, 80)).toBeNull();
    expect(priceVsCeiling(50, null)).toBeNull();
  });
});

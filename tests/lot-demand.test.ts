import { describe, expect, test } from "bun:test";

import { demandAgeLabel, isDemandStale, pickDemandAuctions } from "../src/lib/lot-demand";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("pickDemandAuctions", () => {
  test("ignora lote fora dos dias e lido há pouco; leitura mais velha primeiro", () => {
    const lots = [
      { id: "a1", dayKey: "2026-11-12", time: "20:00", demandAt: ago(5), auctionKey: "A" },
      { id: "b1", dayKey: "2026-11-12", time: "21:00", demandAt: ago(120), auctionKey: "B" },
      { id: "c1", dayKey: "2026-11-13", time: "10:00", demandAt: null, auctionKey: "C" },
      { id: "d1", dayKey: "2026-11-20", time: "10:00", demandAt: null, auctionKey: "D" },
    ];
    const r = pickDemandAuctions(lots, ["2026-11-12", "2026-11-13"], NOW);
    expect(r.map((x) => x.auctionKey)).toEqual(["C", "B"]);
  });
  test("agrupa os lotes do mesmo leilão", () => {
    const lots = [
      { id: "1", dayKey: "2026-11-12", demandAt: null, auctionKey: "A" },
      { id: "2", dayKey: "2026-11-12", demandAt: ago(60), auctionKey: "A" },
    ];
    expect(pickDemandAuctions(lots, ["2026-11-12"], NOW)[0]?.ids).toEqual(["1", "2"]);
  });
});

describe("demandAgeLabel / isDemandStale", () => {
  test("rótulos", () => {
    expect(demandAgeLabel(null, NOW)).toBeNull();
    expect(demandAgeLabel(ago(1), NOW)).toBe("agora");
    expect(demandAgeLabel(ago(12), NOW)).toBe("há 12 min");
    expect(demandAgeLabel(ago(180), NOW)).toBe("há 3 h");
    expect(demandAgeLabel(ago(60 * 24 * 3), NOW)).toBe("há 3 d");
  });
  test("velha > 3 h ou nunca lida", () => {
    expect(isDemandStale(ago(30), NOW)).toBe(false);
    expect(isDemandStale(ago(200), NOW)).toBe(true);
    expect(isDemandStale(null, NOW)).toBe(true);
  });
});

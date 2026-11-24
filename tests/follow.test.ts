import { describe, expect, test } from "bun:test";

import { etaMinutes, followTone, lotDistance } from "../src/lib/follow";

describe("lotDistance", () => {
  test("diferença entre o lote do item e o lote em pregão", () => {
    expect(lotDistance("109", "108")).toBe(1);
    expect(lotDistance("41", "38")).toBe(3);
    expect(lotDistance("30", "64")).toBe(-34);
  });
  test("sem número legível → null", () => {
    expect(lotDistance(null, "10")).toBeNull();
    expect(lotDistance("abc", "10")).toBeNull();
    expect(lotDistance("12", null)).toBeNull();
  });
});

describe("followTone", () => {
  test("faixas de proximidade", () => {
    expect(followTone(0)).toBe("near");
    expect(followTone(3)).toBe("near");
    expect(followTone(4)).toBe("mid");
    expect(followTone(15)).toBe("mid");
    expect(followTone(16)).toBe("far");
    expect(followTone(null)).toBe("none");
  });
});

describe("etaMinutes", () => {
  const start = new Date("2026-11-23T19:00:00-03:00").getTime();
  const base = { dayKey: "2026-11-23", time: "19:00" };
  test("ritmo médio × lotes que faltam", () => {
    // 60 min, 30 peças → 2 min/peça; faltam 10 → 20 min
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start + 60 * 60000 })).toBe(20);
  });
  test("sem base suficiente → null", () => {
    expect(etaMinutes({ ...base, peca: 3, distance: 10, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: null, distance: 10, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start - 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 0, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start + 20 * 3600000 })).toBeNull();
  });
});

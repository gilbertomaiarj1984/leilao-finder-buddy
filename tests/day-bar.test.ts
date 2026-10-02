import { describe, expect, test } from "bun:test";

import { shiftSavedDayTab } from "../src/lib/persisted-state";
import { BAR_PAGES, buildBarDays, shiftDayKey, TODAY_INDEX, TODAY_PAGE } from "../src/lib/day-bar";

describe("day-bar", () => {
  test("shiftDayKey atravessa mês e ano", () => {
    expect(shiftDayKey("2026-10-02", -5)).toBe("2026-09-27");
    expect(shiftDayKey("2026-12-30", 3)).toBe("2027-01-02");
  });

  test("buildBarDays: 25 dias, hoje em TODAY_INDEX, páginas de 5", () => {
    const days = buildBarDays("2026-09-29");
    expect(days).toHaveLength(25);
    expect(days[TODAY_INDEX]).toBe("2026-09-29");
    expect(days[0]).toBe("2026-09-19");
    expect(days[24]).toBe("2026-10-13");
    expect(BAR_PAGES).toBe(5);
    expect(TODAY_PAGE).toBe(2);
  });
});

describe("shiftSavedDayTab", () => {
  test("mesmo dia mantém; virou o dia anda o índice; abas não-dia passam", () => {
    expect(shiftSavedDayTab("day-12", "2026-10-02", "2026-10-02", 25)).toBe("day-12");
    expect(shiftSavedDayTab("day-12", "2026-10-02", "2026-10-03", 25)).toBe("day-11");
    expect(shiftSavedDayTab("day-0", "2026-10-02", "2026-10-05", 25)).toBe("day-0");
    expect(shiftSavedDayTab("watched", "2026-10-02", "2026-10-05", 25)).toBe("watched");
  });
});

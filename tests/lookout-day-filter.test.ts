import { describe, expect, test } from "bun:test";

import {
  filterByLookoutDay,
  LOOKOUT_DAY_COUNT,
  lookoutDayOptions,
} from "../src/lib/lookout-day-filter";

describe("lookout-day-filter", () => {
  test("oferece 10 dias a partir de hoje, atravessando o mês", () => {
    const days = lookoutDayOptions("2026-10-26", []);
    expect(days).toHaveLength(LOOKOUT_DAY_COUNT);
    expect(days[0]).toMatchObject({ dayKey: "2026-10-26", weekday: "Hoje", label: "26/10" });
    expect(days[9]).toMatchObject({ dayKey: "2026-11-04", label: "04/11" });
    // 27/10/2026 é uma terça-feira.
    expect(days[1]?.weekday).toBe("ter");
  });

  test("conta os lotes de cada dia e ignora os fora da janela", () => {
    const matches = [
      { dayKey: "2026-10-21" },
      { dayKey: "2026-10-21" },
      { dayKey: "2026-10-23" },
      { dayKey: "2026-12-01" },
    ];
    const days = lookoutDayOptions("2026-10-21", matches);
    expect(days.map((d) => d.count)).toEqual([2, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("filterByLookoutDay: sem dia devolve tudo; com dia, só aquele", () => {
    const matches = [{ dayKey: "2026-10-21" }, { dayKey: "2026-10-22" }];
    expect(filterByLookoutDay(matches, "")).toHaveLength(2);
    expect(filterByLookoutDay(matches, "2026-10-22")).toEqual([{ dayKey: "2026-10-22" }]);
    expect(filterByLookoutDay(matches, "2026-10-30")).toEqual([]);
  });
});

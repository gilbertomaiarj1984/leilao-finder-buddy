import { describe, expect, test } from "bun:test";

import {
  homeTabOf,
  isMenuRoute,
  nextHomeNav,
} from "../src/components/vinyl/mobile/mobile-nav-utils";

describe("homeTabOf", () => {
  test("abas de dia viram 'days'", () => {
    expect(homeTabOf("day-0")).toBe("days");
    expect(homeTabOf("day-12")).toBe("days");
  });
  test("watched e bids passam", () => {
    expect(homeTabOf("watched")).toBe("watched");
    expect(homeTabOf("bids")).toBe("bids");
  });
});

describe("isMenuRoute", () => {
  test("telas do Menu", () => {
    expect(isMenuRoute("/colecao")).toBe(true);
    expect(isMenuRoute("/vinil-analytics")).toBe(true);
    expect(isMenuRoute("/")).toBe(false);
    expect(isMenuRoute("/colecaox")).toBe(false);
  });
});

describe("nextHomeNav", () => {
  const today = "2026-10-06";
  test("vigiados mantém a página dos dias", () => {
    expect(
      nextHomeNav({ tab: "day-7", dayPage: 1, savedOn: today }, "watched", today, 5, 1),
    ).toEqual({
      tab: "watched",
      dayPage: 1,
      savedOn: today,
    });
  });
  test("dias volta ao dia salvo de hoje", () => {
    expect(nextHomeNav({ tab: "day-7", dayPage: 1, savedOn: today }, "days", today, 5, 1).tab).toBe(
      "day-7",
    );
  });
  test("dias sem dia salvo vai para hoje", () => {
    expect(nextHomeNav({ tab: "bids", dayPage: 0, savedOn: today }, "days", today, 5, 1)).toEqual({
      tab: "day-5",
      dayPage: 1,
      savedOn: today,
    });
    expect(nextHomeNav(null, "bids", today, 5, 1).tab).toBe("bids");
  });
  test("dia salvo de outra data não é reaproveitado", () => {
    expect(
      nextHomeNav({ tab: "day-7", dayPage: 1, savedOn: "2026-10-01" }, "days", today, 5, 1).tab,
    ).toBe("day-5");
  });
});

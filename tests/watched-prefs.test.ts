import { describe, expect, test } from "bun:test";

import { applyPrefsOp, EMPTY_PREFS, parsePrefsOp } from "../src/lib/watched-prefs";
import { parseWatchedPrefs } from "../src/lib/watched-prefs.server";

const AT = "2026-11-27T20:00:00.000Z";

describe("applyPrefsOp", () => {
  test("acompanhar e parar de acompanhar", () => {
    const a = applyPrefsOp(EMPTY_PREFS, { t: "follow", id: "1-2", at: AT });
    expect(a.followed).toEqual({ "1-2": AT });
    expect(applyPrefsOp(a, { t: "unfollow", id: "1-2" }).followed).toEqual({});
    expect(EMPTY_PREFS.followed).toEqual({}); // não muta o original
  });
  test("ocultar, mostrar e mostrar todas", () => {
    let p = applyPrefsOp(EMPTY_PREFS, { t: "hide", house: "A", day: "2026-11-27" });
    p = applyPrefsOp(p, { t: "hide", house: "B", day: "2026-11-27" });
    expect(Object.keys(p.hidden)).toEqual(["A", "B"]);
    expect(Object.keys(applyPrefsOp(p, { t: "show", house: "A" }).hidden)).toEqual(["B"]);
    expect(applyPrefsOp(p, { t: "showAll" }).hidden).toEqual({});
  });
  test("merge une sem apagar nem rebaixar", () => {
    const cur = { followed: { x: "antigo" }, hidden: { A: "2026-11-27" } };
    const p = applyPrefsOp(cur, {
      t: "merge",
      followed: ["x", "y"],
      hidden: { A: "2026-11-26", B: "2026-11-27", C: "lixo" },
      at: AT,
    });
    expect(p.followed).toEqual({ x: "antigo", y: AT });
    expect(p.hidden).toEqual({ A: "2026-11-27", B: "2026-11-27" });
  });
});

describe("parsePrefsOp", () => {
  test("aceita operações válidas", () => {
    expect(parsePrefsOp({ t: "follow", id: "1-2", at: AT })).toEqual({
      t: "follow",
      id: "1-2",
      at: AT,
    });
    expect(parsePrefsOp({ t: "showAll" })).toEqual({ t: "showAll" });
    expect(parsePrefsOp({ t: "hide", house: "A", day: "2026-11-27" })).not.toBeNull();
  });
  test("rejeita o que é inválido", () => {
    expect(parsePrefsOp(null)).toBeNull();
    expect(parsePrefsOp({ t: "hide", house: "A", day: "hoje" })).toBeNull();
    expect(parsePrefsOp({ t: "follow", id: "", at: AT })).toBeNull();
    expect(parsePrefsOp({ t: "x" })).toBeNull();
  });
  test("merge filtra lixo", () => {
    const op = parsePrefsOp({
      t: "merge",
      followed: ["a", 3, ""],
      hidden: { A: "2026-11-27", B: "ontem" },
      at: AT,
    });
    expect(op).toEqual({ t: "merge", followed: ["a"], hidden: { A: "2026-11-27" }, at: AT });
  });
});

describe("parseWatchedPrefs (servidor)", () => {
  const now = new Date("2026-11-27T20:00:00Z").getTime();
  test("descarta acompanhados com mais de 30 dias e ocultas antigas", () => {
    const p = parseWatchedPrefs(
      {
        followed: { novo: "2026-11-20T00:00:00Z", velho: "2026-09-01T00:00:00Z", ruim: 5 },
        hidden: { A: "2026-11-27", B: "2026-11-20", C: "xx" },
      },
      now,
    );
    expect(Object.keys(p.followed)).toEqual(["novo"]);
    expect(Object.keys(p.hidden)).toEqual(["A"]);
  });
  test("valor cru inválido → vazio", () => {
    expect(parseWatchedPrefs(null, now)).toEqual({ followed: {}, hidden: {} });
    expect(parseWatchedPrefs([1], now)).toEqual({ followed: {}, hidden: {} });
  });
});

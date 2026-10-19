import { describe, expect, test } from "bun:test";

import { applyLookoutLinks } from "@/lib/lookout-overview-patch";
import type { LookoutOverview } from "@/lib/lookout-matches.server";

const up = (lotId: string, itemId: string, isNew = false) =>
  ({ lotId, itemId, isNew, confirmed: false, yearPending: true }) as never;
const sale = (lotId: string, itemId: string) => ({ lotId, itemId, pending: true }) as never;

const base = (): LookoutOverview => ({
  items: [],
  upcoming: [up("a", "x", true), up("b", "x")],
  history: [sale("a", "x"), sale("c", "x")],
  newCount: 1,
  artistGroups: {},
});

describe("applyLookoutLinks", () => {
  test("descartar tira o lote de por vir e do histórico e recontando novos", () => {
    const r = applyLookoutLinks(base(), ["a"], false);
    expect(r.upcoming.map((m) => m.lotId)).toEqual(["b"]);
    expect(r.history.map((h) => h.lotId)).toEqual(["c"]);
    expect(r.newCount).toBe(0);
  });
  test("confirmar/mover troca o disco e marca como confirmado", () => {
    const r = applyLookoutLinks(base(), ["a"], "y");
    expect(r.upcoming[0]).toMatchObject({ itemId: "y", confirmed: true, yearPending: false });
    expect(r.upcoming[1]!.itemId).toBe("x");
    expect(r.history[0]).toMatchObject({ itemId: "y", pending: false });
  });
  test("sem ids devolve a mesma visão", () => {
    const o = base();
    expect(applyLookoutLinks(o, [], false)).toBe(o);
  });
});

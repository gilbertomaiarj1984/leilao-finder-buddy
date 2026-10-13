import { describe, expect, test } from "bun:test";

import { newlyCoveredBids } from "../src/lib/bid-transitions";

describe("newlyCoveredBids", () => {
  test("avisa só na transição para Coberto", () => {
    const prev = new Map([
      ["1-1", "Vencendo"],
      ["1-2", "Coberto"],
    ]);
    const bids = [
      { id: "1-1", status: "Coberto" },
      { id: "1-2", status: "Coberto" },
      { id: "1-3", status: "Vencendo" },
    ];
    const { newlyCovered, nextSnapshot } = newlyCoveredBids(bids, prev);
    expect(newlyCovered.map((b) => b.id)).toEqual(["1-1"]);
    expect(nextSnapshot.get("1-3")).toBe("Vencendo");
  });

  test("lote sem registro anterior e já coberto conta como novo", () => {
    const { newlyCovered } = newlyCoveredBids([{ id: "9-9", status: "Coberto" }], new Map());
    expect(newlyCovered).toHaveLength(1);
  });

  test("voltou a Vencendo e foi coberto de novo avisa de novo", () => {
    const a = newlyCoveredBids([{ id: "1-1", status: "Vencendo" }], new Map([["1-1", "Coberto"]]));
    expect(a.newlyCovered).toHaveLength(0);
    const b = newlyCoveredBids([{ id: "1-1", status: "Coberto" }], a.nextSnapshot);
    expect(b.newlyCovered).toHaveLength(1);
  });
});

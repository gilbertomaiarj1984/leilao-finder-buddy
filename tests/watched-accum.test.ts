import { describe, expect, test } from "bun:test";

import { withBidsAsWatched } from "@/lib/watched-accum";
import type { MyBid } from "@/lib/leiloesbr-bids.server";
import type { WatchedLot } from "@/lib/leiloesbr-watch.server";

const bid = (id: string, over: Partial<MyBid> = {}) =>
  ({
    id,
    idPeca: id.split("-")[1],
    idLeilao: id.split("-")[0],
    base: "b",
    lote: "7",
    title: "Queen - Jazz",
    myBid: "R$70,00",
    status: "Vencendo",
    url: "u",
    image: null,
    date: "01/01/2026",
    house: "Casa A",
    uf: "SP",
    watched: false,
    ...over,
  }) as MyBid;
const watchedLot = (id: string) => ({ id, watched: true }) as WatchedLot;

const opts = {
  dayKeyOf: (b: MyBid) => (b.id === "1-2" ? "2026-10-30" : b.id === "1-3" ? "2026-10-20" : ""),
  timeOf: () => "19:00",
  artistOf: () => "Queen",
};

describe("withBidsAsWatched", () => {
  test("lance não vigiado entra com o dia do leilão; vigiado real não duplica", () => {
    const r = withBidsAsWatched([watchedLot("1-9")], [bid("1-2"), bid("1-9")], "2026-10-28", opts);
    expect(r.map((w) => w.id)).toEqual(["1-9", "1-2"]);
    expect(r[1]).toMatchObject({ date: "30/10/2026", time: "19:00", artist: "Queen", lote: "7" });
  });
  test("leilão passado ou sem dia conhecido não entra", () => {
    const r = withBidsAsWatched([], [bid("1-3"), bid("1-4")], "2026-10-28", opts);
    expect(r).toEqual([]);
  });
});

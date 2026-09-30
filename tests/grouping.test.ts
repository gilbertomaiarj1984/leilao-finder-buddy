import { describe, expect, test } from "bun:test";

import {
  catalogAuctionInfo,
  catalogHasDay,
  groupWatchedByHouseCatalog,
} from "../src/components/vinyl/grouping";

const lot = (house: string, idLeilao: string, date: string, time: string, lote: string) => ({
  house,
  houseUrl: "#",
  idLeilao,
  date,
  time,
  lote,
  url: `abre_catalogo.asp?t=1|www.${house}.com.br|${idLeilao}|${lote}`,
});

describe("groupWatchedByHouseCatalog", () => {
  const lots = [
    lot("a", "10", "02/10/2026", "19:30h", "5"),
    lot("a", "10", "01/10/2026", "19:30h", "2"),
    lot("a", "10", "03/10/2026", "20h", "9"),
    lot("a", "11", "01/10/2026", "14h", "1"),
    lot("b", "20", "30/09/2026", "15:00", "1"),
  ];
  const houses = groupWatchedByHouseCatalog(lots);

  test("casa > catálogo; multi-dia continua um catálogo com todos os dias", () => {
    const a = houses.find((h) => h.house === "a")!;
    expect(a.catalogs.map((c) => c.idLeilao)).toEqual(["11", "10"]);
    const multi = a.catalogs.find((c) => c.idLeilao === "10")!;
    expect(multi.dayKeys).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(multi.lots.map((l) => l.lote)).toEqual(["2", "5", "9"]);
    expect(multi.time).toBe("19:30h");
  });

  test("casas ordenadas pelo primeiro catálogo", () => {
    expect(houses.map((h) => h.house)).toEqual(["b", "a"]);
  });

  test("catálogo multi-dia aparece em qualquer dia que atravessa", () => {
    const multi = houses.find((h) => h.house === "a")!.catalogs.find((c) => c.idLeilao === "10")!;
    expect(catalogHasDay(multi, "2026-10-02")).toBe(true);
    expect(catalogHasDay(multi, "2026-10-04")).toBe(false);
  });

  test("status multi-dia: ao vivo entre os dias, encerrado só depois do último", () => {
    const multi = houses.find((h) => h.house === "a")!.catalogs.find((c) => c.idLeilao === "10")!;
    const at = (iso: string) => new Date(iso).getTime();
    expect(catalogAuctionInfo(multi, at("2026-10-01T12:00:00-03:00"))?.status).toBe("upcoming");
    expect(catalogAuctionInfo(multi, at("2026-10-02T12:00:00-03:00"))?.status).toBe("live");
    expect(catalogAuctionInfo(multi, at("2026-10-04T12:00:00-03:00"))?.status).toBe("ended");
  });
});

import { describe, expect, test } from "bun:test";

import { UNCLASSIFIED_LABEL } from "../src/lib/vinyl-parse";
import {
  catalogAuctionInfo,
  catalogHasDay,
  groupWatchedByArtist,
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

describe("groupWatchedByArtist", () => {
  const withArtist = (artist: string, l: ReturnType<typeof lot>) => ({ ...l, artist });
  const groups = groupWatchedByArtist([
    withArtist("Tim Maia", lot("b", "20", "01/10/2026", "19h", "3")),
    withArtist("Miles Davis", lot("b", "20", "02/10/2026", "19h", "1")),
    withArtist("Miles Davis", lot("a", "10", "03/10/2026", "14h", "9")),
    withArtist("Miles Davis", lot("b", "20", "01/10/2026", "19h", "2")),
    withArtist("", lot("a", "10", "01/10/2026", "14h", "1")),
  ]);

  test("artistas em ordem alfabética, sem artista por último", () => {
    expect(groups.map((g) => g.artist)).toEqual(["Miles Davis", "Tim Maia", UNCLASSIFIED_LABEL]);
  });

  test("dentro do artista: casa, depois data; conta casas distintas", () => {
    const miles = groups[0]!;
    expect(miles.houseCount).toBe(2);
    expect(miles.lots.map((l) => `${l.house}${l.date.slice(0, 2)}`)).toEqual(["a03", "b01", "b02"]);
  });
});

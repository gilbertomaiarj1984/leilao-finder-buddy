import { describe, expect, test } from "bun:test";

import { UNCLASSIFIED_LABEL } from "../src/lib/vinyl-parse";
import {
  catalogAuctionInfo,
  catalogHasDay,
  groupWatchedByArtist,
  groupWatchedByHouseCatalog,
  houseStatKind,
  matchesStatFilter,
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

  test("lotes do catálogo multi-dia em ordem crescente de data, depois por lote", () => {
    const mixed = groupWatchedByHouseCatalog([
      lot("a", "10", "03/10/2026", "19h", "1"),
      lot("a", "10", "01/10/2026", "19h", "8"),
      lot("a", "10", "01/10/2026", "19h", "3"),
    ]);
    expect(mixed[0]!.catalogs[0]!.lots.map((l) => l.lote)).toEqual(["3", "8", "1"]);
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

describe("groupWatchedByArtist — correção de nomes", () => {
  const w = (artist: string, l: ReturnType<typeof lot>) => ({ ...l, artist });
  const lots = [
    w("Pink Floyd", lot("a", "10", "01/10/2026", "19h", "1")),
    w("PINK FLOYD", lot("a", "10", "01/10/2026", "19h", "2")),
    w("Pink Floid", lot("b", "20", "02/10/2026", "19h", "1")),
    w("Miles Davis", lot("b", "20", "02/10/2026", "19h", "2")),
  ];

  test("grafias que só diferem em caixa já caem juntas; typo fica à parte", () => {
    const g = groupWatchedByArtist(lots);
    expect(g.map((x) => [x.artist, x.lots.length])).toEqual([
      ["Miles Davis", 1],
      ["Pink Floid", 1],
      ["Pink Floyd", 2],
    ]);
  });

  test("apelido funde o typo no nome canônico e expõe as chaves de origem", () => {
    const g = groupWatchedByArtist(lots, { artists: { "pink floid": "Pink Floyd" } });
    const pink = g.find((x) => x.artist === "Pink Floyd")!;
    expect(g).toHaveLength(2);
    expect(pink.lots).toHaveLength(3);
    expect(pink.houseCount).toBe(2);
    expect(pink.sourceKeys.sort()).toEqual(["pink floid", "pink floyd"]);
  });

  test("apelido renomeia um artista sozinho", () => {
    const g = groupWatchedByArtist(lots, { artists: { "miles davis": "Miles Davis Quintet" } });
    expect(g.some((x) => x.artist === "Miles Davis Quintet")).toBe(true);
  });
});

describe("groupWatchedByArtist — mover lote", () => {
  const w = (id: string, artist: string, l: ReturnType<typeof lot>) => ({ ...l, id, artist });
  const lots = [
    w("1-1", "Pink Floyd", lot("a", "1", "01/10/2026", "19h", "1")),
    w("1-2", "Pink Floyd", lot("a", "1", "01/10/2026", "19h", "2")),
    w("1-3", "Pink Floyd", lot("a", "1", "01/10/2026", "19h", "3")),
    w("1-4", "Roger Waters", lot("a", "1", "01/10/2026", "19h", "4")),
  ];

  test("correção por lote leva só aquele lote para outro artista", () => {
    const g = groupWatchedByArtist(lots, { sales: { "1-3": { artist: "Roger Waters" } } });
    expect(g.find((x) => x.artist === "Pink Floyd")!.lots.map((l) => l.id)).toEqual(["1-1", "1-2"]);
    expect(g.find((x) => x.artist === "Roger Waters")!.lots.map((l) => l.id)).toEqual([
      "1-3",
      "1-4",
    ]);
  });

  test("lote movido também segue o apelido do artista de destino", () => {
    const g = groupWatchedByArtist(lots, {
      artists: { "roger waters": "Roger Waters (solo)" },
      sales: { "1-3": { artist: "Roger Waters" } },
    });
    expect(g.find((x) => x.artist === "Roger Waters (solo)")!.lots).toHaveLength(2);
  });
});

describe("houseStatKind", () => {
  const watched = new Set(["1", "2", "3"]);
  const bids = new Map([
    ["2", "Vencendo"],
    ["3", "Coberto"],
  ]);
  test("classifica vigia, ganhando, coberto e nenhum", () => {
    expect(houseStatKind("1", watched, bids)).toBe("vigia");
    expect(houseStatKind("2", watched, bids)).toBe("green");
    expect(houseStatKind("3", watched, bids)).toBe("red");
    expect(houseStatKind("9", watched, bids)).toBeNull();
  });
});

describe("matchesStatFilter", () => {
  const watched = new Set(["1", "2", "3"]);
  const bids = new Map([
    ["2", "Vencendo"],
    ["3", "Coberto"],
  ]);
  test("sem filtro passa tudo; com vários marcados vale o OU", () => {
    expect(matchesStatFilter("9", watched, bids, new Set())).toBe(true);
    const f = new Set<"vigia" | "green" | "red">(["green", "red"]);
    expect(matchesStatFilter("1", watched, bids, f)).toBe(false);
    expect(matchesStatFilter("2", watched, bids, f)).toBe(true);
    expect(matchesStatFilter("3", watched, bids, f)).toBe(true);
    expect(matchesStatFilter("9", watched, bids, f)).toBe(false);
  });
});

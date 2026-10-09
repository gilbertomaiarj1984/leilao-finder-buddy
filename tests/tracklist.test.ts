import { describe, expect, test } from "bun:test";

import {
  applyFame,
  groupTracksBySide,
  normalizeTracklist,
  parseDiscogsTracklist,
  needsFame,
  parseFameText,
  withoutFame,
} from "../src/lib/tracklist";

describe("normalizeTracklist", () => {
  test("normaliza lado, fama e título", () => {
    const r = normalizeTracklist([
      { side: "a", title: "  Nem  Morta ", fame: "ALTA" },
      { side: "B", title: "Mesa Redonda", fame: "media" },
      { title: "Sem Lado", fame: "xyz" },
      { side: "A", title: "" },
      "lixo",
    ]);
    expect(r).toEqual([
      { side: "A", title: "Nem Morta", fame: "alta" },
      { side: "B", title: "Mesa Redonda", fame: "media" },
      { side: null, title: "Sem Lado", fame: null },
    ]);
  });

  test("vazio/inválido vira null", () => {
    expect(normalizeTracklist(null)).toBeNull();
    expect(normalizeTracklist([])).toBeNull();
    expect(normalizeTracklist([{ title: "" }])).toBeNull();
  });
});

describe("groupTracksBySide", () => {
  test("agrupa em ordem", () => {
    const g = groupTracksBySide([
      { side: "A", title: "1", fame: "alta" },
      { side: "A", title: "2", fame: "baixa" },
      { side: "B", title: "3", fame: "media" },
    ]);
    expect(g.map((x) => [x.side, x.tracks.length])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
  });
});

describe("parseDiscogsTracklist", () => {
  test("lado pela posição, ignora headings e expande sub_tracks", () => {
    const r = parseDiscogsTracklist([
      { position: "", type_: "heading", title: "Lado 1" },
      { position: "A1", type_: "track", title: "Um" },
      { position: "A2", type_: "track", title: "  Dois  " },
      { position: "B", type_: "track", title: "Três" },
      { position: "2-C1", type_: "track", title: "Quatro" },
      { position: "5", type_: "track", title: "Cinco" },
      {
        position: "B4",
        type_: "index",
        title: "Medley",
        sub_tracks: [
          { position: "B4a", type_: "track", title: "Parte a" },
          { position: "B4b", type_: "track", title: "Parte b" },
        ],
      },
    ]);
    expect(r).toEqual([
      { side: "A", title: "Um" },
      { side: "A", title: "Dois" },
      { side: "B", title: "Três" },
      { side: "C", title: "Quatro" },
      { side: null, title: "Cinco" },
      { side: "B", title: "Parte a" },
      { side: "B", title: "Parte b" },
    ]);
  });

  test("vazio/inválido vira null", () => {
    expect(parseDiscogsTracklist(undefined)).toBeNull();
    expect(parseDiscogsTracklist([{ type_: "heading", title: "x" }])).toBeNull();
  });
});

describe("fama da IA", () => {
  test("parseFameText por posição; applyFame mantém null onde a IA não classificou", () => {
    const fames = parseFameText('{"fame":["alta","MEDIA","xyz"]}', 4);
    expect(fames).toEqual(["alta", "media", null, null]);
    const tracks = withoutFame([1, 2, 3, 4].map((n) => ({ side: "A", title: `T${n}` })));
    expect(needsFame(tracks)).toBe(true);
    const rated = applyFame(tracks, fames);
    expect(rated.map((t) => t.fame)).toEqual(["alta", "media", null, null]);
    expect(needsFame(rated)).toBe(true);
    expect(needsFame(applyFame(rated, ["alta", "alta", "baixa", "baixa"]))).toBe(false);
    expect(needsFame(null)).toBe(false);
    expect(parseFameText("lixo", 2)).toEqual([null, null]);
  });
});

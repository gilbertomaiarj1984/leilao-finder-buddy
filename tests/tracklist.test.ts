import { describe, expect, test } from "bun:test";

import { groupTracksBySide, normalizeTracklist } from "../src/lib/tracklist";

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
      { side: null, title: "Sem Lado", fame: "baixa" },
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

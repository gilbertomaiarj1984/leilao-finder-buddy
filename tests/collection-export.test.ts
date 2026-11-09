import { describe, expect, test } from "bun:test";

import { formatCollectionLine, formatCollectionList } from "../src/lib/collection-export";

const item = (over: Partial<Parameters<typeof formatCollectionLine>[0]> = {}) => ({
  artist: "Djavan",
  album: "Luz",
  title: "",
  year: 1982,
  conditionMedia: "",
  conditionSleeve: "",
  ...over,
});

describe("collection-export", () => {
  test("linha com artista, álbum e ano; estado só quando existe", () => {
    expect(formatCollectionLine(item())).toBe("Djavan — Luz (1982)");
    expect(formatCollectionLine(item({ conditionMedia: "VG+", conditionSleeve: "VG" }))).toBe(
      "Djavan — Luz (1982) | Disco VG+ · Capa VG",
    );
  });

  test("sem ano, sem artista e sem álbum usa fallbacks", () => {
    expect(formatCollectionLine(item({ year: null, artist: "", album: "", title: "Lote X" }))).toBe(
      "(sem artista) — Lote X",
    );
  });

  test("lista ordenada por artista/álbum, sem-artista no fim, com cabeçalho", () => {
    const text = formatCollectionList([
      item({ artist: "", album: "Z" }),
      item({ artist: "Zé Ramalho", album: "A" }),
      item({ artist: "Álvaro", album: "B" }),
    ]);
    expect(text.split("\n")).toEqual([
      "Coleção — 3 disco(s)",
      "Álvaro — B (1982)",
      "Zé Ramalho — A (1982)",
      "(sem artista) — Z (1982)",
    ]);
  });
});

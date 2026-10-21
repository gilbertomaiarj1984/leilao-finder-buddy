import { describe, expect, test } from "bun:test";

import {
  parseAlbum,
  pickBestRelease,
  releaseFormat,
  toMatchInfo,
  type SearchHit,
} from "@/lib/discogs-match";

const hit = (over: Partial<SearchHit>): SearchHit => ({
  id: 1,
  title: "Gilberto Gil - Refazenda",
  year: 1975,
  country: "Brazil",
  format: ["Vinyl", "LP", "Album"],
  ...over,
});

describe("releaseFormat", () => {
  test("LP, compacto e desconhecido", () => {
    expect(releaseFormat(["Vinyl", "LP", "Album"])).toBe("lp");
    expect(releaseFormat(["Vinyl", '12"', "33 ⅓ RPM"])).toBe("lp");
    expect(releaseFormat(["Vinyl", '7"', "45 RPM", "Single"])).toBe("small");
    expect(releaseFormat(["Vinyl", "EP"])).toBe("small");
    expect(releaseFormat(["Vinyl"])).toBe("other");
    expect(releaseFormat(undefined)).toBe("other");
  });
});

describe("pickBestRelease", () => {
  const target = parseAlbum("Gilberto Gil - Refazenda (1975)");

  test("o LP vence o compacto com o mesmo nome", () => {
    const single = hit({ id: 2, format: ["Vinyl", '7"', "45 RPM", "Single"] });
    const lp = hit({ id: 3 });
    expect(pickBestRelease(target, [single, lp])?.hit.id).toBe(3);
    expect(pickBestRelease(target, [lp, single])?.hit.id).toBe(3);
  });

  test("coletânea não vence o álbum de estúdio", () => {
    const comp = hit({ id: 4, title: "Gilberto Gil - Refazenda: Greatest Hits", year: 1990 });
    expect(pickBestRelease(target, [comp, hit({ id: 5 })])?.hit.id).toBe(5);
  });

  test("sem cobertura mínima do álbum não casa (melhor nada que o disco errado)", () => {
    expect(
      pickBestRelease(target, [hit({ id: 6, title: "Gilberto Gil - Raça Humana" })]),
    ).toBeNull();
    expect(pickBestRelease(target, [])).toBeNull();
  });

  test("devolve a evidência do casamento", () => {
    const match = pickBestRelease(target, [hit({ id: 7 })])!;
    expect(toMatchInfo(match, "br")).toEqual({
      via: "br",
      country: "Brazil",
      format: "lp",
      titleCov: 1,
      artistCov: 1,
    });
  });
});

import { describe, expect, test } from "bun:test";

import { masterMatchesTarget } from "@/lib/discogs-match";
import {
  detectModernReissue,
  lotEditionAllows,
  resolveLotEdition,
  sameAlbum,
  sameAlbumAsItem,
} from "@/lib/album-edition";

const caetano = (year: number | null, extra: object = {}) => ({
  artist: "Caetano Veloso",
  album: "Caetano Veloso",
  year,
  ...extra,
});

describe("detectModernReissue", () => {
  test("palavras de relançamento recente", () => {
    expect(detectModernReissue("LP Chico Buarque - Construção REEDIÇÃO 180g")).toBe(true);
    expect(detectModernReissue("Pink Floyd - The Wall remasterizado")).toBe(true);
    expect(detectModernReissue("Lp Gal Costa - Relançamento (2018)")).toBe(true);
    expect(detectModernReissue("Beatles Abbey Road reissue")).toBe(true);
    expect(detectModernReissue("Vinil colorido Elis Regina")).toBe(true);
  });
  test("disco comum não é marcado", () => {
    expect(detectModernReissue("LP Chico Buarque - Construção (1971) Philips")).toBe(false);
    expect(detectModernReissue("Raul Seixas - Gita Disco VG+ Capa VG")).toBe(false);
  });
});

describe("resolveLotEdition", () => {
  test("sobrescrita manual vence a detecção", () => {
    expect(resolveLotEdition("Lp X reedição", "original")).toBe("original");
    expect(resolveLotEdition("Lp X", "modern")).toBe("modern");
  });
  test("sem sobrescrita: palavras do título ou desconhecida", () => {
    expect(resolveLotEdition("Lp X reedição 180g")).toBe("modern");
    expect(resolveLotEdition("Lp X (1975)")).toBeNull();
  });
});

describe("sameAlbum", () => {
  test("reedição moderna é outro disco; duas modernas se juntam", () => {
    expect(sameAlbum(caetano(1968), caetano(2014, { edition: "modern" }))).toBe(false);
    expect(
      sameAlbum(caetano(2014, { edition: "modern" }), caetano(2016, { edition: "modern" })),
    ).toBe(true);
  });
  test("homônimo: master conhecido manda; sem master vale o ano", () => {
    expect(sameAlbum(caetano(1968, { masterId: 1 }), caetano(1986, { masterId: 2 }))).toBe(false);
    expect(sameAlbum(caetano(1968, { masterId: 1 }), caetano(1990, { masterId: 1 }))).toBe(true);
    expect(sameAlbum(caetano(1968), caetano(1986))).toBe(false);
    expect(sameAlbum(caetano(1968), caetano(1986, { masterId: 2 }))).toBe(false);
  });
  test('marca "época" junta o homônimo de ano diferente', () => {
    expect(sameAlbum(caetano(1968), caetano(1975, { edition: "period" }))).toBe(true);
  });
  test("álbum não homônimo: ano diferente é reedição, mesmo disco", () => {
    const wall = (y: number) => ({ artist: "Pink Floyd", album: "The Wall", year: y });
    expect(sameAlbum(wall(1979), wall(1985))).toBe(true);
  });
});

describe("sameAlbumAsItem — álbum juntado sem ano herda o ano do item", () => {
  const input = { artist: "Caetano Veloso", album: "Caetano Veloso", year: 1968 };
  const mergedNoYear = [{ year: null, nameMatches: true }];
  test("item de 1986 com juntado sem ano NÃO é o disco de 1968 (o bug do print)", () => {
    expect(sameAlbumAsItem(input, { year: 1986, nameMatches: true, merged: mergedNoYear })).toBe(
      false,
    );
  });
  test("o mesmo ano, ou item sem ano algum, continua sendo o mesmo disco", () => {
    expect(sameAlbumAsItem(input, { year: 1968, nameMatches: true, merged: mergedNoYear })).toBe(
      true,
    );
    expect(sameAlbumAsItem(input, { year: null, nameMatches: true, merged: mergedNoYear })).toBe(
      true,
    );
  });
  test("juntado com ano próprio vale o ano dele", () => {
    const merged = [{ year: 1968, nameMatches: true }];
    expect(sameAlbumAsItem(input, { year: 1986, nameMatches: false, merged })).toBe(true);
    expect(sameAlbumAsItem(input, { year: 1986, nameMatches: true, merged: [] })).toBe(false);
  });
  test("nome diferente nunca é o mesmo disco", () => {
    expect(sameAlbumAsItem(input, { year: 1968, nameMatches: false, merged: [] })).toBe(false);
  });
});

describe("lotEditionAllows", () => {
  const item = {};
  test("lote de reedição moderna não casa com item comum", () => {
    expect(lotEditionAllows(item, { edition: "modern" })).toBe(false);
    expect(lotEditionAllows({ ...item, edition: "modern" }, { edition: "modern" })).toBe(true);
  });
  test("item moderno rejeita lote explicitamente original/de época, mas não o desconhecido", () => {
    const wantModern = { ...item, edition: "modern" as const };
    expect(lotEditionAllows(wantModern, { edition: "original" })).toBe(false);
    expect(lotEditionAllows(wantModern, { edition: "period" })).toBe(false);
    expect(lotEditionAllows(wantModern, { edition: null })).toBe(true);
  });
  test("o master do Discogs do lote não rejeita (o release do lote é palpite; o ano valida o homônimo)", () => {
    expect(lotEditionAllows({ edition: null }, { edition: null })).toBe(true);
  });
});

describe("masterMatchesTarget — não usar o master de OUTRO ano p/ álbum homônimo", () => {
  test("Caetano Veloso 1968 não aceita o master de 1986 (era isso que fundia os dois discos)", () => {
    expect(masterMatchesTarget(true, 1968, 1986)).toBe(false);
    expect(masterMatchesTarget(true, 1968, "1968")).toBe(true);
    expect(masterMatchesTarget(true, 1968, 1969)).toBe(true);
  });
  test("homônimo sem ano pedido ou sem ano no resultado: não adivinha", () => {
    expect(masterMatchesTarget(true, null, 1968)).toBe(false);
    expect(masterMatchesTarget(true, 1968, undefined)).toBe(false);
  });
  test("álbum não homônimo aceita qualquer ano (a diferença é reedição)", () => {
    expect(masterMatchesTarget(false, 1990, 1979)).toBe(true);
    expect(masterMatchesTarget(false, null, undefined)).toBe(true);
  });
});

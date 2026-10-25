import { describe, expect, test } from "bun:test";

import {
  detectModernReissue,
  lotEditionAllows,
  resolveLotEdition,
  sameAlbum,
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

describe("lotEditionAllows", () => {
  const item = { artist: "Caetano Veloso", album: "Transa" };
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
  test("homônimo: masters diferentes rejeitam; só vale para homônimo", () => {
    const self = { artist: "Caetano Veloso", album: "Caetano Veloso", masterId: 1 };
    expect(lotEditionAllows(self, { edition: null, masterId: 2 })).toBe(false);
    expect(lotEditionAllows(self, { edition: null, masterId: 1 })).toBe(true);
    expect(lotEditionAllows({ ...item, masterId: 1 }, { edition: null, masterId: 2 })).toBe(true);
  });
});

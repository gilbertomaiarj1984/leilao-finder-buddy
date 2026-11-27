import { describe, expect, test } from "bun:test";

import {
  etaMinutes,
  followTone,
  lotDistance,
  splitArtistAlbum,
  timelineLayout,
} from "../src/lib/follow";

describe("lotDistance", () => {
  test("diferença entre o lote do item e o lote em pregão", () => {
    expect(lotDistance("109", "108")).toBe(1);
    expect(lotDistance("41", "38")).toBe(3);
    expect(lotDistance("30", "64")).toBe(-34);
  });
  test("sem número legível → null", () => {
    expect(lotDistance(null, "10")).toBeNull();
    expect(lotDistance("abc", "10")).toBeNull();
    expect(lotDistance("12", null)).toBeNull();
  });
});

describe("followTone", () => {
  test("faixas de proximidade", () => {
    expect(followTone(0)).toBe("near");
    expect(followTone(3)).toBe("near");
    expect(followTone(4)).toBe("mid");
    expect(followTone(15)).toBe("mid");
    expect(followTone(16)).toBe("far");
    expect(followTone(null)).toBe("none");
  });
});

describe("etaMinutes", () => {
  const start = new Date("2026-11-23T19:00:00-03:00").getTime();
  const base = { dayKey: "2026-11-23", time: "19:00" };
  test("ritmo médio × lotes que faltam", () => {
    // 60 min, 30 peças → 2 min/peça; faltam 10 → 20 min
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start + 60 * 60000 })).toBe(20);
  });
  test("sem base suficiente → null", () => {
    expect(etaMinutes({ ...base, peca: 3, distance: 10, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: null, distance: 10, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start - 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 0, now: start + 60 * 60000 })).toBeNull();
    expect(etaMinutes({ ...base, peca: 30, distance: 10, now: start + 20 * 3600000 })).toBeNull();
  });
});

describe("timelineLayout", () => {
  test("usa a peça estimada (lote − deslocamento) e mostra todos os itens", () => {
    // lote 364 = peça 174 de 190 → deslocamento 190; #384 é peça 194 (outro dia) e a escala cresce.
    const r = timelineLayout(["293", "358", "384"], { lote: "364", peca: 174, total: 190 });
    expect(r.pins).toHaveLength(3);
    const pcts = r.pins.map((p) => p.pct);
    expect(new Set(pcts).size).toBe(3);
    expect(pcts[0]!).toBeLessThan(pcts[1]!);
    expect(pcts[1]!).toBeLessThan(pcts[2]!);
    expect(r.endPct).not.toBeNull();
    expect(r.endPct!).toBeLessThan(100);
  });
  test("tudo dentro do total → sem marca de fim", () => {
    const r = timelineLayout(["100", "150"], { lote: "120", peca: 120, total: 200 });
    expect(r.endPct).toBeNull();
    expect(r.progressPct).toBe(60);
  });
  test("lote sem número é ignorado e posições ficam entre 1% e 99%", () => {
    const r = timelineLayout(["abc", "5000"], { lote: "10", peca: 10, total: 100 });
    expect(r.pins).toHaveLength(1);
    expect(r.pins[0]!.pct).toBeLessThanOrEqual(99);
  });
});

describe("splitArtistAlbum", () => {
  test("tira a barra solta do artista e o artista repetido no álbum", () => {
    expect(splitArtistAlbum("Gonzaguinha /", "Gonzaguinha - Caminhos Do Coração")).toEqual({
      artist: "Gonzaguinha",
      album: "Caminhos Do Coração",
    });
  });
  test("álbum que só começa com o nome do artista fica como está", () => {
    expect(splitArtistAlbum("Gilberto Gil", "Gilberto Gil Em Concerto")).toEqual({
      artist: "Gilberto Gil",
      album: "Gilberto Gil Em Concerto",
    });
  });
  test("sem artista identificado devolve só o álbum", () => {
    expect(splitArtistAlbum("", "Gal (1983)")).toEqual({ artist: "", album: "Gal (1983)" });
  });
});

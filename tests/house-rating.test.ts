import { describe, expect, test } from "bun:test";

import {
  houseKey,
  levelFromScores,
  pregaoRefs,
  sanitizeRating,
  summarizeHouses,
  type PregaoRating,
} from "../src/lib/house-rating";

const r = (level: PregaoRating["level"], extra: Partial<PregaoRating> = {}): PregaoRating => ({
  level,
  tags: [],
  note: "",
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});

describe("houseKey", () => {
  test("ignora caixa, acento e espaços", () => {
    expect(houseKey("  Leilão  SANTA Cecília ")).toBe("leilao santa cecilia");
  });
});

describe("levelFromScores", () => {
  test("sem avaliação = null", () => expect(levelFromScores([])).toBeNull());
  test("uma nota define o nível", () => {
    expect(levelFromScores([3])).toBe("verde");
    expect(levelFromScores([2])).toBe("amarelo");
    expect(levelFromScores([1])).toBe("laranja");
    expect(levelFromScores([0])).toBe("vermelho");
  });
  test("compra recente pesa mais que as antigas", () => {
    expect(levelFromScores([0, 3, 3])).toBe("amarelo");
    expect(levelFromScores([3, 0, 0])).toBe("laranja");
  });
});

describe("sanitizeRating", () => {
  test("nível inválido = null", () => expect(sanitizeRating({ level: "azul" })).toBeNull());
  test("filtra tags desconhecidas e repetidas, apara a nota", () => {
    expect(
      sanitizeRating({ level: "verde", tags: ["Envio rápido", "Envio rápido", "x"], note: " ok " }),
    ).toEqual({ level: "verde", tags: ["Envio rápido"], note: "ok" });
  });
});

describe("pregaoRefs", () => {
  test("um registro por pregão, com a data mais recente", () => {
    const refs = pregaoRefs([
      { idLeilao: "10", house: "Casa A", wonDate: "2026-01-10" },
      { idLeilao: "10", house: "Casa A", wonDate: "2026-01-12" },
      { idLeilao: "11", house: "Casa B", wonDate: null },
    ]);
    expect(refs).toEqual([
      { id: "10", house: "Casa A", date: "2026-01-12" },
      { id: "11", house: "Casa B", date: null },
    ]);
  });
});

describe("summarizeHouses", () => {
  test("agrega por casa, conta tags e pega as notas mais recentes", () => {
    const pregoes = [
      { id: "1", house: "Casa A", date: "2026-01-10" },
      { id: "2", house: "casa a", date: "2026-02-10" },
      { id: "3", house: "Casa B", date: "2026-02-11" },
    ];
    const out = summarizeHouses(pregoes, {
      "1": r("verde", { tags: ["Envio rápido"], note: "antiga" }),
      "2": r("laranja", { tags: ["Envio rápido", "Taxas altas"], note: "nova" }),
    });
    expect(Object.keys(out)).toEqual(["casa a"]);
    expect(out["casa a"]!.rated).toBe(2);
    expect(out["casa a"]!.tags[0]).toEqual({ tag: "Envio rápido", count: 2 });
    expect(out["casa a"]!.notes[0]!.note).toBe("nova");
    expect(out["casa a"]!.notes[0]!.label).toBe("Pregão 2");
  });
});

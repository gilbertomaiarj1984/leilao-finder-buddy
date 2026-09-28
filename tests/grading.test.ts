import { describe, expect, test } from "bun:test";

import { faixaFromScore, normalizeGrade, parseConditionFromText } from "@/lib/grading";

function grades(text: string): [string | null, string | null] {
  const c = parseConditionFromText(text);
  return [c.media, c.sleeve];
}

describe("parseConditionFromText", () => {
  test("rótulos de disco e capa", () => {
    expect(grades("Disco: VG+ Capa: VG")).toEqual(["VG+", "VG"]);
    expect(grades("Capa (VG+) Disco NM")).toEqual(["NM", "VG+"]);
    expect(grades("Disco VG+, capa G+")).toEqual(["VG+", "G+"]);
    expect(grades("Vinil ex, capa vg")).toEqual(["EX", "VG"]);
  });

  test("rótulo combinado ou geral vale para os dois lados", () => {
    expect(grades("Capa e Disco: NM")).toEqual(["NM", "NM"]);
    expect(grades("Estado: VG+")).toEqual(["VG+", "VG+"]);
  });

  test("prosa em português", () => {
    expect(grades("Disco apresenta-se em estado excelente")).toEqual(["EX", "EX"]);
    expect(grades("Disco em ótimo estado, capa boa")).toEqual(["EX", "VG"]);
    expect(grades("Disco bom estado. Capa regular")).toEqual(["VG", "G"]);
    expect(grades("Disco lacrado")).toEqual(["M", "M"]);
  });

  test("sigla embutida em outra palavra não vira nota", () => {
    expect(grades("Disco de Vinil Raul Seixas - Krig-ha, Bandolo!")).toEqual([null, null]);
    expect(grades("Disco de Vinil Alex Cohen - Next Time")).toEqual([null, null]);
    expect(grades("Disco de Vinil Novos Baianos - Acabou Chorare")).toEqual([null, null]);
    expect(grades("Disco de Vinil Boate Azul")).toEqual([null, null]);
  });

  test("sem informação de estado", () => {
    const c = parseConditionFromText("Lote com 10 LPs diversos MPB");
    expect(c.source).toBe("indefinido");
    expect(c.score).toBeNull();
    expect(parseConditionFromText("").source).toBe("indefinido");
  });

  test("score e faixa", () => {
    const c = parseConditionFromText("Disco VG+ Capa VG");
    expect(c.score).toBe(63);
    expect(c.faixa?.label).toBe("Muito Bom");
  });
});

test("normalizeGrade", () => {
  expect(normalizeGrade("vg+")).toBe("VG+");
  expect(normalizeGrade("NM")).toBe("NM");
  expect(normalizeGrade("xx")).toBeNull();
});

test("faixaFromScore", () => {
  expect(faixaFromScore(95)?.label).toBe("Colecionador");
  expect(faixaFromScore(50)?.label).toBe("Aceitável");
  expect(faixaFromScore(null)).toBeNull();
});

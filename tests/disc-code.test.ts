import { describe, expect, test } from "bun:test";

import { extractDiscCodes, isValidGtin, parseDiscCode } from "../src/lib/disc-code";

describe("isValidGtin", () => {
  test("EAN-13 e UPC-A válidos", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("036000291452")).toBe(true);
  });
  test("dígito verificador errado ou tamanho inválido", () => {
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
  });
});

describe("parseDiscCode", () => {
  test("dígitos com espaços/hífens viram código de barras", () => {
    expect(parseDiscCode(" 0 77774 62071 4 ")).toEqual({ kind: "barcode", value: "077774620714" });
  });
  test("texto com letras e números vira nº de catálogo", () => {
    expect(parseDiscCode("EMI 064-79154")).toEqual({ kind: "catno", value: "EMI 064-79154" });
  });
  test("vazio ou sem dígitos é descartado", () => {
    expect(parseDiscCode("  ")).toBeNull();
    expect(parseDiscCode("abc")).toBeNull();
  });
});

describe("extractDiscCodes", () => {
  test("acha o GTIN no meio do texto e junta dígitos separados", () => {
    const r = extractDiscCodes("Made in Brazil\n4 006381 333931\nSide A");
    expect(r[0]).toEqual({ kind: "barcode", value: "4006381333931" });
  });
  test("sem GTIN, sugere o nº de catálogo", () => {
    expect(extractDiscCodes("LP\nSHVL 804\n")).toEqual([{ kind: "catno", value: "SHVL 804" }]);
  });
});

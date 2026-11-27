import { describe, expect, test } from "bun:test";

import { deepIsStale, deepPriceFor, normalizeDeep, parseDeepText } from "../src/lib/ai-deep";

describe("deepPriceFor (preço avaliado na análise profunda)", () => {
  test("lance meu ganhando: valor atual", () => {
    expect(deepPriceFor({ winning: true, current: "R$ 80,00", nextBid: "R$ 90,00" })).toBe(
      "R$ 80,00",
    );
  });
  test("só vigiado ou lance superado: próximo lance", () => {
    expect(deepPriceFor({ winning: false, current: "R$ 80,00", nextBid: "R$ 90,00" })).toBe(
      "R$ 90,00",
    );
  });
  test("sem próximo lance conhecido cai no valor atual", () => {
    expect(deepPriceFor({ winning: false, current: "R$ 80,00", nextBid: undefined })).toBe(
      "R$ 80,00",
    );
    expect(deepPriceFor({ winning: false, current: "R$ 80,00", nextBid: "  " })).toBe("R$ 80,00");
  });
});

describe("parseDeepText (bloco profundo da resposta da IA)", () => {
  const json = JSON.stringify({
    score: 80,
    descricao: "  Álbum clássico de 1972.  ",
    estado: {
      disco: "VG+",
      capa: "EX",
      encarte: "sim",
      defeitos: ["risco leve", ""],
      inclui: ["encarte"],
      base: "texto",
    },
    sinergia: "Combina com seus interesses.",
    analytics: "Mediana de R$ 120 em 4 vendas.",
  });
  test("lê descrição, estado, sinergia e analytics", () => {
    const d = parseDeepText(`\`\`\`json\n${json}\n\`\`\``, 95);
    expect(d).toMatchObject({
      descricao: "Álbum clássico de 1972.",
      sinergia: "Combina com seus interesses.",
      analytics: "Mediana de R$ 120 em 4 vendas.",
      preco: 95,
      estado: {
        disco: "VG+",
        capa: "EX",
        encarte: "sim",
        defeitos: ["risco leve"],
        inclui: ["encarte"],
        base: "texto",
      },
    });
  });
  test("estado vazio vira null e resposta sem nada aproveitável vira null", () => {
    expect(
      parseDeepText('{"descricao":"x","estado":{"disco":null,"defeitos":[]}}', null)?.estado,
    ).toBeNull();
    expect(parseDeepText('{"score": 50}', null)).toBeNull();
    expect(parseDeepText("sem json", null)).toBeNull();
  });
  test("normalizeDeep aceita o jsonb gravado e rejeita lixo", () => {
    const d = parseDeepText(json, 10)!;
    expect(normalizeDeep(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(normalizeDeep(null)).toBeNull();
    expect(normalizeDeep([])).toBeNull();
  });
});

describe("deepIsStale (selo nota desatualizada)", () => {
  const deep = parseDeepText('{"descricao":"x"}', 50);
  test("só vale para lote com análise profunda", () => {
    expect(deepIsStale(null, 50, 200)).toBe(false);
  });
  test("preço subiu o bastante desde a análise", () => {
    expect(deepIsStale(deep, 50, 200)).toBe(true);
    expect(deepIsStale(deep, 50, 55)).toBe(false);
  });
});

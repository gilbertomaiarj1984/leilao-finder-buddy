import { describe, expect, test } from "bun:test";

import { parseConditionAiObject } from "../src/lib/ai-condition.server";
import { evalHash, parseEvalObject, parseIdentObject, titleHash } from "../src/lib/ai-eval.server";
import { marketBasis, selectLotsForMarket } from "../src/lib/lot-market.server";

describe("parseEvalObject (resposta da avaliação)", () => {
  test("lê o JSON mesmo com cerca de código e texto ao redor", () => {
    const r = parseEvalObject(
      'Claro!\n```json\n{"score": 72.6, "rarity": "raro", "deal": "barato", "album": "  Gil - Refazenda  ", "reason": "boa", "tags": ["mpb", "1975"]}\n```',
    );
    expect(r).toMatchObject({
      score: 73,
      rarity: "raro",
      deal: "barato",
      album: "Gil - Refazenda",
      reason: "boa",
      tags: ["mpb", "1975"],
    });
  });

  test("limita a nota a 0-100 e descarta rarity/deal fora da lista", () => {
    expect(parseEvalObject('{"score": 250}')?.score).toBe(100);
    expect(parseEvalObject('{"score": -4, "reason": "x"}')?.score).toBe(0);
    const r = parseEvalObject('{"score": 50, "rarity": "lendário", "deal": "baratíssimo"}');
    expect(r?.rarity).toBeNull();
    expect(r?.deal).toBeNull();
  });

  test("nota ausente ou nula NÃO vira zero", () => {
    expect(parseEvalObject('{"score": null, "reason": "sem nota"}')?.score).toBeNull();
    expect(parseEvalObject('{"reason": "sem nota"}')?.score).toBeNull();
  });

  test("limita tags (8 de até 40 caracteres) e o motivo (400)", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `t${i}${"x".repeat(60)}`);
    const r = parseEvalObject(JSON.stringify({ score: 10, tags, reason: "r".repeat(900) }));
    expect(r?.tags).toHaveLength(8);
    expect(r?.tags.every((t) => t.length <= 40)).toBe(true);
    expect(r?.reason).toHaveLength(400);
  });

  test("texto sem JSON útil devolve null", () => {
    expect(parseEvalObject("")).toBeNull();
    expect(parseEvalObject("sem json aqui")).toBeNull();
    expect(parseEvalObject("{ quebrado")).toBeNull();
    expect(parseEvalObject("{}")).toBeNull();
  });
});

describe("parseIdentObject (identificação)", () => {
  test("álbum, ano e confiança", () => {
    expect(
      parseIdentObject('{"album": "Tim Maia - Racional", "year": 1975, "confidence": "ALTA"}'),
    ).toEqual({ album: "Tim Maia - Racional", year: 1975, confidence: "alta" });
  });

  test("ano fora de 1900-2100 e confiança desconhecida viram null", () => {
    const r = parseIdentObject('{"album": "X - Y", "year": 1492, "confidence": "talvez"}');
    expect(r).toEqual({ album: "X - Y", year: null, confidence: null });
  });

  test("sem nada aproveitável devolve null", () => {
    expect(parseIdentObject('{"album": "", "year": null}')).toBeNull();
    expect(parseIdentObject("nada")).toBeNull();
  });
});

describe("parseConditionAiObject (estado lido pela IA)", () => {
  test("normaliza siglas e palavras em português", () => {
    expect(parseConditionAiObject('{"media": "vg+", "sleeve": "bom", "insert": "SIM"}')).toEqual({
      media: "VG+",
      sleeve: "VG",
      insert: "sim",
    });
    expect(parseConditionAiObject('{"media": null, "sleeve": "NM", "insert": "nao"}')).toEqual({
      media: null,
      sleeve: "NM",
      insert: "nao",
    });
  });

  test("não inventa: grau desconhecido e encarte incerto viram null", () => {
    expect(
      parseConditionAiObject('{"media": "sei lá", "sleeve": null, "insert": null}'),
    ).toBeNull();
    expect(parseConditionAiObject('{"media": "NM", "insert": "talvez"}')).toEqual({
      media: "NM",
      sleeve: null,
      insert: null,
    });
  });
});

describe("hash do prompt e basis do Discogs", () => {
  test("evalHash junta título, versão e impressão do texto do prompt", () => {
    const h = evalHash("LP A");
    expect(h.startsWith(`${titleHash("LP A")}.p`)).toBe(true);
    expect(h.split(".")).toHaveLength(3);
    expect(evalHash("LP A")).toBe(h); // estável
    expect(evalHash("LP B")).not.toBe(h);
  });

  test("marketBasis ignora acento, pontuação, parênteses e ano", () => {
    const a = marketBasis("Gilberto Gil - Raça Humana (1984)", "T1");
    const b = marketBasis("Gilberto Gil – Raca Humana", "OUTRO TÍTULO");
    expect(a).toBe(b);
    expect(a.startsWith("m2:")).toBe(true);
    expect(marketBasis("Gilberto Gil - Refazenda", "T1")).not.toBe(a);
  });

  test("sem álbum, o basis vem do título", () => {
    expect(marketBasis(null, "LP Tim Maia Racional")).toBe(marketBasis("", "lp tim maia racional"));
    expect(marketBasis(null, "LP Tim Maia Racional")).not.toBe(marketBasis(null, "LP Outro"));
  });

  test("selectLotsForMarket aceita o basis novo e o antigo (não reconsulta a base inteira)", () => {
    const lots = [
      { id: "1", title: "LP A", price: "R$ 10,00" },
      { id: "2", title: "LP B", price: "R$ 10,00" },
      { id: "3", title: "LP C", price: "R$ 10,00" },
    ];
    const albums = [
      { id: "1", album: "Fulano - A (1980)" },
      { id: "2", album: "Fulano - B" },
      { id: "3", album: "Fulano - C" },
    ];
    const legacy2 = titleHash("Fulano - B|LP B"); // formato antigo, já gravado em produção
    const rows = [
      { id: "1", basis: marketBasis("Fulano - A", "LP A") }, // álbum veio com ano de outra fonte
      { id: "2", basis: legacy2 },
    ];
    expect(selectLotsForMarket(lots, albums, rows, 10).map((l) => l.id)).toEqual(["3"]);
  });
});

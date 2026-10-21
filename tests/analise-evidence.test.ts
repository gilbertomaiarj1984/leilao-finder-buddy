import { describe, expect, test } from "bun:test";

import { buildEvidence, type EvidenceInput } from "@/lib/analise-evidence";

const base: EvidenceInput = {
  rarity: "raro",
  eco: {
    total: 125,
    ref: 400,
    ratio: 0.31,
    deal: "barato",
    capCheap: 255,
    capFair: 435,
    potential: 275,
  },
  media: "VG+",
  sleeve: "VG",
  insert: "sim",
  past: null,
  want: 300,
  have: 100,
  house: "Casa Alfa",
  houseLevel: "verde",
  lookout: true,
  interest: false,
  owned: null,
  ownedConfidentMin: 0.8,
};
const tones = (e: ReturnType<typeof buildEvidence>) => e.map((x) => x.tone);

describe("buildEvidence", () => {
  test("lote bom: tons positivos e frases com os números", () => {
    const e = buildEvidence(base);
    expect(e[0]).toEqual({ tone: "good", text: "Raridade: raro" });
    expect(e[1]!.text).toContain("barato (31% do mercado");
    expect(e[2]!.text).toBe("Estado: disco VG+, capa VG, com encarte");
    expect(e.some((x) => x.text.includes("Está no seu De olho"))).toBe(true);
    expect(e.some((x) => x.text.startsWith("Procura") && x.tone === "good")).toBe(true);
  });
  test("sem mercado, sem estado e sem vendas: tom neutro, nunca inventa", () => {
    const e = buildEvidence({
      ...base,
      eco: {
        total: 125,
        ref: null,
        ratio: null,
        deal: "indefinido",
        capCheap: null,
        capFair: null,
        potential: null,
      },
      media: null,
      sleeve: null,
      insert: null,
      want: null,
      houseLevel: null,
    });
    expect(tones(e).slice(1, 4)).toEqual(["none", "none", "none"]);
    expect(e.some((x) => x.text.startsWith("Procura"))).toBe(false);
  });
  test("já tenho: confiante x provável; estado fraco é ruim", () => {
    const sure = buildEvidence({ ...base, owned: { score: 0.9 }, media: "G+" });
    expect(sure.find((x) => x.text.startsWith("Já está"))?.tone).toBe("bad");
    expect(sure.find((x) => x.text.startsWith("Estado"))?.tone).toBe("bad");
    const maybe = buildEvidence({ ...base, owned: { score: 0.65 } });
    expect(maybe.some((x) => x.text.startsWith("Possível cópia"))).toBe(true);
  });
});

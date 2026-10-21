import { describe, expect, test } from "bun:test";

import {
  compareBy,
  demandRatio,
  gradeAtLeast,
  isSortKey,
  PRESETS,
  type RankInput,
} from "@/lib/analise-rank";
import type { LotEconomics } from "@/lib/lot-score";

const eco = (ratio: number | null, potential: number | null): LotEconomics => ({
  total: 100,
  ref: ratio ? 100 / ratio : null,
  ratio,
  deal: "justo",
  capCheap: null,
  capFair: null,
  potential,
});
const item = (over: Partial<RankInput> & { id: string }): RankInput & { id: string } => ({
  score: 50,
  eco: eco(null, null),
  dayKey: "2026-10-21",
  time: "19:30h",
  want: null,
  have: null,
  ...over,
});
const ids = (list: { id: string }[]) => list.map((i) => i.id).join(",");

describe("compareBy", () => {
  const a = item({ id: "a", score: 90, eco: eco(1.4, -40), want: 10, have: 100 });
  const b = item({ id: "b", score: 60, eco: eco(0.5, 120), want: 300, have: 100 });
  const c = item({ id: "c", score: 75, eco: eco(null, null), time: "18:00h" });
  test("nota: maior primeiro, sem nota por último", () => {
    const d = item({ id: "d", score: null });
    expect(ids([d, b, a, c].sort(compareBy("score")))).toBe("a,c,b,d");
  });
  test("melhor negócio: menor custo ÷ mercado; sem mercado no fim", () => {
    expect(ids([a, c, b].sort(compareBy("deal")))).toBe("b,a,c");
  });
  test("potencial: maior primeiro; sem mercado no fim", () => {
    expect(ids([a, c, b].sort(compareBy("potential")))).toBe("b,a,c");
  });
  test("horário: mais cedo primeiro; empate cai na nota", () => {
    const d = item({ id: "d", score: 99, time: "19:30h" });
    expect(ids([a, d, c].sort(compareBy("time")))).toBe("c,d,a");
  });
  test("procura: want ÷ have", () => {
    expect(ids([a, c, b].sort(compareBy("demand")))).toBe("b,a,c");
    expect(demandRatio(null, 5)).toBe(0);
    expect(demandRatio(40, 0)).toBe(40);
  });
  test("isSortKey valida o valor salvo", () => {
    expect(isSortKey("deal")).toBe(true);
    expect(isSortKey("outro")).toBe(false);
  });
});

describe("gradeAtLeast", () => {
  test("compara na escala do Discogs", () => {
    expect(gradeAtLeast("VG+", "VG")).toBe(true);
    expect(gradeAtLeast("G+", "VG")).toBe(false);
    expect(gradeAtLeast("NM", "NM")).toBe(true);
  });
  test("sem grau não passa; sem mínimo passa tudo", () => {
    expect(gradeAtLeast(null, "G+")).toBe(false);
    expect(gradeAtLeast(null, "")).toBe(true);
  });
});

describe("PRESETS", () => {
  const base = {
    score: 80,
    eco: {
      total: 100,
      ref: 200,
      ratio: 0.5,
      deal: "barato",
      capCheap: 115,
      capFair: 204,
      potential: 100,
    } as LotEconomics,
    dayKey: "2026-10-21",
    time: "19:30h",
    want: null,
    have: null,
    rarity: "raro",
    radar: false,
    watched: false,
    hasBid: false,
    weakDisc: false,
    ownedConfident: false,
    startsInMin: 50 as number | null,
  };
  const run = (key: string, over: Partial<typeof base> = {}) =>
    PRESETS.find((p) => p.key === key)!.test({ ...base, ...over }, "2026-10-21");
  test("garimpo do dia: hoje, nota, não caro, sem estado fraco, sem já tenho", () => {
    expect(run("garimpo")).toBe(true);
    expect(run("garimpo", { dayKey: "2026-10-22" })).toBe(false);
    expect(run("garimpo", { score: 60 })).toBe(false);
    expect(run("garimpo", { weakDisc: true })).toBe(false);
    expect(run("garimpo", { ownedConfident: true })).toBe(false);
  });
  test("começando logo: até 2h antes ou 3h depois do início", () => {
    expect(run("logo")).toBe(true);
    expect(run("logo", { startsInMin: 121 })).toBe(false);
    expect(run("logo", { startsInMin: -170 })).toBe(true);
    expect(run("logo", { startsInMin: -200 })).toBe(false);
    expect(run("logo", { startsInMin: null })).toBe(false);
  });
  test("pechinchas, raros, radar e meus", () => {
    expect(run("pechincha")).toBe(true);
    expect(run("pechincha", { weakDisc: true })).toBe(false);
    expect(run("raros", { rarity: "comum" })).toBe(false);
    expect(run("radar")).toBe(false);
    expect(run("radar", { radar: true })).toBe(true);
    expect(run("meus", { hasBid: true })).toBe(true);
  });
});

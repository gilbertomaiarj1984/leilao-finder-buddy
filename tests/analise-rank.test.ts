import { describe, expect, test } from "bun:test";

import {
  compareBy,
  demandRatio,
  gradeAtLeast,
  isSortKey,
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

import { describe, expect, test } from "bun:test";

import {
  calibrationHints,
  conditionStats,
  dealAtPurchase,
  dealStats,
  normalizeSnapshot,
  optimismSteps,
  scoreStats,
  type CalibrationRow,
  type CalibrationSnapshot,
} from "../src/lib/calibration";

const snap = (over: Partial<CalibrationSnapshot> = {}): CalibrationSnapshot => ({
  takenAt: "2026-10-01T00:00:00Z",
  price: "R$ 40,00",
  ai: { score: 70, rarity: "raro", deal: "barato", album: null, reason: null, evalPrice: 40 },
  cond: null,
  market: null,
  pastSales: null,
  ...over,
});

const row = (over: Partial<CalibrationRow> = {}): CalibrationRow => ({
  lotId: "1-1",
  idLeilao: "1",
  title: "LP",
  label: "LP",
  image: null,
  house: "Casa",
  wonPrice: "R$ 40,00",
  wonDate: null,
  receivedAt: null,
  snapshot: null,
  read: { media: "", sleeve: "" },
  real: { media: "", sleeve: "" },
  realScore: null,
  verdict: "",
  note: "",
  ...over,
});

describe("calibração — estado", () => {
  test("optimismSteps: positivo = o disco chegou pior do que o lido", () => {
    expect(optimismSteps("VG+", "VG")).toBe(1);
    expect(optimismSteps("VG", "VG+")).toBe(-1);
    expect(optimismSteps("NM", "NM")).toBe(0);
    expect(optimismSteps("", "NM")).toBeNull();
    expect(optimismSteps("M-", "VG")).toBe(3); // M- vale NM
  });

  test("estatísticas e matriz «lido → real»", () => {
    const rows = [
      row({ read: { media: "VG+", sleeve: "" }, real: { media: "VG", sleeve: "" } }),
      row({ read: { media: "VG+", sleeve: "" }, real: { media: "VG", sleeve: "" } }),
      row({ read: { media: "VG+", sleeve: "" }, real: { media: "VG+", sleeve: "" } }),
      row({ read: { media: "NM", sleeve: "" }, real: { media: "G+", sleeve: "" } }),
      row({ read: { media: "", sleeve: "" }, real: { media: "VG", sleeve: "" } }), // sem leitura: fora
    ];
    const s = conditionStats(rows, "media");
    expect(s.n).toBe(4);
    expect(s.exact).toBe(1);
    expect(s.withinOne).toBe(3);
    expect(s.optimism).toBe(1.75); // (1 + 1 + 0 + 5) / 4
    expect(s.matrix.map((m) => [m.read, m.n])).toEqual([
      ["NM", 1],
      ["VG+", 3],
    ]);
    expect(s.matrix.find((m) => m.read === "VG+")!.real).toEqual([
      { grade: "VG+", n: 1 },
      { grade: "VG", n: 2 },
    ]);
  });

  test("dica só com amostra mínima e maioria clara", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      row({
        read: { media: "VG+", sleeve: "" },
        real: { media: i === 0 ? "VG+" : "VG", sleeve: "" },
      }),
    );
    expect(calibrationHints(conditionStats(rows, "media"))[0]).toContain(
      "VG+ chegaram piores em 3 de 4",
    );
    expect(calibrationHints(conditionStats(rows.slice(0, 2), "media"))).toEqual([]);
  });
});

describe("calibração — nota e veredicto", () => {
  test("scoreStats: erro absoluto médio e viés", () => {
    const rows = [
      row({ snapshot: snap({ ai: { ...snap().ai!, score: 80 } }), realScore: 60 }),
      row({ snapshot: snap({ ai: { ...snap().ai!, score: 50 } }), realScore: 60 }),
      row({ snapshot: snap(), realScore: null }), // sem nota do usuário: fora
      row({ snapshot: null, realScore: 90 }), // sem snapshot: fora
    ];
    expect(scoreStats(rows)).toEqual({ n: 2, mae: 15, bias: 5 });
    expect(scoreStats([])).toEqual({ n: 0, mae: 0, bias: 0 });
  });

  test("veredicto na época: mercado vence a IA; indefinido cai para a IA", () => {
    expect(
      dealAtPurchase(
        snap({ market: { verdict: "caro", anchorCondition: "VG", anchorPrice: 30, freight: 25 } }),
      ),
    ).toBe("caro");
    expect(
      dealAtPurchase(
        snap({
          market: {
            verdict: "indefinido",
            anchorCondition: null,
            anchorPrice: null,
            freight: null,
          },
        }),
      ),
    ).toBe("barato");
    expect(dealAtPurchase(null)).toBeNull();
  });

  test("dealStats: acerto = barato→valeu, justo→ok/valeu, caro→não valeu/ok", () => {
    const rows = [
      row({ snapshot: snap(), verdict: "valeu" }), // barato→valeu ✔
      row({ snapshot: snap(), verdict: "nao_valeu" }), // barato→não valeu ✘
      row({ snapshot: snap({ ai: { ...snap().ai!, deal: "caro" } }), verdict: "nao_valeu" }), // ✔
      row({ snapshot: snap(), verdict: "" }), // sem opinião: fora
    ];
    const d = dealStats(rows);
    expect(d.n).toBe(3);
    expect(d.hits).toBe(2);
    expect(d.table.find((t) => t.deal === "barato")!.byVerdict).toEqual({
      valeu: 1,
      ok: 0,
      nao_valeu: 1,
    });
  });
});

describe("calibração — snapshot do banco", () => {
  test("normalizeSnapshot aceita o formato gravado e descarta lixo", () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot({ price: "x" })).toBeNull();
    const ok = normalizeSnapshot({
      takenAt: "2026-10-01T00:00:00Z",
      price: "R$ 40,00",
      ai: { score: 77, deal: "justo", extra: 1 },
      cond: { media: "VG+", sleeve: "VG", insert: "sim", score: 70, source: "catalog" },
      market: { verdict: "estranho", anchorCondition: "VG+", anchorPrice: 50, freight: 25 },
      pastSales: { count: 0, median: 0 },
    });
    expect(ok?.ai?.score).toBe(77);
    expect(ok?.market?.verdict).toBe("indefinido");
    expect(ok?.pastSales).toBeNull();
    expect(ok?.cond?.media).toBe("VG+");
  });
});

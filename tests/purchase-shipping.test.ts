import { describe, expect, test } from "bun:test";

import {
  canBundle,
  isUnpaid,
  daysBetween,
  groupByPregao,
  groupByHouse,
  guardDays,
  previewShipment,
  spendingByPeriod,
  summarizeByStatus,
  totalsByHouse,
  type AuctionState,
} from "../src/lib/purchase-shipping";

const p = (idLeilao: string, house: string, wonDate: string | null, wonPrice: string) => ({
  idLeilao,
  house,
  uf: "RJ",
  wonDate,
  wonPrice,
});
const st = (idLeilao: string, status: AuctionState["status"], paidAt: string | null = null) => ({
  idLeilao,
  status,
  paidAt,
  receivedAt: null,
  note: "",
  shipmentId: null,
});

const purchases = [
  p("10", "Beta", "2026-10-03", "R$ 70,00"),
  p("10", "Beta", "2026-10-03", "R$ 1.080,50"),
  p("20", "Beta", "2026-10-08", "R$ 100,00"),
  p("30", "Alfa", "2026-10-10", "R$ 90,00"),
  p("05", "Alfa", null, "sem valor"),
];

describe("groupByPregao", () => {
  const groups = groupByPregao(purchases, {
    auctions: [st("20", "guarda", "2026-10-09")],
    shipments: [],
  });
  test("ordena do mais recente ao mais antigo, sem data por último", () => {
    expect(groups.map((g) => g.idLeilao)).toEqual(["30", "20", "10", "05"]);
  });
  test("soma o valor pago e conta discos", () => {
    const g = groups.find((x) => x.idLeilao === "10")!;
    expect(g.total).toBeCloseTo(1150.5);
    expect(g.purchases).toHaveLength(2);
  });
  test("sem linha gravada = em aberto", () => {
    expect(groups.find((x) => x.idLeilao === "30")!.state.status).toBe("aberto");
    expect(groups.find((x) => x.idLeilao === "20")!.state.status).toBe("guarda");
  });
  test("resumo por status", () => {
    const s = summarizeByStatus(groups);
    expect(s.aberto.auctions).toBe(3);
    expect(s.guarda).toEqual({ auctions: 1, discs: 1, total: 100 });
  });
});

describe("guarda e remessa", () => {
  test("daysBetween", () => {
    expect(daysBetween("2026-09-27", "2026-10-12")).toBe(15);
    expect(daysBetween("2026-10-12", "2026-10-12")).toBe(0);
  });
  test("guardDays só vale para pregão na guarda com data de pagamento", () => {
    expect(guardDays({ state: st("1", "guarda", "2026-10-02") }, "2026-10-12")).toBe(10);
    expect(guardDays({ state: st("1", "pago", "2026-10-02") }, "2026-10-12")).toBeNull();
    expect(guardDays({ state: st("1", "guarda") }, "2026-10-12")).toBeNull();
  });
  test("canBundle exige guarda e mesma casa", () => {
    const a = { state: st("1", "guarda"), house: "Beta" };
    const b = { state: st("2", "guarda"), house: "Beta" };
    expect(canBundle([a, b])).toBe(true);
    expect(canBundle([a, { ...b, house: "Alfa" }])).toBe(false);
    expect(canBundle([a, { ...b, state: st("2", "pago") }])).toBe(false);
    expect(canBundle([])).toBe(false);
  });
  test("previewShipment estima a economia de frete", () => {
    const groups = groupByPregao(purchases.slice(0, 3), { auctions: [], shipments: [] });
    const pv = previewShipment(groups, 40);
    expect(pv).toMatchObject({ auctions: 2, discs: 3, savedShipments: 1, estimatedSaving: 40 });
    expect(pv.total).toBeCloseTo(1250.5);
  });
});

describe("status em aberto", () => {
  test("novo e aguardando frete contam como não pagos", () => {
    expect(isUnpaid("aberto")).toBe(true);
    expect(isUnpaid("frete")).toBe(true);
    expect(isUnpaid("pago")).toBe(false);
    expect(isUnpaid("recebido")).toBe(false);
  });
  test("resumo separa novo de aguardando frete", () => {
    const groups = groupByPregao(purchases, {
      auctions: [st("30", "frete"), st("20", "recebido", "2026-10-09")],
      shipments: [],
    });
    const s = summarizeByStatus(groups);
    expect(s.frete.auctions).toBe(1);
    expect(s.aberto.auctions).toBe(2);
    expect(s.recebido.auctions).toBe(1);
  });
});

describe("totais por casa e agrupamento", () => {
  const groups = groupByPregao(purchases, { auctions: [], shipments: [] });
  test("soma taxa de 5% por casa e total geral", () => {
    const { houses, grand } = totalsByHouse(groups);
    expect(houses.map((h) => h.house)).toEqual(["Alfa", "Beta"]);
    const beta = houses.find((h) => h.house === "Beta")!;
    expect(beta.subtotal).toBeCloseTo(1250.5);
    expect(beta.fee).toBeCloseTo(62.53);
    expect(beta.total).toBeCloseTo(1313.03);
    expect(grand.subtotal).toBeCloseTo(1340.5);
    expect(grand.total).toBeCloseTo(houses[0]!.total + beta.total);
    expect(grand.auctions).toBe(4);
  });
  test("groupByHouse agrupa por casa em ordem alfabética", () => {
    const g = groupByHouse(groups);
    expect(g.map((x) => x.house)).toEqual(["Alfa", "Beta"]);
    expect(g[1]!.groups.map((x) => x.idLeilao)).toEqual(["20", "10"]);
  });
});

describe("gasto por período", () => {
  const groups = groupByPregao(
    [
      ...purchases,
      p("40", "Beta", "2025-12-20", "R$ 200,00"),
      p("41", "Beta", "2026-09-02", "R$ 100,00"),
    ],
    { auctions: [], shipments: [] },
  );
  test("por ano, mais recente primeiro, com sem data no fim e histórico geral", () => {
    const { rows, overall } = spendingByPeriod(groups, "year");
    expect(rows.map((r) => r.key)).toEqual(["2026", "2025", ""]);
    expect(rows[0]!.subtotal).toBeCloseTo(1440.5);
    expect(rows[1]!.total).toBeCloseTo(210);
    expect(overall.subtotal).toBeCloseTo(1640.5);
    expect(overall.auctions).toBe(6);
  });
  test("por mês", () => {
    const { rows } = spendingByPeriod(groups, "month");
    expect(rows.map((r) => r.key)).toEqual(["2026-10", "2026-09", "2025-12", ""]);
    expect(rows[0]!.subtotal).toBeCloseTo(1340.5);
  });
});

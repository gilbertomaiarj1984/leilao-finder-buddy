import { describe, expect, test } from "bun:test";

import {
  canBundle,
  daysBetween,
  groupByPregao,
  guardDays,
  previewShipment,
  summarizeByStatus,
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

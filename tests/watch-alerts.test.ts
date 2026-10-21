import { describe, expect, test } from "bun:test";

import { capAlertText, decideCapAlerts } from "@/lib/bid-cap-alerts";
import {
  confirmNotified,
  normalizeNotified,
  pickStartingAuctions,
  reserveNotified,
  startingAlertText,
  type WatchedForAlert,
} from "@/lib/watch-alerts";

// 2026-10-21 18:40 em São Paulo
const NOW = new Date("2026-10-21T21:40:00Z").getTime();
const w = (over: Partial<WatchedForAlert>): WatchedForAlert => ({
  id: "100-1",
  idLeilao: "100",
  house: "Casa Alfa",
  date: "21/10/2026",
  time: "19:00h",
  lote: "12",
  ...over,
});

describe("pickStartingAuctions", () => {
  test("agrupa por pregão, ordena os lotes e só pega a janela de 30 min", () => {
    const got = pickStartingAuctions(
      [
        w({ id: "100-a", lote: "40" }),
        w({ id: "100-b", lote: "9" }),
        w({ id: "200-a", idLeilao: "200", time: "20:30h" }),
        w({ id: "300-a", idLeilao: "300", time: "18:00h" }),
      ],
      NOW,
      {},
    );
    expect(got.map((a) => a.key)).toEqual(["100|2026-10-21"]);
    expect(got[0]!.lotes).toEqual(["9", "40"]);
    expect(got[0]!.startsIn).toBe(20);
  });
  test("tolera pouco atraso do agendador, mas não pregão que começou há muito", () => {
    expect(pickStartingAuctions([w({ time: "18:35h" })], NOW, {})).toHaveLength(1);
    expect(pickStartingAuctions([w({ time: "18:20h" })], NOW, {})).toHaveLength(0);
  });
  test("ignora data/horário ilegíveis", () => {
    expect(pickStartingAuctions([w({ date: "" }), w({ time: "" })], NOW, {})).toHaveLength(0);
  });
  test("formato antigo (lista de chaves) conta o pregão inteiro como avisado", () => {
    const old = normalizeNotified(["100|2026-10-21"]);
    expect(pickStartingAuctions([w({})], NOW, old)).toHaveLength(0);
  });
  test("não repete lote já avisado, mas avisa o lote vigiado DEPOIS do aviso", () => {
    const sent = confirmNotified(
      reserveNotified({}, pickStartingAuctions([w({ id: "100-1", lote: "12" })], NOW, {}), NOW),
      ["100|2026-10-21"],
      NOW,
    );
    expect(pickStartingAuctions([w({ id: "100-1", lote: "12" })], NOW + 60_000, sent)).toHaveLength(
      0,
    );
    const next = pickStartingAuctions(
      [w({ id: "100-1", lote: "12" }), w({ id: "100-2", lote: "30" })],
      NOW + 60_000,
      sent,
    );
    expect(next).toHaveLength(1);
    expect(next[0]!.lotes).toEqual(["30"]);
  });
  test("reservado e não confirmado: vale por 10 min (cancelamento não reavisa), depois volta", () => {
    const auctions = pickStartingAuctions([w({})], NOW, {});
    const reserved = reserveNotified({}, auctions, NOW);
    expect(reserved["100|2026-10-21"]!.state).toBe("sending");
    expect(pickStartingAuctions([w({})], NOW + 5 * 60_000, reserved)).toHaveLength(0);
    expect(pickStartingAuctions([w({})], NOW + 11 * 60_000, reserved)).toHaveLength(1);
  });
  test("lixo em app_state vira registro vazio", () => {
    expect(normalizeNotified(null)).toEqual({});
    expect(
      normalizeNotified({ a: { at: "x" }, b: { at: 1, state: "sent", lotIds: ["1"] } }),
    ).toEqual({
      b: { at: 1, state: "sent", lotIds: ["1"] },
    });
  });
});

describe("startingAlertText", () => {
  test("um pregão: título no singular; vários: contagem", () => {
    const one = startingAlertText([
      { key: "k", house: "Casa Alfa", startsIn: 20, lotes: ["9", "40"] },
    ]);
    expect(one.title).toBe("Pregão de lote vigiado começando");
    expect(one.body).toBe("Casa Alfa começa em 20 min — lote(s) 9, 40");
    const two = startingAlertText([
      { key: "a", house: "A", startsIn: 0, lotes: [] },
      { key: "b", house: "B", startsIn: 5, lotes: ["1"] },
    ]);
    expect(two.title).toBe("2 pregões com lotes vigiados");
    expect(two.body).toContain("A começa agora");
  });
});

describe("decideCapAlerts (alerta de teto de lance)", () => {
  const it = (id: string, price: number, capCheap: number | null = 100) => ({
    id,
    title: `Lote ${id}`,
    house: "Casa Alfa",
    price,
    capCheap,
  });

  test("avisa quando o lote entra na faixa barata (inclusive o que já era barato ao vigiar)", () => {
    const { alerts, next } = decideCapAlerts([it("a", 80), it("b", 150)], {});
    expect(alerts.map((a) => [a.id, a.kind])).toEqual([["a", "entered"]]);
    expect(next).toEqual({ a: "below", b: "above" });
  });
  test("não repete enquanto continua abaixo do teto", () => {
    expect(decideCapAlerts([it("a", 90)], { a: "below" }).alerts).toEqual([]);
  });
  test("avisa quando o lance passa do teto de quem estava abaixo, e só desses", () => {
    const { alerts } = decideCapAlerts([it("a", 120), it("b", 120)], { a: "below", b: "above" });
    expect(alerts.map((a) => [a.id, a.kind])).toEqual([["a", "left"]]);
  });
  test("sem mercado (teto nulo) não avisa e sai do registro; teto exato conta como dentro", () => {
    const { alerts, next } = decideCapAlerts([it("a", 50, null), it("b", 100)], { a: "below" });
    expect(alerts.map((a) => a.id)).toEqual(["b"]);
    expect(next).toEqual({ b: "below" });
  });
  test("texto do aviso", () => {
    const one = capAlertText([{ ...it("a", 80), kind: "entered" }]);
    expect(one.title).toBe("Lote vigiado dentro do teto");
    expect(one.body).toBe("↓ Lote a (Casa Alfa): R$ 80 · teto R$ 100");
    const mix = capAlertText([
      { ...it("a", 80), kind: "entered" },
      { ...it("b", 120), kind: "left" },
    ]);
    expect(mix.title).toBe("2 lotes vigiados cruzaram o teto");
  });
});

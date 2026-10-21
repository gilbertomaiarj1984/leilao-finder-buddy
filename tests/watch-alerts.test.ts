import { describe, expect, test } from "bun:test";

import { pickStartingAuctions, startingAlertText, type WatchedForAlert } from "@/lib/watch-alerts";

// 2026-10-21 18:40 em São Paulo
const NOW = new Date("2026-10-21T21:40:00Z").getTime();
const w = (over: Partial<WatchedForAlert>): WatchedForAlert => ({
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
        w({ lote: "40" }),
        w({ lote: "9" }),
        w({ idLeilao: "200", time: "20:30h" }),
        w({ idLeilao: "300", time: "18:00h" }),
      ],
      NOW,
      new Set(),
    );
    expect(got.map((a) => a.key)).toEqual(["100|2026-10-21"]);
    expect(got[0]!.lotes).toEqual(["9", "40"]);
    expect(got[0]!.startsIn).toBe(20);
  });
  test("tolera pouco atraso do agendador, mas não pregão que começou há muito", () => {
    expect(pickStartingAuctions([w({ time: "18:35h" })], NOW, new Set())).toHaveLength(1);
    expect(pickStartingAuctions([w({ time: "18:20h" })], NOW, new Set())).toHaveLength(0);
  });
  test("não repete pregão já avisado e ignora data/horário ilegíveis", () => {
    expect(pickStartingAuctions([w({})], NOW, new Set(["100|2026-10-21"]))).toHaveLength(0);
    expect(pickStartingAuctions([w({ date: "" }), w({ time: "" })], NOW, new Set())).toHaveLength(
      0,
    );
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

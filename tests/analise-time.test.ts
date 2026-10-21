import { describe, expect, test } from "bun:test";

import { auctionChip, lotIsClosed, startsInMinutes } from "@/lib/analise-time";

// 2026-10-21 18:40 em São Paulo (UTC-3)
const NOW = new Date("2026-10-21T21:40:00Z").getTime();
const base = { dayKey: "2026-10-21", time: "19:30h", lote: "88", nowMs: NOW, progress: null };

describe("startsInMinutes", () => {
  test("minutos até o início, negativo se já começou", () => {
    expect(startsInMinutes("2026-10-21", "19:30h", NOW)).toBe(50);
    expect(startsInMinutes("2026-10-21", "18:00h", NOW)).toBe(-40);
    expect(startsInMinutes("2026-10-21", "", NOW)).toBeNull();
  });
});

describe("auctionChip", () => {
  test("ainda não começou: em N min; ≤ 30 min é alerta; > 24 h não vira chip", () => {
    expect(auctionChip(base)).toMatchObject({ label: "começa em 50 min", tone: "info" });
    expect(auctionChip({ ...base, time: "19:00h" })).toMatchObject({
      label: "começa em 20 min",
      tone: "warn",
    });
    expect(auctionChip({ ...base, time: "22:00h" })?.label).toBe("começa em 3h20");
    expect(auctionChip({ ...base, dayKey: "2026-10-23" })).toBeNull();
    expect(auctionChip({ ...base, time: "" })).toBeNull();
  });
  test("começou e há andamento: faltam N lotes, já passou, em pregão agora", () => {
    const live = (cur: string) => ({
      status: "live" as const,
      currentLote: cur,
      total: 120,
      peca: 41,
    });
    const started = { ...base, time: "18:00h" };
    expect(auctionChip({ ...started, progress: live("41") })).toMatchObject({
      label: "ao vivo · lote 41/120 · faltam 47",
      tone: "live",
    });
    expect(auctionChip({ ...started, lote: "44", progress: live("41") })?.tone).toBe("warn");
    expect(auctionChip({ ...started, lote: "12", progress: live("41") })?.label).toContain(
      "já passou",
    );
    expect(auctionChip({ ...started, lote: "41", progress: live("41") })?.label).toContain(
      "em pregão agora",
    );
    expect(auctionChip({ ...started, lote: "", progress: live("41") })?.label).toContain(
      "em pregão agora",
    );
  });
  test("encerrado e sem andamento", () => {
    const started = { ...base, time: "18:00h" };
    expect(
      auctionChip({
        ...started,
        progress: { status: "ended", currentLote: null, total: null, peca: null },
      })?.label,
    ).toBe("pregão encerrado");
    expect(auctionChip(started)?.label).toBe("ao vivo");
    expect(auctionChip({ ...started, dayKey: "2026-10-20" })).toBeNull(); // > 6 h atrás, sem sinal
  });
});

describe("lotIsClosed", () => {
  const base = {
    dayKey: "2026-10-21",
    todayKey: "2026-10-21",
    lote: "88",
    bidStatus: null,
    progress: null,
  };
  const live = (cur: string) => ({
    status: "live" as const,
    currentLote: cur,
    total: 120,
    peca: 41,
  });
  test("dia anterior a hoje acabou, mesmo vigiado", () => {
    expect(lotIsClosed({ ...base, dayKey: "2026-10-20" })).toBe(true);
    expect(lotIsClosed(base)).toBe(false);
    expect(lotIsClosed({ ...base, dayKey: "" })).toBe(false);
  });
  test("meu lance com resultado final encerra; lance em disputa não", () => {
    for (const s of ["Vendido", "Coberto e Vendido", "Vencedor", "Arrematado", "Não vendido"])
      expect(lotIsClosed({ ...base, bidStatus: s })).toBe(true);
    for (const s of ["Vencendo", "Coberto"])
      expect(lotIsClosed({ ...base, bidStatus: s })).toBe(false);
  });
  test("pregão terminado ou que já passou deste lote encerra; lote à frente não", () => {
    expect(
      lotIsClosed({
        ...base,
        progress: { status: "ended", currentLote: null, total: null, peca: null },
      }),
    ).toBe(true);
    expect(lotIsClosed({ ...base, progress: live("120") })).toBe(true);
    expect(lotIsClosed({ ...base, progress: live("41") })).toBe(false);
    expect(lotIsClosed({ ...base, lote: "", progress: live("41") })).toBe(false);
  });
});

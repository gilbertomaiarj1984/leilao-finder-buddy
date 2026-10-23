import { describe, expect, test } from "bun:test";

import { createAccountCache } from "@/lib/account-cache.server";
import { parseLotScope } from "@/lib/lot-scope";
import { recentDayKeys, upcomingDayKeys } from "@/lib/vinyl-parse";
import { accumSnapshot, mergeWatchedAccum } from "@/lib/watched-accum";

// Desempenho das telas (v0.155.0) — ver docs/areas/ui.md, "Desempenho das telas".

/** dayKey `YYYY-MM-DD` → data da conta `dd/mm/yyyy`. */
const br = (dayKey: string) => dayKey.split("-").reverse().join("/");
const today = upcomingDayKeys(1)[0]!;
const tomorrow = upcomingDayKeys(2)[1]!;
const yesterday = recentDayKeys(2)[1]!;
const longAgo = recentDayKeys(6)[5]!;

describe("accumSnapshot (placeholder de vigiados/lances)", () => {
  test("vazio → undefined (a tela mostra o carregando normal)", () => {
    expect(accumSnapshot(new Map())).toBeUndefined();
  });

  test("vigiado de dia passado sai; de hoje/futuro fica, sem olhar o fetch", () => {
    const acc = new Map([
      ["a", { id: "a", date: br(yesterday), time: "20:00" }],
      ["b", { id: "b", date: br(today), time: "23:59" }],
      ["c", { id: "c", date: br(tomorrow), time: "10:00" }],
    ]);
    expect(accumSnapshot(acc)!.map((i) => i.id)).toEqual(["b", "c"]);
    expect(acc.size).toBe(3); // não altera o acumulador
  });

  test("lance: retenção de 2 dias para trás; futuro nunca sai", () => {
    const acc = new Map([
      ["a", { id: "a", date: br(yesterday) }],
      ["b", { id: "b", date: br(longAgo) }],
      ["c", { id: "c", date: br(tomorrow) }],
    ]);
    expect(accumSnapshot(acc)!.map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("mergeWatchedAccum (mesma regra depois da extração de accumItemExpired)", () => {
  test("vigiado que sumiu do fetch com o leilão ainda por começar sai; o presente fica", () => {
    const acc = new Map([
      ["a", { id: "a", date: br(tomorrow), time: "10:00" }],
      ["b", { id: "b", date: br(tomorrow), time: "10:00" }],
    ]);
    const out = mergeWatchedAccum(acc, [{ id: "b", date: br(tomorrow), time: "10:00" }], "k");
    expect(out.map((i) => i.id)).toEqual(["b"]);
  });

  test("leilão já iniciado: sem registro de desvigiado o item fica; com ele (outro aparelho) sai", () => {
    const item = { id: "a", date: br(today), time: "00:01" };
    expect(mergeWatchedAccum(new Map([["a", item]]), [], "k").map((i) => i.id)).toEqual(["a"]);
    expect(mergeWatchedAccum(new Map([["a", item]]), [], "k", new Set(["a"]))).toEqual([]);
    // se a conta ainda traz o lote (revigiado), o registro não o derruba
    expect(
      mergeWatchedAccum(new Map([["a", item]]), [item], "k", new Set(["a"])).map((i) => i.id),
    ).toEqual(["a"]);
  });

  test("lance ausente do fetch fica (só a data poda lances)", () => {
    const acc = new Map([["a", { id: "a", date: br(yesterday) }]]);
    expect(mergeWatchedAccum(acc, [], "k").map((i) => i.id)).toEqual(["a"]);
  });
});

describe("createAccountCache", () => {
  test("reaproveita a leitura em andamento e a recente; maxAge 0 lê de novo", async () => {
    let calls = 0;
    const cache = createAccountCache(async () => ++calls);
    const [a, b] = await Promise.all([cache.get(0), cache.get(0)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await cache.get(60_000)).toBe(1);
    expect(await cache.get(0)).toBe(2);
  });

  test("invalidate força nova leitura; erro não fica em cache", async () => {
    let calls = 0;
    const cache = createAccountCache(async () => {
      calls += 1;
      if (calls === 2) throw new Error("falhou");
      return calls;
    });
    expect(await cache.get(60_000)).toBe(1);
    cache.invalidate();
    await expect(cache.get(60_000)).rejects.toThrow("falhou");
    expect(await cache.get(60_000)).toBe(3);
  });
});

test("parseLotScope aceita só core/rest", () => {
  expect(parseLotScope({ scope: "core" })).toBe("core");
  expect(parseLotScope({ scope: "rest" })).toBe("rest");
  expect(parseLotScope({ scope: "tudo" })).toBeUndefined();
  expect(parseLotScope(undefined)).toBeUndefined();
});

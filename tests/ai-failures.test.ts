import { describe, expect, test } from "bun:test";

import {
  clearFailures,
  MAX_ATTEMPTS,
  normalizeFailureMap,
  pruneFailures,
  recordFailures,
  RETRY_AFTER_MS,
  skippableIds,
} from "@/lib/ai-failures";

const DAY = 24 * 60 * 60 * 1000;
const hashes: Record<string, string> = { a: "h1", b: "h2" };
const hashOf = (id: string) => hashes[id] ?? null;

describe("falhas da IA por lote", () => {
  test("pula o lote só depois de falhar MAX_ATTEMPTS vezes seguidas com o mesmo hash", () => {
    let map = recordFailures({}, [{ id: "a", hash: "h1" }], 1000);
    expect(skippableIds(map, hashOf, 2000).has("a")).toBe(false);
    map = recordFailures(map, [{ id: "a", hash: "h1" }], 2000);
    expect(map["a"]!.n).toBe(MAX_ATTEMPTS);
    expect(skippableIds(map, hashOf, 3000).has("a")).toBe(true);
  });
  test("título mudou (hash novo): a contagem recomeça e o lote volta à fila", () => {
    let map = recordFailures({}, [{ id: "a", hash: "h1" }], 1);
    map = recordFailures(map, [{ id: "a", hash: "h1" }], 2);
    expect(skippableIds(map, () => "h-novo", 3).size).toBe(0);
    map = recordFailures(map, [{ id: "a", hash: "h-novo" }], 4);
    expect(map["a"]!.n).toBe(1);
  });
  test("passado RETRY_AFTER_MS o lote ganha outra chance", () => {
    const map = recordFailures(
      recordFailures({}, [{ id: "a", hash: "h1" }], 0),
      [{ id: "a", hash: "h1" }],
      0,
    );
    expect(skippableIds(map, hashOf, RETRY_AFTER_MS - 1).has("a")).toBe(true);
    expect(skippableIds(map, hashOf, RETRY_AFTER_MS + 1).has("a")).toBe(false);
  });
  test("sucesso limpa o registro; entradas velhas são descartadas", () => {
    const map = recordFailures(
      {},
      [
        { id: "a", hash: "h1" },
        { id: "b", hash: "h2" },
      ],
      0,
    );
    expect(Object.keys(clearFailures(map, ["a"]))).toEqual(["b"]);
    expect(Object.keys(pruneFailures(map, 20 * DAY))).toEqual([]);
  });
  test("lixo em app_state vira mapa vazio", () => {
    expect(normalizeFailureMap(null)).toEqual({});
    expect(normalizeFailureMap([1, 2])).toEqual({});
    expect(normalizeFailureMap({ a: { n: "x" }, b: { n: 2, hash: "h", at: 5 } })).toEqual({
      b: { n: 2, hash: "h", at: 5 },
    });
  });
});

import { describe, expect, test } from "bun:test";

import {
  mutateJsonState,
  parseStringList,
  parseStringMap,
  unionStrings,
  type SqlLike,
} from "@/lib/app-state-mutate.server";

/** Postgres falso: uma linha por chave, `begin` serializa como o `FOR UPDATE` faria. */
function fakeSql(initial: Record<string, unknown> = {}, failSelect = false) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const log: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const sql: SqlLike = {
    begin: <T>(fn: Parameters<SqlLike["begin"]>[0]) => {
      const run = chain.then(async () => {
        const pending = new Map<string, unknown>();
        const tx = Object.assign(
          async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const text = strings.join("?");
            log.push(text.split(" ")[0]!);
            if (text.startsWith("insert")) {
              const key = values[0] as string;
              if (!store.has(key)) pending.set(key, {});
              return [];
            }
            if (text.startsWith("select")) {
              if (failSelect) throw new Error("blip de leitura");
              const key = values[0] as string;
              return [{ value: pending.has(key) ? pending.get(key) : store.get(key) }];
            }
            pending.set(values[1] as string, values[0]);
            return [];
          },
          { json: (v: unknown) => v },
        );
        const result = await fn(tx as never);
        for (const [k, v] of pending) store.set(k, v);
        return result;
      });
      chain = run.catch(() => undefined);
      return run as Promise<T>;
    },
  };
  return { sql, store, log };
}

describe("mutateJsonState", () => {
  test("acrescenta ao valor existente", async () => {
    const { sql, store } = fakeSql({ k: ["a"] });
    await mutateJsonState(sql, "k", parseStringList, (cur) => unionStrings(cur, ["b", "a"]));
    expect(store.get("k")).toEqual(["a", "b"]);
  });

  test("chave inexistente começa do vazio", async () => {
    const { sql, store } = fakeSql();
    await mutateJsonState(sql, "k", parseStringList, (cur) => unionStrings(cur, ["x"]));
    expect(store.get("k")).toEqual(["x"]);
  });

  test("erro de leitura aborta SEM gravar (não apaga o que já existia)", async () => {
    const { sql, store } = fakeSql({ k: ["a", "b", "c"] }, true);
    await expect(
      mutateJsonState(sql, "k", parseStringList, (cur) => unionStrings(cur, ["novo"])),
    ).rejects.toThrow("blip de leitura");
    expect(store.get("k")).toEqual(["a", "b", "c"]);
  });

  test("escritas simultâneas não perdem itens", async () => {
    const { sql, store } = fakeSql({ k: [] });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateJsonState(sql, "k", parseStringList, (cur) => unionStrings(cur, [`i${i}`])),
      ),
    );
    expect((store.get("k") as string[]).length).toBe(20);
  });

  test("mapas: remove e acrescenta chaves sem tocar nas outras", async () => {
    const { sql, store } = fakeSql({ m: { a: "1", b: "2" } });
    await mutateJsonState(sql, "m", parseStringMap, (map) => {
      delete map["a"];
      map["c"] = "3";
      return map;
    });
    expect(store.get("m")).toEqual({ b: "2", c: "3" });
  });
});

describe("normalizadores", () => {
  test("parseStringList ignora lixo", () => {
    expect(parseStringList(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(parseStringList({})).toEqual([]);
  });
  test("parseStringMap só aceita strings não vazias", () => {
    expect(parseStringMap({ a: "x", b: " ", c: 3 })).toEqual({ a: "x" });
    expect(parseStringMap([1])).toEqual({});
  });
});

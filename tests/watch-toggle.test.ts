import { describe, expect, test } from "bun:test";

import { fetchAttempts } from "@/lib/leiloesbr-auth.server";
import { toggleWatchWith } from "@/lib/leiloesbr-watch.server";

const target = { idPeca: "1", idLeilao: "2", base: "0" };

function fakes(opts: { posts: (boolean | Error)[]; watched?: boolean }) {
  const calls = { post: 0, read: 0 };
  const queue = [...opts.posts];
  return {
    calls,
    deps: {
      post: async () => {
        calls.post += 1;
        const next = queue.shift();
        if (next === undefined) throw new Error("POST inesperado");
        if (next instanceof Error) throw next;
        return next;
      },
      isWatched: async () => {
        calls.read += 1;
        return opts.watched ?? false;
      },
    },
  };
}

describe("toggleWatchWith", () => {
  test("resposta clara no estado desejado: 1 POST e nenhuma leitura", async () => {
    const f = fakes({ posts: [true] });
    expect(await toggleWatchWith(f.deps, target, true)).toBe(true);
    expect(f.calls).toEqual({ post: 1, read: 0 });
  });

  test("resposta clara no estado oposto: alterna uma segunda vez", async () => {
    const f = fakes({ posts: [false, true] });
    expect(await toggleWatchWith(f.deps, target, true)).toBe(true);
    expect(f.calls).toEqual({ post: 2, read: 0 });
  });

  test("falha ambígua com o site já no estado desejado: NÃO repete o POST", async () => {
    const f = fakes({ posts: [new Error("timeout")], watched: true });
    expect(await toggleWatchWith(f.deps, target, true)).toBe(true);
    expect(f.calls).toEqual({ post: 1, read: 1 });
  });

  test("falha ambígua com o site no estado oposto: confere e alterna uma vez", async () => {
    const f = fakes({ posts: [new Error("500"), true], watched: false });
    expect(await toggleWatchWith(f.deps, target, true)).toBe(true);
    expect(f.calls).toEqual({ post: 2, read: 1 });
  });

  test("nunca passa de 2 POSTs: segundo toggle sem efeito vira erro", async () => {
    const f = fakes({ posts: [false, false] });
    await expect(toggleWatchWith(f.deps, target, true)).rejects.toThrow("sincronizar a vigia");
    expect(f.calls.post).toBe(2);
  });

  test("segundo POST que falha propaga o erro", async () => {
    const f = fakes({ posts: [false, new Error("500")] });
    await expect(toggleWatchWith(f.deps, target, true)).rejects.toThrow("500");
  });
});

describe("fetchAttempts", () => {
  test("GET tenta 3 vezes; POST só 1 (toggle não pode ser repetido às cegas)", () => {
    expect(fetchAttempts({ method: "GET" })).toBe(3);
    expect(fetchAttempts({})).toBe(3);
    expect(fetchAttempts({ method: "POST" })).toBe(1);
  });
  test("o chamador pode escolher explicitamente", () => {
    expect(fetchAttempts({ method: "POST", attempts: 2 })).toBe(2);
  });
});

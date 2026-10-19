import { describe, expect, test } from "bun:test";
import { mergeGalleries } from "../src/lib/leiloesbr-scrape.server";

const g = (code: string, name = code) => ({ code, name, count: null });

describe("mergeGalleries", () => {
  test("une sem repetir código e mantém a ordem da 1ª lista", () => {
    const merged = mergeGalleries([g("1"), g("2")], [g("2"), g("227", "Ana Mello Leiloeira")]);
    expect(merged.map((x) => x.code)).toEqual(["1", "2", "227"]);
  });

  test("lista vazia não atrapalha", () => {
    expect(mergeGalleries([], [g("9")]).map((x) => x.code)).toEqual(["9"]);
  });
});

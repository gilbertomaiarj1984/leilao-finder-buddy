import { describe, expect, test } from "bun:test";

import { fetchImageBytes } from "@/lib/safe-fetch.server";

const img = (body: Uint8Array | string, init: ResponseInit = {}) =>
  new Response(body as BodyInit, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
    ...init,
  });

describe("fetchImageBytes", () => {
  test("baixa a imagem de um host público", async () => {
    const fake = (async () => img(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const r = await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 100 }, fake);
    expect(r?.bytes.length).toBe(3);
    expect(r?.contentType).toBe("image/jpeg");
  });

  test("recusa rede interna e metadados sem nem chamar o fetch", async () => {
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      return img("x");
    }) as unknown as typeof fetch;
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:3000/x.jpg",
      "http://10.0.0.5/a.jpg",
      "file:///etc/passwd",
    ])
      expect(await fetchImageBytes(url, { maxBytes: 100 }, fake)).toBeNull();
    expect(calls).toBe(0);
  });

  test("redirect de host público para endereço de metadados é barrado no salto", async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u);
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    }) as unknown as typeof fetch;
    expect(
      await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 100 }, fake),
    ).toBeNull();
    expect(urls).toEqual(["https://img.example.com/a.jpg"]);
  });

  test("segue redirect entre hosts públicos (relativo ou absoluto), com limite de saltos", async () => {
    let n = 0;
    const ok = (async () => {
      n += 1;
      return n === 1
        ? new Response(null, { status: 301, headers: { location: "/b.jpg" } })
        : img(new Uint8Array([9]));
    }) as unknown as typeof fetch;
    expect(
      (await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 10 }, ok))?.bytes[0],
    ).toBe(9);
    const loop = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://img.example.com/x" },
      })) as unknown as typeof fetch;
    expect(
      await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 10 }, loop),
    ).toBeNull();
  });

  test("corta o download que passa do teto, declarado ou não", async () => {
    const big = new Uint8Array(50);
    const declared = (async () =>
      img(big, {
        headers: { "content-type": "image/jpeg", "content-length": "5000" },
      })) as unknown as typeof fetch;
    expect(
      await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 10 }, declared),
    ).toBeNull();
    const streamed = (async () => img(big)) as unknown as typeof fetch;
    expect(
      await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 10 }, streamed),
    ).toBeNull();
  });

  test("resposta de erro devolve null", async () => {
    const fake = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(
      await fetchImageBytes("https://img.example.com/a.jpg", { maxBytes: 10 }, fake),
    ).toBeNull();
  });
});

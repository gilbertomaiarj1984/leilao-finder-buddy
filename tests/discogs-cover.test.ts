import { describe, expect, test } from "bun:test";

import { isDiscogsImageUrl, toCoverOptions } from "../src/lib/discogs.server";

describe("discogs — capas", () => {
  test("isDiscogsImageUrl só aceita https em *.discogs.com", () => {
    expect(isDiscogsImageUrl("https://i.discogs.com/abc/cover.jpeg")).toBe(true);
    expect(isDiscogsImageUrl("http://i.discogs.com/abc.jpg")).toBe(false);
    expect(isDiscogsImageUrl("https://evil.com/discogs.com/a.jpg")).toBe(false);
    expect(isDiscogsImageUrl("https://discogs.com.evil.com/a.jpg")).toBe(false);
    expect(isDiscogsImageUrl("lixo")).toBe(false);
  });

  test("toCoverOptions descarta sem imagem/spacer e duplicadas", () => {
    const out = toCoverOptions([
      {
        id: 1,
        title: "A - B",
        year: "1970",
        cover_image: "https://i.discogs.com/x.jpg",
        thumb: "https://i.discogs.com/t.jpg",
      },
      { id: 2, title: "dup", cover_image: "https://i.discogs.com/x.jpg" },
      { id: 3, title: "spacer", cover_image: "https://st.discogs.com/spacer.gif" },
      { id: 4, title: "sem" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 1, year: 1970, thumb: "https://i.discogs.com/t.jpg" });
  });
});

import { describe, expect, test } from "bun:test";

import { albumWithIdentPriority } from "@/lib/album-pick";

describe("albumWithIdentPriority", () => {
  test("identificação de confiança alta vence o palpite da avaliação", () => {
    expect(
      albumWithIdentPriority("Gilberto Gil - Refavela", {
        album: "Gilberto Gil - Refazenda",
        confidence: "alta",
      }),
    ).toBe("Gilberto Gil - Refazenda");
  });
  test("confiança média ou baixa não segura a avaliação", () => {
    expect(albumWithIdentPriority("A - B", { album: "A - C", confidence: "media" })).toBe("A - B");
    expect(albumWithIdentPriority("A - B", { album: "A - C", confidence: "baixa" })).toBe("A - B");
  });
  test("sem identificação (ou sem álbum nela) fica a avaliação", () => {
    expect(albumWithIdentPriority("A - B", undefined)).toBe("A - B");
    expect(albumWithIdentPriority("A - B", { album: null, confidence: "alta" })).toBe("A - B");
    expect(albumWithIdentPriority(null, { album: "A - C", confidence: "alta" })).toBe("A - C");
  });
});

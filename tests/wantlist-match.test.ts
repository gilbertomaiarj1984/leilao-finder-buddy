import { describe, expect, test } from "bun:test";

import { extractArtist } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN, lotIdentity, ownedCandidate, ownedScore } from "@/lib/wantlist-match";

const score = (
  lotTitle: string,
  item: { artist: string; album: string; year: number | null },
  lotArtist = extractArtist(lotTitle),
) =>
  ownedScore(
    ownedCandidate({ id: "1", ...item }),
    lotIdentity({ title: lotTitle, artist: lotArtist }),
  );

describe("ownedScore — série com o nome escrito de outro jeito (falta 1 palavra distintiva)", () => {
  const lot = "Álbum MUSICA POPULAR BRASILEIRA TOM JOBIM | Código: | Artista(s): TOM JOBIM";
  const mine = { artist: "Tom Jobim", album: "Historia da Musica Popular - Tom Jobim", year: 1982 };

  test("vira candidato incerto ('?'), nunca confiante", () => {
    const s = score(lot, mine);
    expect(s).toBeGreaterThanOrEqual(0.6);
    expect(s).toBeLessThan(OWNED_CONFIDENT_MIN);
  });

  test("sem artista confirmado no lote não marca", () => {
    expect(score("MUSICA POPULAR BRASILEIRA TOM JOBIM", mine, "")).toBeLessThan(0.6);
  });

  test("lote de outro artista não marca", () => {
    const other =
      "Álbum MUSICA POPULAR BRASILEIRA CHICO BUARQUE | Código: | Artista(s): CHICO BUARQUE";
    expect(score(other, mine)).toBe(0);
  });

  test("faltando 2 palavras distintivas não marca", () => {
    expect(score("Álbum POPULAR TOM JOBIM | Código: | Artista(s): TOM JOBIM", mine)).toBe(0);
  });

  test("outro disco do mesmo artista não marca", () => {
    expect(score("Álbum WAVE TOM JOBIM | Código: | Artista(s): TOM JOBIM", mine)).toBe(0);
  });

  test("nome distintivo de só 2 palavras continua exigindo as duas", () => {
    const two = { artist: "Tom Jobim", album: "Terra Brasilis", year: null };
    expect(score("Álbum BRASILIS TOM JOBIM | Código: | Artista(s): TOM JOBIM", two)).toBe(0);
  });
});

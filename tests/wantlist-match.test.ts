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

describe("ownedScore — artista de nome curto não casa palavra comum (Nara × PARA)", () => {
  const nara = ownedCandidate({ id: "n", artist: "Nara", album: "Nara", year: 1967 });
  const lot = (title: string, artists?: string[]) =>
    lotIdentity({
      title,
      artist: artists?.[0] ?? "Lote",
      album: null,
      marketTitle: null,
      marketYear: null,
    });

  test("PARA/NADA/CARA no texto + ano 1967 não casam", () => {
    for (const w of ["PARA", "NADA", "CARA", "SARA", "VARA"]) {
      expect(ownedScore(nara, lot(`**LP FRANK SINATRA 1967**DISCO ${w} COLECIONADOR`))).toBe(0);
    }
  });

  test("homônimo com a artista citada no título (sem artista confirmado) não casa só pelo ano", () => {
    expect(ownedScore(nara, lot("LP Nara 1967 capa simples"))).toBe(0);
  });

  test("artista confirmado segue casando", () => {
    const id = lotIdentity({
      title: "LP Nara 1967",
      artist: "Nara",
      album: "Nara - Nara",
      marketTitle: null,
      marketYear: null,
    });
    expect(ownedScore(nara, id)).toBeGreaterThanOrEqual(OWNED_CONFIDENT_MIN);
  });
});

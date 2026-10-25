import { expect, test } from "bun:test";

import { deriveAlbum, foldPlural } from "@/lib/analytics";
import { parseCollectionBulkText } from "@/lib/collection-bulk";
import { extractKeywords } from "@/lib/lot-exclusion";
import { parseLookoutBulk } from "@/lib/lookout-bulk";
import { lotIdentity, ownedCandidate, resolveOwned } from "@/lib/wantlist-match";

test("parseLookoutBulk (lista colada do De olho, que substituiu a Sondagem)", () => {
  const items = parseLookoutBulk(
    "01. Chico Buarque - Construção (1971)\nRaul Seixas - Gita\n\nraul seixas - gita\n",
  );
  expect(items).toHaveLength(2); // linha vazia e repetida somem
  expect(items[0]).toMatchObject({ text: "Chico Buarque - Construção (1971)", year: 1971 });
  expect(items[1]).toMatchObject({ text: "Raul Seixas - Gita", year: null });
});

test("ano sem parênteses no fim da linha (De olho e Coleção)", () => {
  const [a, b] = parseLookoutBulk("caetano veloso - caetano veloso 1968\nPrince - 1999");
  expect(a).toMatchObject({ year: 1968 });
  expect(b).toMatchObject({ year: null }); // "1999" é o nome do álbum
  const { items } = parseCollectionBulkText("Caetano Veloso - Caetano Veloso 1968\nPrince - 1999");
  expect(items.map((i) => [i.artist, i.album, i.year])).toEqual([
    ["Caetano Veloso", "Caetano Veloso", 1968],
    ["Prince", "1999", null],
  ]);
});

test("homônimos de anos diferentes não são o mesmo disco na importação da Coleção", () => {
  const { items } = parseCollectionBulkText(
    "Caetano Veloso - Caetano Veloso (1968)\nCaetano Veloso - Caetano Veloso (1986)\nCaetano Veloso - Caetano Veloso (1986)",
  );
  expect(items.map((i) => i.year)).toEqual([1968, 1986]);
});

test("parseCollectionBulkText", () => {
  const { items, error } = parseCollectionBulkText(
    "Chico Buarque - Construção (1971)\nRaul Seixas - Gita",
  );
  expect(error).toBeNull();
  expect(items.map((i) => [i.artist, i.album, i.year])).toEqual([
    ["Chico Buarque", "Construção", 1971],
    ["Raul Seixas", "Gita", null],
  ]);
});

test("deriveAlbum", () => {
  expect(
    deriveAlbum(
      "duplo: Trem Azul | Código: 411.6006 | Artista(s): [`Elis Regina`] | Ano: | Estilo(s): [`M",
      "Elis Regina",
    ),
  ).toBe("Trem Azul");
  expect(deriveAlbum("LP Chico Buarque - Construção 1971", "Chico Buarque")).toBe("Construção");
  expect(
    deriveAlbum(
      "2 Na Bossa | Código: P 632 765 L | Artista(s): [`Elis Regina`, `Jair Rodrigues`] | Ano",
      "Elis Regina",
    ),
  ).toBe("2 Na Bossa");
});

test("extractKeywords", () => {
  expect(extractKeywords("Vitrola antiga Philips funcionando")).toEqual([
    "vitrola",
    "antiga",
    "philips",
    "funcionando",
  ]);
});

test("foldPlural", () => {
  expect(foldPlural("autografos de sucesso")).toBe(foldPlural("autografo de sucessos"));
  expect(foldPlural("sucessos 1")).not.toBe(foldPlural("sucessos 2"));
  expect(foldPlural("sucessos 1971")).toBe("sucessos 1971");
});

test("aprendizado não sugere disco da Coleção cujo artista não está no lote", () => {
  const gil = ownedCandidate({
    id: "gil",
    artist: "Gilberto Gil",
    album: "Gilberto Gil",
    year: 1971,
  });
  const id = lotIdentity({ title: "Lp Paulinho da Viola Prisma Luminoso |Em estado regular" });
  const feedback = [
    {
      lotId: "x",
      itemId: "gil",
      verdict: "pos" as const,
      artist: ["paulinho", "viola"],
      album: ["prisma", "luminoso"],
      year: 1983,
    },
  ];
  const of = (i: string) => (i === "gil" ? gil : undefined);
  expect(resolveOwned("l", {}, null, feedback, id, of).kind).toBe("none");
});

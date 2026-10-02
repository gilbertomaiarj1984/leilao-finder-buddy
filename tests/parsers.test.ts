import { expect, test } from "bun:test";

import { deriveAlbum, foldPlural } from "@/lib/analytics";
import { parseCollectionBulkText } from "@/lib/collection-bulk";
import { extractKeywords } from "@/lib/lot-exclusion";
import { bestWantForLot, lotIdentity, wantCandidate } from "@/lib/wantlist-match";
import { parseWantlistText } from "@/lib/wantlist-parse";

test("parseWantlistText", () => {
  const items = parseWantlistText("Chico Buarque - Construção (1971)\nRaul Seixas - Gita\n\n");
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ work: "Chico Buarque - Construção", year: 1971 });
  expect(items[1]).toMatchObject({ work: "Raul Seixas - Gita", year: null });
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

test("sondagem casa o lote certo", () => {
  const cands = [
    wantCandidate({ id: "1", work: "Chico Buarque - Construção", year: 1971 }),
    wantCandidate({ id: "2", work: "Raul Seixas - Gita", year: null }),
  ];
  const hit = bestWantForLot(cands, lotIdentity({ title: "LP Chico Buarque - Construção 1971" }));
  expect(hit?.cand.id).toBe("1");
  expect(bestWantForLot(cands, lotIdentity({ title: "LP Roberto Carlos - Detalhes" }))).toBeNull();
});

test("foldPlural", () => {
  expect(foldPlural("autografos de sucesso")).toBe(foldPlural("autografo de sucessos"));
  expect(foldPlural("sucessos 1")).not.toBe(foldPlural("sucessos 2"));
  expect(foldPlural("sucessos 1971")).toBe("sucessos 1971");
});

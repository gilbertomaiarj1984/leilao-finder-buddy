import { expect, test } from "bun:test";

import { deriveAlbum } from "@/lib/analytics";
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
  expect(deriveAlbum("LP Chico Buarque - Construção 1971", "Chico Buarque")).toBe("Construção");
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

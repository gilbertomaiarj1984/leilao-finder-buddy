import { expect, test } from "bun:test";

import { houseNavLabels } from "@/components/vinyl/dashboard/house-nav-utils";

test("houseNavLabels: casas únicas ficam como estão", () => {
  expect(houseNavLabels(["A", "B"])).toEqual(["A", "B"]);
});

test("houseNavLabels: repetição ganha sufixo a partir da 2ª ocorrência", () => {
  expect(houseNavLabels(["A", "B", "A", "A"])).toEqual(["A", "B", "A · 2", "A · 3"]);
});

import { describe, expect, test } from "bun:test";

import { upsertUpdateSet } from "@/lib/db-query.server";

describe("upsertUpdateSet", () => {
  test("sobrescreve todas as colunas menos a chave do conflito", () => {
    expect(upsertUpdateSet("lots", ["id", "title", "price"], "id")).toBe(
      '"title" = EXCLUDED."title", "price" = EXCLUDED."price"',
    );
  });
  test("keepIfEmpty preserva o valor atual quando o novo é vazio", () => {
    expect(upsertUpdateSet("lots", ["id", "lote", "title"], "id", ["lote"])).toBe(
      `"lote" = COALESCE(NULLIF(EXCLUDED."lote", ''), "lots"."lote"), "title" = EXCLUDED."title"`,
    );
  });
});

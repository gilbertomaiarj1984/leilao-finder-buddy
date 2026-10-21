import { getSql } from "./db.server";
import { pickHouseUfs } from "./house-uf";

/** UF por casa (`houseKey` → "SP"), da própria tabela `lots`. Best-effort: vazio em erro. */
export async function getHouseUfs(): Promise<Record<string, string>> {
  try {
    const rows = (await getSql().unsafe(
      "SELECT house, uf, count(*)::int AS n FROM lots WHERE uf <> '' AND house <> '' GROUP BY house, uf",
    )) as unknown as { house: string; uf: string; n: number }[];
    return pickHouseUfs(rows);
  } catch (error) {
    console.error("[house-uf] não foi possível ler", error);
    return {};
  }
}

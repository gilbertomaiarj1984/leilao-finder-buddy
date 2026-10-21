import { houseKey } from "./house-rating";

/**
 * UF de cada casa a partir de linhas (casa, UF, nº de lotes): vale a UF mais frequente da casa
 * (os lotes de uma casa trazem a mesma UF; a moda protege contra um dado isolado errado).
 * Chave = `houseKey(casa)`, a mesma do semáforo — nome com caixa/acento diferente cai na mesma casa.
 */
export function pickHouseUfs(
  rows: { house: string; uf: string; n: number }[],
): Record<string, string> {
  const best = new Map<string, { uf: string; n: number }>();
  for (const row of rows) {
    const uf = row.uf.trim().toUpperCase();
    if (!row.house || !/^[A-Z]{2}$/.test(uf)) continue;
    const key = houseKey(row.house);
    const cur = best.get(key);
    if (!cur || row.n > cur.n) best.set(key, { uf, n: row.n });
  }
  return Object.fromEntries([...best].map(([key, v]) => [key, v.uf]));
}

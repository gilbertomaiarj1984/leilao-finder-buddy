/**
 * Rótulos do painel de casas: a mesma casa pode aparecer mais de uma vez na tela (ex.: Lances,
 * uma seção por dia) — a repetição ganha " · 2", " · 3"… para dar pra distinguir os atalhos.
 */
export function houseNavLabels(houses: string[]): string[] {
  const total = new Map<string, number>();
  for (const house of houses) total.set(house, (total.get(house) ?? 0) + 1);
  const seen = new Map<string, number>();
  return houses.map((house) => {
    if ((total.get(house) ?? 0) < 2) return house;
    const n = (seen.get(house) ?? 0) + 1;
    seen.set(house, n);
    return n === 1 ? house : `${house} · ${n}`;
  });
}

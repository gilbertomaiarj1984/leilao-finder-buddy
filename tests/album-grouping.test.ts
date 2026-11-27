import { describe, expect, test } from "bun:test";

import {
  buildAlbumGroupingText,
  validateAlbumGroups,
  type GroupingAlbum,
} from "@/lib/album-grouping";

const alb = (key: string, name: string, count = 1): GroupingAlbum => ({ key, name, count });

// Nomes reais de álbuns de Milton/Caetano/Gil vistos no Analytics (variações do mesmo disco).
const albums = [
  alb("caçador de mim", "Caçador de Mim", 5),
  alb("milton nascimento caçador", "MILTON NASCIMENTO CAÇADOR", 2),
  alb("clube da esquina", "Clube da Esquina", 8),
  alb("clube da esquina 2", "Clube da Esquina 2", 16),
  alb("circulado", "Circuladô", 2),
  alb("circulado vivo", "Circuladô Vivo", 2),
  alb("luar", "Luar", 12),
  alb("a gente precisa ver o luar", "A Gente Precisa Ver o Luar", 4),
];

describe("validateAlbumGroups", () => {
  test("junta variações do mesmo disco e usa um nome existente", () => {
    const g = validateAlbumGroups({ groups: [{ name: "Caçador de Mim", items: [1, 2] }] }, albums);
    expect(g).toHaveLength(1);
    expect(g[0]!.keys).toEqual(["caçador de mim", "milton nascimento caçador"]);
    expect(g[0]!.name).toBe("Caçador de Mim");
    expect(g[0]!.warnings).toEqual([]);
  });

  test("nome inventado pela IA vira o nome do membro com mais vendas", () => {
    const g = validateAlbumGroups(
      { groups: [{ name: "Caçador De Mim (1981)", items: [1, 2] }] },
      albums,
    );
    expect(g[0]!.name).toBe("Caçador de Mim");
  });

  test("números de edição diferentes: descarta o grupo", () => {
    const g = validateAlbumGroups(
      { groups: [{ name: "Clube da Esquina", items: [3, 4] }] },
      albums,
    );
    expect(g).toEqual([]);
  });

  test("ao vivo × estúdio: mantém mas avisa", () => {
    const g = validateAlbumGroups({ groups: [{ name: "Circuladô", items: [5, 6] }] }, albums);
    expect(g).toHaveLength(1);
    expect(g[0]!.warnings.length).toBe(1);
  });

  test("item repetido, fora da faixa ou grupo de 1 é ignorado", () => {
    const g = validateAlbumGroups(
      {
        groups: [
          { name: "Luar", items: [7, 8] },
          { name: "Luar de novo", items: [7, 99] },
          { name: "só um", items: [1] },
        ],
      },
      albums,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.keys).toEqual(["luar", "a gente precisa ver o luar"]);
  });

  test("resposta inválida não quebra", () => {
    expect(validateAlbumGroups(null, albums)).toEqual([]);
    expect(validateAlbumGroups({ groups: "x" }, albums)).toEqual([]);
  });
});

describe("buildAlbumGroupingText", () => {
  test("lista numerada com contagem e título original quando diferente", () => {
    const t = buildAlbumGroupingText("Milton Nascimento", [
      { key: "a", name: "Anima", count: 1, sample: "Milton Nascimento - Anima. Ariola 201 909" },
      { key: "b", name: "Geraes", count: 3, sample: "Geraes" },
    ]);
    expect(t).toContain("1. Anima (1 venda) — título original: Milton Nascimento - Anima");
    expect(t).toContain("2. Geraes (3 vendas)");
    expect(t).not.toContain("título original: Geraes");
  });
});

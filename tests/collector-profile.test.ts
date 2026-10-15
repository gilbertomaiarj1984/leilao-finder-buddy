import { describe, expect, test } from "bun:test";

import { buildLotContext, contextForPrompt } from "../src/lib/ai-context";
import {
  buildCollectorMatcher,
  buildProfileContext,
  collectorInterests,
  lookoutArtists,
  profileForLot,
} from "../src/lib/collector-profile";
import type { LookoutItem } from "../src/lib/lookout-match";

function item(over: Partial<LookoutItem> = {}): LookoutItem {
  return {
    id: "it1",
    lotId: "100-1",
    artist: "Chico Buarque",
    album: "Construção",
    year: 1971,
    title: "",
    house: "",
    image: null,
    url: "",
    dayKey: "",
    maxPrice: 80,
    note: "",
    status: "active",
    ...over,
  };
}

describe("perfil do colecionador — interesses + De olho", () => {
  test("artistas do De olho: só ativos, sem repetir e sem balaios", () => {
    const list = lookoutArtists([
      item(),
      item({ id: "2", artist: "chico buarque", album: "Almanaque" }),
      item({ id: "3", artist: "Tim Maia", status: "acquired" }),
      item({ id: "4", artist: "Lote" }),
      item({ id: "5", artist: "Elis Regina", merged: [{ artist: "Elis" } as never] }),
    ]);
    expect(list).toEqual(["Chico Buarque", "Elis Regina", "Elis"]);
  });

  test("interesses efetivos = lista manual + artistas do De olho que ainda não estão nela", () => {
    const got = collectorInterests(
      ["  Raul Seixas ", "chico buarque", ""],
      [item(), item({ id: "9", artist: "Gal Costa" })],
    );
    expect(got.manual).toEqual(["Raul Seixas", "chico buarque"]);
    expect(got.derived).toEqual(["Gal Costa"]); // Chico já está na lista manual
    expect(got.all).toEqual(["Raul Seixas", "chico buarque", "Gal Costa"]);
  });

  test("o teste «combina com meus interesses» enxerga o artista do De olho", () => {
    const match = buildCollectorMatcher(["Jazz"], [item()]);
    expect(match("LP Chico Buarque - Almanaque 1981")).toBe(true);
    expect(match("LP Roberto Carlos - Detalhes")).toBe(false);
  });
});

describe("perfil por lote (vai ao prompt da IA)", () => {
  const pc = buildProfileContext({
    interests: ["Raul Seixas"],
    lookout: [item()],
    lookoutLinks: {},
    collection: [{ id: "c1", artist: "Tim Maia", album: "Racional Vol. 1", year: 1975 }],
    ownedDenylist: [],
  });

  test("lote do disco que está de olho (outro lote que não a origem)", () => {
    const p = profileForLot(pc, {
      id: "200-9",
      title: "LP Chico Buarque - Construção - 1971",
      artist: "Chico Buarque",
    });
    expect(p?.deOlho).toMatchObject({ teto: 80, confirmado: false });
    expect(p?.deOlho?.label).toContain("Construção");
    expect(p?.interesse).toBe(true); // o artista do De olho conta como interesse
    expect(p?.jaTenho).toBeNull();
  });

  test("o próprio lote marcado também conta (origem)", () => {
    const p = profileForLot(pc, { id: "100-1", title: "x", artist: "Chico Buarque" });
    expect(p?.deOlho?.label).toContain("Chico Buarque");
  });

  test("outro disco do mesmo artista: é interesse, mas não é o disco de olho", () => {
    const p = profileForLot(pc, {
      id: "300-1",
      title: "LP Chico Buarque - Almanaque - 1981",
      artist: "Chico Buarque",
      album: "Chico Buarque - Almanaque",
    });
    expect(p?.interesse).toBe(true);
    expect(p?.deOlho).toBeNull();
  });

  test("disco que o colecionador já tem na Coleção", () => {
    const p = profileForLot(pc, {
      id: "400-1",
      title: "LP Tim Maia - Racional Vol. 1",
      artist: "Tim Maia",
      album: "Tim Maia - Racional Vol. 1",
    });
    expect(p?.jaTenho).toContain("Racional");
  });

  test("nada se aplica → null (nada entra no prompt)", () => {
    expect(
      profileForLot(pc, {
        id: "500-1",
        title: "LP Roberto Carlos - Detalhes",
        artist: "Roberto Carlos",
      }),
    ).toBeNull();
  });

  test("entra no prompt só como o resultado do casamento, e respeita os campos ocultos", () => {
    const p = profileForLot(pc, {
      id: "200-9",
      title: "LP Chico Buarque - Construção - 1971",
      artist: "Chico Buarque",
    });
    const out = contextForPrompt(buildLotContext({ uf: "SP", profile: p }), 40);
    expect(out["perfil_do_colecionador"]).toMatchObject({
      nos_meus_interesses: true,
      teto_de_olho_brl: 80,
    });
    expect(
      contextForPrompt(buildLotContext({ uf: "SP" }), 40)["perfil_do_colecionador"],
    ).toBeUndefined();
  });
});

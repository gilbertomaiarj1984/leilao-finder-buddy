import { describe, expect, test } from "bun:test";

import { buildOwnedCandidates } from "@/lib/collector-profile";
import {
  conditionMap,
  demandMap,
  lotIdentityMap,
  ownedAutoMap,
  ownedHitFromResolution,
} from "@/lib/lot-insight-build";

describe("conditionMap / demandMap", () => {
  const rows = [
    { id: "a", media: "VG+", sleeve: null, insert_state: "sim", views: 10, bids: 2 },
    { id: "b", media: null, sleeve: null, insert_state: null, views: null, bids: null },
    { id: "c", media: null, sleeve: null, insert_state: "nao", views: 0, bids: null },
  ];
  test("linha sem Disco, Capa nem encarte não entra; encarte sozinho entra", () => {
    const m = conditionMap(rows);
    expect([...m.keys()]).toEqual(["a", "c"]);
    expect(m.get("a")!.media).toBe("VG+");
    expect(m.get("a")!.insert).toBe("sim");
    expect(m.get("c")!.insert).toBe("nao");
  });
  test("o lado desconhecido é espelhado pelo scoreCondition", () => {
    expect(conditionMap(rows).get("a")!.sleeve).toBe("VG+");
  });
  test("demanda só guarda linhas com visitas ou lances", () => {
    const m = demandMap(rows);
    expect([...m.keys()]).toEqual(["a", "c"]);
    expect(m.get("c")).toEqual({ views: 0, bids: null });
  });
  test("entrada ausente vira mapa vazio", () => {
    expect(conditionMap(undefined).size).toBe(0);
    expect(demandMap(undefined).size).toBe(0);
  });
});

describe("lotIdentityMap / ownedAutoMap", () => {
  const lots = [
    { id: "l1", title: "LP Rita Lee - Fruto Proibido 1975", artist: "Rita Lee" },
    { id: "l2", title: "LP Roberto Carlos - Jovem Guarda", artist: "Roberto Carlos" },
  ];
  const identityById = lotIdentityMap(lots, new Map(), new Map(), {});
  const cands = buildOwnedCandidates([
    { id: "c1", artist: "Rita Lee", album: "Fruto Proibido", year: 1975 },
  ]);
  const labelOf = (id: string) => `item ${id}`;
  const base = { lots, ownedCands: cands, identityById, denylist: new Set<string>(), labelOf };

  test("monta uma identidade por lote", () => {
    expect([...identityById.keys()]).toEqual(["l1", "l2"]);
  });
  test("peça exata arrematada vence com score 1 mesmo sem candidatos", () => {
    const m = ownedAutoMap({ ...base, ownedCands: [], ownedByLotId: new Map([["l2", "c9"]]) });
    expect(m.get("l2")).toEqual({ id: "c9", label: "item c9", score: 1 });
    expect(m.has("l1")).toBe(false);
  });
  test("casa o disco da Coleção pelo artista e álbum; o outro lote não casa", () => {
    const m = ownedAutoMap({ ...base, ownedByLotId: new Map() });
    expect(m.get("l1")?.id).toBe("c1");
    expect(m.has("l2")).toBe(false);
  });
});

describe("ownedHitFromResolution", () => {
  const labelOf = (id: string) => `item ${id}`;
  test("vínculo manual vale 1; sugerido mantém o score; auto devolve o hit", () => {
    expect(ownedHitFromResolution({ kind: "linked", itemId: "x" }, labelOf)).toEqual({
      id: "x",
      label: "item x",
      score: 1,
    });
    expect(ownedHitFromResolution({ kind: "suggested", itemId: "y", score: 0.6 }, labelOf)).toEqual(
      {
        id: "y",
        label: "item y",
        score: 0.6,
      },
    );
    const hit = { id: "z", label: "z", score: 0.9 };
    expect(ownedHitFromResolution({ kind: "auto", hit }, labelOf)).toBe(hit);
  });
  test("none e rejected viram null", () => {
    expect(ownedHitFromResolution({ kind: "none" }, labelOf)).toBeNull();
  });
});

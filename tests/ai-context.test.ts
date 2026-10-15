import { describe, expect, test } from "bun:test";

import { buildLotContext, contextForPrompt, PROMPT_VERSION } from "../src/lib/ai-context";
import { buildUserPrompt, evalHash, titleHash } from "../src/lib/ai-eval.server";

const market = {
  matched: true,
  year: 1984,
  num_for_sale: 12,
  have: 3200,
  want: 1100,
  suggested_by_condition: { NM: 66.27, "VG+": 50.68, "G+": 22.4 },
};

describe("contexto da avaliação", () => {
  test("usa a condição do disco e soma o frete do Sudeste", () => {
    const ctx = buildLotContext({
      condition: { media: "NM", sleeve: "VG+", insert_state: "sim", score: 85 },
      market,
      uf: "SP",
    });
    expect(ctx.frete).toBe(25);
    expect(ctx.estado).toEqual({ disco: "NM", capa: "VG+", encarte: "sim", nota_estado: 85 });
    expect(ctx.mercado?.anchor).toEqual({ price: 66.27, condition: "NM", exact: true });
    const out = contextForPrompt(ctx, 40);
    expect(out["lote_mais_frete_brl"]).toBe(65);
    expect(out["razao_lote_vs_sugerido"]).toBe(0.98);
    expect(out["mercado_discogs_brl"]).toMatchObject({
      preco_sugerido: 66,
      condicao_de_referencia: "NM",
      estado_do_lote_conhecido: true,
      querem: 1100,
      tem: 3200,
    });
  });

  test("sem estado a referência é G+ e o frete fora do Sudeste é R$ 35", () => {
    const ctx = buildLotContext({ condition: null, market, uf: "BA" });
    expect(ctx.estado).toBeNull();
    expect(ctx.frete).toBe(35);
    expect(ctx.mercado?.anchor).toEqual({ price: 22.4, condition: "G+", exact: false });
    const out = contextForPrompt(ctx, 15);
    expect(out["estado"]).toBeUndefined();
    expect(
      (out["mercado_discogs_brl"] as Record<string, unknown>)["estado_do_lote_conhecido"],
    ).toBe(false);
    expect(out["razao_lote_vs_sugerido"]).toBe(2.23); // (15 + 35) / 22,4
  });

  test("com só a capa conhecida, o disco repete o grau (convenção do app)", () => {
    const ctx = buildLotContext({
      condition: { media: "", sleeve: "VG", insert_state: "", score: 55 },
      market,
      uf: "RJ",
    });
    expect(ctx.estado).toEqual({ disco: null, capa: "VG", encarte: null, nota_estado: 55 });
    // VG não existe no mapa: VG+ e G+ ficam a 1 de distância e o empate vai para a pior (G+).
    expect(ctx.mercado?.anchor.condition).toBe("G+");
  });

  test("sem mercado casado ou sem mapa não inventa preço", () => {
    expect(buildLotContext({ market: { ...market, matched: false }, uf: "SP" }).mercado).toBeNull();
    expect(
      buildLotContext({ market: { ...market, suggested_by_condition: null }, uf: "SP" }).mercado,
    ).toBeNull();
    const out = contextForPrompt(buildLotContext({ uf: "SP" }), null);
    expect(out).toEqual({ frete_estimado_brl: 25 });
  });

  test("o prompt leva o contexto; sem contexto fica como antes", () => {
    const lot = {
      id: "1",
      title: "GIL RAÇA HUMANA LP",
      price: "R$ 40,00",
      house: "X",
      image: null,
    };
    const withCtx = buildUserPrompt(lot, buildLotContext({ market, uf: "SP" }));
    expect(withCtx).toContain('"contexto"');
    expect(withCtx).toContain('"lote_mais_frete_brl":65');
    expect(buildUserPrompt(lot)).not.toContain("contexto");
  });

  test("o hash de avaliação carrega a versão do prompt; a identificação não", () => {
    expect(evalHash("ABC")).toBe(`${titleHash("ABC")}.p${PROMPT_VERSION}`);
    expect(evalHash("ABC")).not.toBe(titleHash("ABC"));
  });
});

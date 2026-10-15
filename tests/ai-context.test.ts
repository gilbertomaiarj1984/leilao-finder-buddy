import { describe, expect, test } from "bun:test";

import { buildLotContext, contextForPrompt, PROMPT_VERSION } from "../src/lib/ai-context";
import { normalizePanelConfig } from "../src/lib/ai-panel-config";
import {
  buildUserPrompt,
  evalHash,
  selectLotsToEvaluate,
  selectLotsToIdentify,
  titleHash,
} from "../src/lib/ai-eval.server";

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
    expect((out["mercado_discogs_brl"] as Record<string, unknown>)["razao_lote_vs_sugerido"]).toBe(
      0.98,
    );
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
    expect((out["mercado_discogs_brl"] as Record<string, unknown>)["razao_lote_vs_sugerido"]).toBe(
      2.23,
    ); // (15 + 35) / 22,4
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
    expect(evalHash("ABC").startsWith(`${titleHash("ABC")}.p${PROMPT_VERSION}.`)).toBe(true);
    expect(evalHash("ABC")).not.toBe(titleHash("ABC"));
  });
});

describe("painel de IA — configuração", () => {
  const input = {
    condition: { media: "NM", sleeve: "NM", insert_state: "", score: 90 },
    market,
    uf: "SP",
  };

  test("a ordem dos blocos e os campos desligados valem no prompt", () => {
    const cfg = normalizePanelConfig({
      blocks: ["frete", "mercado"],
      hiddenFields: ["mercado.tem", "mercado.querem"],
    });
    const out = contextForPrompt(buildLotContext(input, cfg), 40, cfg);
    expect(Object.keys(out)).toEqual([
      "frete_estimado_brl",
      "lote_mais_frete_brl",
      "mercado_discogs_brl",
    ]);
    const m = out["mercado_discogs_brl"] as Record<string, unknown>;
    expect(m["tem"]).toBeUndefined();
    expect(m["querem"]).toBeUndefined();
    expect(m["ano"]).toBe(1984);
    expect(out["estado"]).toBeUndefined(); // bloco desligado
  });

  test("frete e condição padrão configuráveis", () => {
    const cfg = normalizePanelConfig({ freight: { sudeste: 30, outras: 50 }, defaultCond: "VG" });
    const ctx = buildLotContext({ condition: null, market, uf: "BA" }, cfg);
    expect(ctx.frete).toBe(50);
    expect(ctx.mercado?.anchor.condition).toBe("G+"); // VG não existe no mapa de exemplo: G+ é a mais próxima
    expect(buildLotContext({ market, uf: "RJ" }, cfg).frete).toBe(30);
  });

  test("normalizePanelConfig recusa lixo e limita valores", () => {
    const cfg = normalizePanelConfig({
      blocks: ["estado", "estado", "xyz"],
      hiddenFields: ["mercado.tem", "nada.nada", 3],
      defaultCond: "ZZ",
      freight: { sudeste: -5, outras: 9999 },
      rules: [
        { id: "a", phrase: "ok frase", grade: "G+", effect: "cap" },
        { id: "b", phrase: "x", grade: "G+", effect: "set" },
        { id: "c", phrase: "frase boa", grade: "NOPE", effect: "set" },
        "lixo",
      ],
      disabledRules: ["bom-estado", 7],
    });
    expect(cfg.blocks).toEqual(["estado"]);
    expect(cfg.hiddenFields).toEqual(["mercado.tem"]);
    expect(cfg.defaultCond).toBe("G+");
    expect(cfg.freight).toEqual({ sudeste: 25, outras: 35 });
    expect(cfg.rules).toEqual([{ id: "a", phrase: "ok frase", grade: "G+", effect: "cap" }]);
    // frase com asteriscos demais é descartada (regex explosiva)
    expect(
      normalizePanelConfig({ rules: [{ phrase: "a*b*c*d*e*f", grade: "G+", effect: "set" }] })
        .rules,
    ).toEqual([]);
    expect(cfg.disabledRules).toEqual(["bom-estado"]);
    expect(normalizePanelConfig(null)).toEqual(normalizePanelConfig(undefined));
  });
});

describe("seleção por hash", () => {
  const lots = [
    { id: "1", title: "LP A", price: "R$ 10,00", house: "X", image: null },
    { id: "2", title: "LP B", price: "R$ 20,00", house: "X", image: null },
  ];

  test("a identificação compara o hash PURO do título (não reidentifica o que já foi feito)", () => {
    const done = [{ id: "1", title_hash: titleHash("LP A") }];
    expect(selectLotsToIdentify(lots, done).map((l) => l.id)).toEqual(["2"]);
  });

  test("a avaliação compara o hash com a versão do prompt", () => {
    const rows = [
      { id: "1", title_hash: evalHash("LP A") },
      { id: "2", title_hash: titleHash("LP B") }, // gravado antes da versão do prompt
    ];
    expect(selectLotsToEvaluate(lots, rows).map((l) => l.id)).toEqual(["2"]);
  });

  test("nota gravada sem contexto (falha ao carregar) volta para a fila", () => {
    expect(evalHash("LP A", false)).not.toBe(evalHash("LP A"));
    const rows = [{ id: "1", title_hash: evalHash("LP A", false) }];
    expect(selectLotsToEvaluate(lots.slice(0, 1), rows).map((l) => l.id)).toEqual(["1"]);
  });
});

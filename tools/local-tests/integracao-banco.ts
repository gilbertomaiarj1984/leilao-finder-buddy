// @ts-nocheck — script de teste local (não entra no typecheck do app). Ver tools/local-tests/README.md.
process.env.DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:54329/garimpo";
const R = new URL("../../src/lib/", import.meta.url).pathname;
let fails = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`);
  if (!cond) fails++;
};
const { db } = await import(R + "db-client.server");
const app = await import(R + "app-state.server");
const mkt = await import(R + "lot-market.server");
const lai = await import(R + "lot-ai.server");
const cond = await import(R + "lot-condition.server");
const ctx = await import(R + "ai-context.server");
const ctxPrompt = await import(R + "ai-context");
const { sql } = { sql: (await import(R + "db.server")).getSql() };

// ---- painel de IA: round trip e normalização ----
const d0 = await app.getAiPanelConfig();
ok("painel: padrão sem nada salvo", d0.defaultCond === "G+" && d0.freight.sudeste === 25 && d0.blocks.length === 4, d0);
const saved = await app.setAiPanelConfig({
  blocks: ["frete", "mercado", "lixo"], hiddenFields: ["mercado.tem", "x.y"], defaultCond: "VG",
  freight: { sudeste: 30, outras: 99999 },
  rules: [{ id: "a", phrase: "muito bem conservado", grade: "VG+", effect: "set" }, { id: "b", phrase: "a*b*c*d*e", grade: "G+", effect: "cap" }],
  disabledRules: ["bom-estado"],
});
ok("painel: salvar normaliza (lixo some, frete limitado, asteriscos)", JSON.stringify(saved.config.blocks) === '["frete","mercado","descricao"]' && saved.config.freight.outras === 35 && saved.config.rules.length === 1 && saved.config.defaultCond === "VG", saved.config);
const row = (await sql`select value from app_state where key = 'ai_panel'`)[0];
ok("painel: gravado como jsonb em app_state", row && row.value.defaultCond === "VG", row);
const back = await app.getAiPanelConfig();
ok("painel: leitura devolve o salvo", back.freight.sudeste === 30 && back.disabledRules[0] === "bom-estado", back);

// ---- dados de apoio (lots) ----
await sql`delete from lots where id like 'itest-%'`;
for (const [id, uf] of [["itest-1", "SP"], ["itest-2", "BA"], ["itest-3", "RJ"]]) {
  const title = "LP TESTE " + id, url = "http://x.com/" + id;
  await sql`insert into lots (id,id_leilao,id_peca,base,lote,title,url,price,day_key,uf,house) values (${id},'9',${id},'b','1',${title},${url},'R$ 40,00','2026-10-20',${uf},'Casa')`;
}

// ---- lot_market: jsonb, leitura, backfill ----
const n = await mkt.upsertLotMarket([
  { id: "itest-1", basis: mkt.marketBasis("Gil - Raça Humana (1984)", "T"), matched: true, release_id: 555878, release_title: "Gil", year: 1984, num_for_sale: 12, lowest_price: 5.6, currency: "BRL", suggested_price: 50, suggested_condition: "VG+", suggested_by_condition: { NM: 66.27, "VG+": 50.68, "G+": 22.4 }, have: 3200, want: 1100, price_low_br: null, price_high_br: null, num_for_sale_br: null },
  { id: "itest-2", basis: "x", matched: true, release_id: 111, release_title: "Tim", year: 1975, num_for_sale: 3, lowest_price: 100, currency: "BRL", suggested_price: 500, suggested_condition: "VG+", suggested_by_condition: null, have: 10, want: 90, price_low_br: null, price_high_br: null, num_for_sale_br: null },
  { id: "itest-3", basis: "y", matched: false, release_id: null, release_title: null, year: null, num_for_sale: null, lowest_price: null, currency: null, suggested_price: null, suggested_condition: null, suggested_by_condition: null, have: null, want: null, price_low_br: null, price_high_br: null, num_for_sale_br: null },
]);
ok("lot_market: upsert de 3 linhas", n === 3, n);
const all = await mkt.getAllLotMarket();
const r1 = all.find((r: any) => r.id === "itest-1");
ok("lot_market: jsonb volta como objeto", r1?.suggested_by_condition?.NM === 66.27, r1?.suggested_by_condition);
const only = await mkt.getAllLotMarket(["itest-2"]);
ok("lot_market: leitura por ids", only.length === 1 && only[0].id === "itest-2", only.map((r: any) => r.id));
ok("lot_market: ids vazio devolve []", (await mkt.getAllLotMarket([])).length === 0);
const bf = mkt.selectMarketBackfill(all.filter((r: any) => r.id.startsWith("itest-")), 10);
ok("backfill: só itest-2 (casado, sem mapa)", bf.length === 1 && bf[0].id === "itest-2", bf);
await mkt.updateSuggestionMaps([{ id: "itest-2", map: null }]);
const after = (await mkt.getAllLotMarket(["itest-2"]))[0];
ok("backfill: {} gravado para 'consultado sem sugestões'", JSON.stringify(after.suggested_by_condition) === "{}", after.suggested_by_condition);
ok("backfill: não repete depois do {}", mkt.selectMarketBackfill([after], 10).length === 0);

// ---- lot_ai: lean x completo, cache ----
await lai.upsertLotAi([{ id: "itest-1", title_hash: "h.p3.fp", score: 70, rarity: "raro", deal: "justo", album: "Gil - Raça Humana", reason: "r", tags: ["mpb"], model: "m", eval_price: 40, tracklist: [{ side: "A", title: "Faixa 1", fame: "alta" }] }]);
const full = { tracklist: await lai.getLotTracklist("itest-1") };
const lean = (await lai.getAllLotAiLean()).find((r: any) => r.id === "itest-1");
ok("lot_ai: completo traz tracklist", full?.tracklist?.length === 1, full?.tracklist);
ok("lot_ai: lean NÃO traz tracklist mas traz hash/nota", lean?.tracklist === null && lean?.title_hash === "h.p3.fp" && lean?.score === 70, lean);
await lai.upsertLotAi([{ id: "itest-1", title_hash: "h2", score: 80, rarity: "raro", deal: "justo", album: "Gil - Raça Humana", reason: "r", tags: [], model: "m", eval_price: 40, tracklist: null }]);
const lean2 = (await lai.getAllLotAiLean()).find((r: any) => r.id === "itest-1");
ok("lot_ai: cache lean é invalidado pela escrita", lean2?.title_hash === "h2" && lean2?.score === 80, lean2);
const full2 = { tracklist: await lai.getLotTracklist("itest-1") };
ok("lot_ai: reavaliar não zera a tracklist (banco)", full2?.tracklist?.length === 1, full2?.tracklist);

// ---- lot_ai: versão do navegador (sem faixas) + faixas sob demanda ----
const cli = (await lai.getAllLotAiClient()).find((r: any) => r.id === "itest-1");
ok("lot_ai cliente: sem campo tracklist, hasTracklist=true", cli && !("tracklist" in cli) && cli.hasTracklist === true && cli.score === 80, cli);
const one = await lai.getLotTracklist("itest-1");
ok("lot_ai: getLotTracklist traz as faixas de um lote", one?.length === 1 && one[0].title === "Faixa 1", one);
ok("lot_ai: lote inexistente → null", (await lai.getLotTracklist("itest-nao-existe")) === null);
await sql`update lot_ai set tracklist = '[]'::jsonb where id = 'itest-1'`;
lai.invalidateLotAiCache();
const cli2 = (await lai.getAllLotAiClient()).find((r: any) => r.id === "itest-1");
ok("lot_ai cliente: [] = hasTracklist false (já tentado, sem faixas)", cli2?.hasTracklist === false, cli2);
await sql`update lot_ai set tracklist = null where id = 'itest-1'`;
lai.invalidateLotAiCache();
const cli3 = (await lai.getAllLotAiClient()).find((r: any) => r.id === "itest-1");
ok("lot_ai cliente: NULL = hasTracklist false (sem erro)", cli3?.hasTracklist === false, cli3);

// ---- lot_condition + contexto ----
await sql`insert into lot_condition (id,title_hash,media,sleeve,insert_state,score,faixa,source,description) values ('itest-1','h.c2.k','VG+','VG','sim',78,'Muito Bom','catalog','Prensagem original com encarte') on conflict (id) do update set media = excluded.media`;
const lc = (await cond.getAllLotCondition()).find((r: any) => r.id === "itest-1");
ok("lot_condition: leitura", lc?.media === "VG+", lc);
const { byId, cfg, ok: ctxOk } = await ctx.loadLotContexts(["itest-1", "itest-2", "itest-3"]);
ok("contexto: carregou do banco e usou a config do painel", ctxOk && cfg.defaultCond === "VG" && byId.size === 3, { ctxOk, size: byId.size });
const c1 = byId.get("itest-1");
ok("contexto itest-1: estado + âncora VG+ + frete SP (30)", c1.estado?.disco === "VG+" && c1.mercado?.anchor.condition === "VG+" && c1.mercado.anchor.exact && c1.frete === 30, c1);
const c2 = byId.get("itest-2");
ok("contexto itest-1: descrição do catálogo chega ao contexto e ao prompt", c1.descricao === "Prensagem original com encarte" && JSON.stringify(ctxPrompt.contextForPrompt(c1, 40, cfg)).includes("descricao_do_lote"), c1.descricao);
ok("contexto itest-2: sem mapa → sem mercado; frete BA (35, 'outras' foi limitado)", c2.mercado === null && c2.estado === null && c2.frete === 35, c2);

await sql`delete from lots where id like 'itest-%'`;
await sql`delete from app_state where key = 'ai_panel'`;
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES DE INTEGRAÇÃO PASSARAM");
process.exit(fails ? 1 : 0);

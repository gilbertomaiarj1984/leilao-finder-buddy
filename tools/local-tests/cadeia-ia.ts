// @ts-nocheck — script de teste local (não entra no typecheck do app). Ver tools/local-tests/README.md.
process.env.DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://postgres@127.0.0.1:54329/garimpo";
process.env.ANTHROPIC_API_KEY = "sk-teste";
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:4010";
const R = new URL("../../src/lib/", import.meta.url).pathname;
let fails = 0;
const ok = (n: string, c: boolean, x?: unknown) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  -> " + JSON.stringify(x)}`); if (!c) fails++; };

const seen: any[] = [];
const mock = Bun.serve({
  port: 4010,
  async fetch(req) {
    const url = new URL(req.url);
    const body = await req.json().catch(() => null);
    seen.push({ path: url.pathname, body });
    if (url.pathname === "/v1/messages") {
      // «De olho por texto» (migração da Sondagem): a IA falsa separa artista/álbum da linha.
      const asked = JSON.stringify(body?.messages ?? "");
      if (asked.includes("Linha:")) {
        const pick = asked.includes("ININTELIGIVEL")
          ? { artist: "", album: "", year: null }
          : asked.includes("Racional")
            ? { artist: "Tim Maia", album: "Racional Vol. 1", year: 1975 }
            : { artist: "Gilberto Gil", album: "Raça Humana", year: 1984 };
        return Response.json({ id: "msg_t", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(pick) }], usage: { input_tokens: 50, output_tokens: 20 } });
      }
      return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
        content: [{ type: "text", text: '```json\n{"score": 81, "rarity": "raro", "deal": "barato", "album": "Gilberto Gil - Raça Humana", "reason": "boa oportunidade", "tags": ["mpb","1984"]}\n```' }],
        usage: { input_tokens: 400, output_tokens: 60 } });
    }
    if (url.pathname === "/v1/messages/batches") return Response.json({ id: "batch_1", type: "message_batch", processing_status: "in_progress" });
    return new Response("nope", { status: 404 });
  },
});

const { getSql } = await import(R + "db.server");
const sql = getSql();
const app = await import(R + "app-state.server");
const mkt = await import(R + "lot-market.server");
const lai = await import(R + "lot-ai.server");
const ev = await import(R + "ai-eval.server");

await sql`delete from lots where id like 'chain-%'`;
await sql`delete from app_state where key in ('ai_panel','ai_provider','anthropic_model')`;
const title = "GILBERTO GIL - RAÇA HUMANA LP";
await sql`insert into lots (id,id_leilao,id_peca,base,lote,title,url,price,day_key,uf,house) values ('chain-1','9','1','b','1',${title},'http://x.com/1','R$ 40,00','2026-10-20','SP','Casa X')`;
await sql`insert into lot_condition (id,title_hash,media,sleeve,insert_state,score,faixa,source) values ('chain-1','h','VG+','VG+','sim',78,'Muito Bom','catalog')`;
await mkt.upsertLotMarket([{ id: "chain-1", basis: mkt.marketBasis("Gilberto Gil - Raça Humana", title), matched: true, release_id: 1, release_title: "x", year: 1984, num_for_sale: 12, lowest_price: 5.6, currency: "BRL", suggested_price: 50, suggested_condition: "VG+", suggested_by_condition: { NM: 66.27, "VG+": 50.68, "G+": 22.4 }, have: 3200, want: 1100, price_low_br: null, price_high_br: null, num_for_sale_br: null }]);

const lot = { id: "chain-1", title, price: "R$ 40,00", house: "Casa X", image: null as string | null };

// 1) avaliação síncrona: o prompt leva o contexto do banco
const r1 = await ev.evalLotsSync([lot], "anthropic");
const req1 = seen.find((s) => s.path === "/v1/messages");
const userText = JSON.stringify(req1?.body?.messages);
ok("sync: uma chamada à IA e 1 linha de resultado", r1.rows.length === 1 && r1.failed === 0, { rows: r1.rows.length, failed: r1.failed, error: r1.error });
ok("sync: prompt do sistema fala em reais e cita o contexto", String(req1?.body?.system ?? JSON.stringify(req1?.body?.system)).includes("reais") && JSON.stringify(req1.body.system).includes("contexto"));
ok("sync: prompt leva estado, Discogs e frete do BANCO", userText.includes("contexto") && userText.includes("VG+") && userText.includes("preco_sugerido") && userText.includes("frete_estimado_brl") && userText.includes("lote_brl"), userText.slice(0, 700));
ok("sync: âncora = VG+ (51), frete SP = 25, lote = 40, referência 76, razão 0,53", userText.includes('preco_sugerido\\":51') && userText.includes('frete_estimado_brl\\":25') && userText.includes('lote_brl\\":40') && userText.includes('referencia_com_frete_brl\\":76') && userText.includes("0.53"), userText);
ok("sync: parse do JSON da IA (nota 81, raro, barato)", r1.rows[0]?.score === 81 && r1.rows[0]?.rarity === "raro" && r1.rows[0]?.deal === "barato");
const row = r1.rows[0]!;
ok("sync: hash = evalHash(título) (versão + impressão do texto)", row.title_hash === ev.evalHash(title, true, "em") && row.title_hash.split(".").length === 4, row.title_hash);
ok("sync: eval_price gravado (40)", row.eval_price === 40);

// 2) persistir e conferir que o lote NÃO volta para a fila
await lai.upsertLotAi([row]);
const aiRows = await lai.getAllLotAiLean();
ok("seleção: lote avaliado não volta para a fila", ev.selectLotsToEvaluate([lot], aiRows).length === 0);
ok("seleção: mudou o título → volta", ev.selectLotsToEvaluate([{ ...lot, title: title + " 2" }], aiRows).length === 1);

// 3) configuração do painel muda o prompt (campos e ordem)
await app.setAiPanelConfig({ blocks: ["frete", "mercado"], hiddenFields: ["mercado.tem", "mercado.querem", "mercado.ano"], freight: { sudeste: 40, outras: 60 }, defaultCond: "G+" });
seen.length = 0;
const r2 = await ev.evalLotsSync([lot], "anthropic");
const t2 = JSON.stringify(seen.find((s) => s.path === "/v1/messages")?.body?.messages);
ok("painel→prompt: bloco «estado» desligado some", !t2.includes('estado\\":{') && !t2.includes("nota_estado"), t2);
ok("painel→prompt: campos desligados somem (tem/querem/ano)", !t2.includes("querem") && !t2.includes('tem\\"') && !t2.includes('ano\\"') && t2.includes("preco_sugerido"), t2);
ok("painel→prompt: frete configurado (SP = 40) e ordem frete antes do mercado", t2.includes('frete_estimado_brl\\":40') && t2.indexOf("frete_estimado_brl") < t2.indexOf("mercado_discogs_brl"), t2);
ok("painel→prompt: lote = 40 e referência = 51 + frete 40 = 91", t2.includes('lote_brl\\":40') && t2.includes('referencia_com_frete_brl\\":91'), t2);
ok("avaliação continua gravando o mesmo hash (config não reavalia sozinha)", r2.rows[0]?.title_hash === ev.evalHash(title, true, "em"));

// 4) Batches: o pedido leva o mesmo contexto e o hash
seen.length = 0;
const sub = await ev.submitEvalBatch([lot]);
const breq = seen.find((s) => s.path === "/v1/messages/batches");
const bUser = JSON.stringify(breq?.body?.requests?.[0]);
ok("batch: 1 requisição com custom_id = id do lote", breq?.body?.requests?.length === 1 && breq.body.requests[0].custom_id === "chain-1", breq?.body);
ok("batch: contexto congelado no envio (frete configurado)", bUser.includes("contexto") && bUser.includes('frete_estimado_brl\\":40'), bUser.slice(0, 500));
ok("batch: hashes por lote = evalHash; preço guardado", sub.hashes["chain-1"] === ev.evalHash(title, true, "em") && sub.prices?.["chain-1"] === 40, sub);

// 5) contexto indisponível → hash com 'x' e volta para a fila
await sql`alter table lot_market rename to lot_market_x`;
seen.length = 0;
const r3 = await ev.evalLotsSync([lot], "anthropic");
await sql`alter table lot_market_x rename to lot_market`;
ok("contexto falhou: avaliação segue sem o bloco, hash com sufixo x", r3.rows[0]?.title_hash === ev.evalHash(title, false) && r3.rows[0].title_hash.endsWith("x"), r3.rows[0]?.title_hash);
ok("contexto falhou: a nota volta para a fila (hash diverge)", ev.selectLotsToEvaluate([lot], [{ id: "chain-1", title_hash: r3.rows[0]!.title_hash }]).length === 1);

// 6) perfil do colecionador no prompt: um disco de olho ativo (Tim Maia) casa com um lote novo
await sql`delete from lookout_items`;
await sql`insert into lookout_items (lot_id, artist, album, year, status) values ('manual-chain', 'Tim Maia', 'Racional Vol. 1', 1975, 'active')`;
await sql`insert into lots (id,id_leilao,id_peca,base,lote,title,url,price,day_key,uf,house,artist) values ('chain-2','9','2','b','1','TIM MAIA - RACIONAL VOL. 1 LP','http://x.com/2','R$ 300,00','2026-10-20','RJ','Casa X','Tim Maia')`;
await app.setAiPanelConfig({}); // painel padrão (todos os blocos)
seen.length = 0;
await ev.evalLotsSync([{ id: "chain-2", title: "TIM MAIA - RACIONAL VOL. 1 LP", price: "R$ 300,00", house: "Casa X", image: null }], "anthropic");
const t6 = JSON.stringify(seen.find((s) => s.path === "/v1/messages")?.body?.messages);
ok("perfil do colecionador: «de olho» e «interesse» aparecem no prompt do lote", t6.includes("perfil_do_colecionador") && t6.includes("de_olho") && t6.includes("Racional") && t6.includes("nos_meus_interesses"), t6);
await sql`delete from lookout_items`;

await sql`delete from lots where id like 'chain-%'`;
await sql`delete from app_state where key in ('ai_panel')`;
mock.stop();
console.log(fails ? `\n${fails} FALHA(S)` : "\nCADEIA DE IA: TODOS OS TESTES PASSARAM");
process.exit(fails ? 1 : 0);

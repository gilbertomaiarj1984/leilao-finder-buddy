import { createRequire } from "node:module";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules") + "/");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const SECRET = process.env.SESSION_SECRET ?? "segredo-de-teste-local";
const OUT = process.env.OUT_DIR ?? "/tmp";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const payload = b64u(JSON.stringify({ email: "teste@example.com", exp: Date.now() + 3600e3 }));
const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
const cookie = `${payload}.${sig}`;
// psql usa PGHOST/PGPORT/PGUSER/PGDATABASE do ambiente.
const psql = (q) => execSync(`psql -At -c "${q}"`).toString().trim();

let fails = 0;
const ok = (name, cond, extra) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`); if (!cond) fails++; };

psql("delete from app_state where key in ('ai_panel','ai_mode')");
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });

await page.goto(BASE + "/ia-painel", { waitUntil: "networkidle" });
ok("painel abre com a sessão de teste", await page.getByRole("heading", { name: "Painel de IA" }).isVisible());
for (const t of ["Blocos de contexto", "Correlação de condições", "Frete e padrões", "Modelo e modo"])
  ok(`aba «${t}» existe`, await page.getByRole("tab", { name: t }).isVisible());

const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
// ---- Blocos ----
const names = await page.locator("main").innerText();
ok("4 blocos ligados", ["Estado de conservação", "Discogs · mercado em reais", "Frete do leilão", "Descrição completa do lote"].every((n) => names.includes(n)));
ok("seção «Em breve» com os 4 planejados", ["Vendas passadas do mesmo disco", "Perfil do colecionador", "Tracklist e fama das faixas", "Correções do usuário"].every((n) => names.includes(n)));
ok("«em breve» x «por ora não» corretos (2 e 2)", (names.match(/em breve/gi) || []).length === 3 /* título + 2 selos */ && (names.match(/por ora não/g) || []).length === 2, { breve: (names.match(/em breve/gi) || []).length });
const pre = () => page.locator("pre").first().innerText();
let p = await pre();
ok("prévia traz contexto, estado, mercado e frete", p.includes('"contexto"') && p.includes('"estado"') && p.includes('"mercado_discogs_brl"') && p.includes('"frete_estimado_brl"'), p.slice(0, 200));
// tirar o campo «Têm (have)» do bloco Discogs
await page.getByRole("button", { name: /Discogs · mercado em reais/ }).first().click();
await page.getByRole("button", { name: /Têm \(have\)/ }).click();
p = await pre();
ok("tirar campo «Têm» some da prévia", !p.includes('"tem"') && p.includes('"querem"'), p);
ok("botão Salvar habilita (alterações não salvas)", await page.getByText("alterações não salvas").isVisible() && (await page.getByRole("button", { name: "Salvar" }).isEnabled()));
// reordenar com ▲▼: subir o frete
const frete = page.locator("div[draggable=true]", { hasText: "Frete do leilão" }).first();
await frete.getByRole("button", { name: "Subir" }).click();
await frete.getByRole("button", { name: "Subir" }).click();
p = await pre();
ok("frete subiu para o topo do contexto", p.indexOf('"frete_estimado_brl"') < p.indexOf('"estado"'), p);
// arrastar e soltar: mover «Estado» para o fim
const est = page.locator("div[draggable=true]", { hasText: "Estado de conservação" }).first();
const disc = page.locator("div[draggable=true]", { hasText: "Discogs · mercado em reais" }).first();
await est.dragTo(disc, { targetPosition: { x: 20, y: 40 } });
p = await pre();
ok("arrastar e soltar reordena (Estado depois do Discogs)", p.indexOf('"mercado_discogs_brl"') < p.indexOf('"estado"'), p);
// tirar um bloco do prompt e voltar
await page.locator("div[draggable=true]", { hasText: "Estado de conservação" }).first().getByRole("button", { name: "Tirar do prompt" }).click();
p = await pre();
ok("bloco tirado do prompt some da prévia", !p.includes('"estado"'));
ok("aparece em «Fora do prompt»", await page.getByRole("button", { name: /\+ Estado de conservação|Estado de conservação/ }).first().isVisible());
await page.getByRole("button", { name: "Estado de conservação" }).last().click();
p = await pre();
ok("bloco volta ao prompt", p.includes('"estado"'));

await shot("blocos");
// ---- Correlação ----
await page.getByRole("tab", { name: "Correlação de condições" }).click();
const corr = await page.locator("main").innerText();
for (const term of ["muito bom", "excelente", "bom", "regular", "lacrado", "near mint", "péssimo"])
  ok(`vocabulário em português: «${term}»`, corr.toLowerCase().includes(term));
ok("colunas por condição (7)", ["M · Mint", "NM · Near Mint", "VG+ ·", "VG ·", "G+ ·", "G ·", "F/P ·"].every((c) => corr.includes(c)));
const test = page.getByLabel("Descrição do lote para testar");
await test.fill("LP Fulano | Em ótimo estado, mas com riscos que podem afetar a audição");
ok("testador: cap pelos riscos → condição G+", (await page.locator("main").innerText()).includes("Disco G+"), null);
await test.fill("LP Fulano | sem encarte em bom estado");
ok("testador: 'sem encarte em bom estado' = VG", (await page.locator("main").innerText()).includes("Disco VG"), null);
await test.fill("Disco VG+. Riscos superficiais que não afetam a audição");
ok("testador: negação dentro do trecho não rebaixa", (await page.locator("main").innerText()).includes("Disco VG+"), null);
// nova expressão
await page.getByPlaceholder("ex.: riscos * audição").fill("muito bem conservado");
await page.locator("select").first().selectOption("VG+");
await page.getByRole("button", { name: "Adicionar" }).click();
await test.fill("LP Fulano | muito bem conservado");
ok("expressão nova do usuário passa a valer no testador", (await page.locator("main").innerText()).includes("Disco VG+"));
// arrastar a expressão do usuário para a coluna G
const chip = page.locator("div[draggable=true]", { hasText: "muito bem conservado" }).first();
const colG = page.locator("h3", { hasText: /^G · Bom$/ }).locator("..");
await chip.dragTo(colG);
await test.fill("LP Fulano | muito bem conservado");
ok("arrastar expressão para outra coluna muda a condição (G)", (await page.locator("main").innerText()).includes("Disco G"), null);
// desligar regra do app
await page.getByTitle(/Do app — clique para desligar/).first().click();
ok("regra do app pode ser desligada (riscada)", (await page.locator("button[title^='Desligada']").count()) >= 1);

await shot("correlacao");
// ---- Frete e padrões ----
await page.getByRole("tab", { name: "Frete e padrões" }).click();
const inputs = page.locator("input[type=number]");
await inputs.nth(0).fill("30"); await inputs.nth(1).fill("45");
const frTxt = (await page.locator("main").innerText()).replace(/\u00a0/g, " ");
ok("exemplo recalcula com o frete novo (40+30=70, 40+45=85)", frTxt.includes("R$ 70,00") && frTxt.includes("R$ 85,00"), frTxt.slice(0, 400));
await page.locator("select").first().selectOption("VG");

await shot("frete");
// ---- Salvar e conferir no banco ----
await page.getByRole("button", { name: "Salvar" }).click();
await page.getByText("Painel de IA salvo").waitFor({ timeout: 5000 }).catch(() => {});
const saved = JSON.parse(psql("select value::text from app_state where key='ai_panel'") || "null");
ok("salvou no banco: frete 30/45, condição VG", saved?.freight?.sudeste === 30 && saved?.freight?.outras === 45 && saved?.defaultCond === "VG", saved);
ok("salvou no banco: campo «mercado.tem» oculto e ordem dos blocos", saved?.hiddenFields?.includes("mercado.tem") && saved?.blocks?.[0] === "frete", saved);
ok("salvou no banco: expressão do usuário (coluna G) e regra do app desligada", saved?.rules?.some((r) => r.phrase === "muito bem conservado" && r.grade === "G") && saved?.disabledRules?.length === 1, saved);

// ---- Recarregar: persistência ----
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Frete e padrões" }).click();
ok("depois de recarregar, frete 30/45 continua", (await inputs.nth(0).inputValue()) === "30" && (await inputs.nth(1).inputValue()) === "45");
await page.getByRole("tab", { name: "Blocos de contexto" }).click();
p = await pre();
ok("depois de recarregar, prévia mantém ordem e campo oculto", !p.includes('"tem"') && p.indexOf('"frete_estimado_brl"') < p.indexOf('"mercado_discogs_brl"'), p);

// ---- Modelo e modo ----
await page.getByRole("tab", { name: "Modelo e modo" }).click();
await page.getByRole("combobox", { name: "Modo da IA" }).click();
await page.getByRole("option", { name: "IA: desligada" }).click();
await page.waitForTimeout(800);
ok("modo da IA gravado no servidor (off)", psql("select value::text from app_state where key='ai_mode'").includes("off"), psql("select value::text from app_state where key='ai_mode'"));
ok("seletor de modelo presente", await page.getByRole("combobox", { name: "IA e modelo" }).isVisible());
await page.getByRole("combobox", { name: "Modo da IA" }).click();
await page.getByRole("option", { name: "IA: vigiados + lances" }).click();
await page.waitForTimeout(500);

await shot("modelo");
// ---- Restaurar padrão ----
await page.getByRole("button", { name: "Restaurar padrão" }).click();
await page.getByRole("button", { name: "Salvar" }).click();
await page.getByText("Painel de IA salvo").waitFor({ timeout: 5000 }).catch(() => {});
const def = JSON.parse(psql("select value::text from app_state where key='ai_panel'"));
ok("restaurar padrão + salvar volta tudo ao padrão", def.freight.sudeste === 25 && def.defaultCond === "G+" && def.rules.length === 0 && def.blocks.length === 4 && def.hiddenFields.length === 0, def);

// ---- Rodapé / rotas ----
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const home = await page.locator("body").innerText();
ok("rodapé da tela inicial sem o seletor de modo/modelo", !(await page.getByRole("combobox", { name: "Modo da IA" }).count()) && !(await page.getByRole("combobox", { name: "IA e modelo" }).count()));
ok("rodapé tem o atalho «Painel de IA»", (await page.getByRole("link", { name: /Painel de IA/ }).count()) >= 1, home.slice(-300));

ok("sem erros de JavaScript no navegador", errors.length === 0, errors);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES E2E PASSARAM");
process.exit(fails ? 1 : 0);

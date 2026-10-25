// De olho: arrastar UM lote "por vir" para outro disco (v0.183.0). Reproduz o relato "o 1º lote arrasta
// sozinho, o 2º e o 3º levam o disco inteiro": linhas "ORIGEM" de álbuns JUNTADOS não eram arrastáveis e o
// arrasto subia ao cartão. Pré-requisitos: ver README.md (servidor em BASE_URL, PG* e Chromium).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules") + "/");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const SECRET = process.env.SESSION_SECRET ?? "segredo-de-teste-local";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const payload = b64u(JSON.stringify({ email: "teste@example.com", exp: Date.now() + 3600e3 }));
const cookie = `${payload}.${b64u(crypto.createHmac("sha256", SECRET).update(payload).digest())}`;
const psql = (q) => execSync("psql -At -q", { input: q }).toString().trim();

// Id de leilão novo a cada rodada: o servidor guarda um cache curto por lote e este teste apaga/semeia
// direto no banco (por fora do app), então reutilizar os mesmos ids deixaria o cache da rodada anterior.
const AUC = String(600000 + Math.floor(Math.random() * 300000));
const LOT = (n) => `${AUC}-${n}`;

let fails = 0;
const ok = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`);
  if (!cond) fails++;
};

// Disco "Construção" com 2 álbuns juntados (origens do 2º e do 3º lote) e 2 lotes comuns (500-1, 500-4);
// destino: "Almanaque" (sem lote por vir).
function seed() {
  psql("delete from lookout_items; delete from lots; delete from lot_ident; delete from app_state where key like 'lookout%'");
  psql(`insert into lookout_items (lot_id, artist, album, year, status, merged) values
    ('manual-a','Chico Buarque','Construção',1971,'active','[
      {"lotId":"${LOT(2)}","artist":"Chico Buarque","album":"Construção","year":1971,"title":"LP Chico Buarque - Construção 1971 Disco VG+","house":"Casa Teste","image":null,"url":"https://example.com/2","dayKey":"2026-10-27"},
      {"lotId":"${LOT(3)}","artist":"Chico Buarque","album":"Construção","year":1971,"title":"Disco Chico Buarque - Construção (1971) capa VG","house":"Casa Teste","image":null,"url":"https://example.com/3","dayKey":"2026-10-27"}]'::jsonb),
    ('manual-b','Chico Buarque','Almanaque',1981,'active','[]'::jsonb)`);
  const lot = (n, lote, title, price) =>
    `('${AUC}-${n}','${AUC}','${n}','0','${lote}','${title}','https://example.com/${n}','${price}','2026-10-27','19:00','Casa Teste','Chico Buarque')`;
  psql(`insert into lots (id,id_leilao,id_peca,base,lote,title,url,price,day_key,start_time,house,artist) values
    ${lot(1, 11, "LP Chico Buarque - Construção (1971) Philips", "R$ 20,00")},
    ${lot(2, 12, "LP Chico Buarque - Construção 1971 Disco VG+", "R$ 25,00")},
    ${lot(3, 13, "Disco Chico Buarque - Construção (1971) capa VG", "R$ 30,00")},
    ${lot(4, 14, "LP Chico Buarque - Construção 1971 Philips raro", "R$ 35,00")}`);
}

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.addEventListener("dragstart", (e) => { window.__dragFrom = e.target.tagName; }, true);
});

// Abre /olho na visão Expandida com os dados recém-semeados ("Atualizar" ignora o resumo em cache do servidor).
async function abrir() {
  await page.goto(BASE + "/olho", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Atualizar" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Expandido" }).click();
  await page.waitForTimeout(1500);
}

const where = (lotId) =>
  psql(`select case when exists (select 1 from lookout_items where album='Almanaque' and merged @> '[{"lotId":"${lotId}"}]') then 'merged-almanaque'
        when (select value->>'${lotId}' from app_state where key='lookout_links') is not null then 'link' else 'nada' end`);

for (const n of [1, 2, 3, 4]) {
  const lotId = LOT(n);
  seed();
  await abrir();
  // a linha do lote é achada pelo título (cada lote 500-N tem um título próprio)
  const titleOf = { 1: "Construção (1971) Philips", 2: "Disco VG+", 3: "capa VG", 4: "Philips raro" }[n];
  const li = page.locator("section li[draggable='true']", { hasText: titleOf }).first();
  ok(`${lotId}: a linha é arrastável (draggable=true)`, (await li.count()) === 1);
  const sb = await li.boundingBox();
  const db = await page.getByText("Chico Buarque — Almanaque (1981)").last().boundingBox();
  await page.evaluate(() => { window.__dragFrom = null; });
  await page.mouse.move(sb.x + 90, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 100, sb.y + sb.height / 2 + 8, { steps: 4 });
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  ok(`${lotId}: o arrasto começou na LINHA (não no cartão inteiro)`, (await page.evaluate(() => window.__dragFrom)) === "LI", await page.evaluate(() => window.__dragFrom));
  ok(`${lotId}: só este lote foi movido para Almanaque`, where(lotId) !== "nada", where(lotId));
  ok(`${lotId}: o disco de origem não foi juntado ao destino (2 discos continuam)`, psql("select count(*) from lookout_items") === "2");
}
// Botão ⇄ (sem arrastar): move só a linha escolhida.
seed();
await abrir();
const moveBtns = page.getByRole("button", { name: "Mover só este lote para outro disco" });
ok("todas as 4 linhas têm o botão ⇄ «Mover só este lote»", (await moveBtns.count()) === 4, await moveBtns.count());
await moveBtns.nth(3).click();
await page.getByLabel("Mover este lote para o disco…").selectOption({ label: "Chico Buarque — Almanaque (1981)" });
await page.waitForTimeout(2500);
ok("o botão ⇄ moveu só um lote (vínculo gravado, 2 discos)", psql("select count(*) from app_state where key='lookout_links'") === "1" && psql("select count(*) from lookout_items") === "2");
// "Não é este disco" (✕) e "Criar disco novo" (+) em TODAS as linhas, inclusive as de origem.
seed();
await abrir();
const xBtns = page.getByRole("button", { name: "Não é este disco" });
const plusBtns = page.getByRole("button", { name: "Criar novo álbum de olho a partir deste lote" });
ok("todas as 4 linhas têm ✕ «Não é este disco» e + «Criar novo»", (await xBtns.count()) === 4 && (await plusBtns.count()) === 4, [await xBtns.count(), await plusBtns.count()]);
const originRow = page.locator("section li", { hasText: "Disco VG+" }).first(); // 500-2: origem de álbum juntado
await originRow.getByRole("button", { name: "Não é este disco" }).click();
await page.waitForTimeout(2500);
ok("✕ numa origem de álbum juntado: sai do disco e fica descartado", psql("select jsonb_array_length(merged)::text from lookout_items where album='Construção'") === "1" && psql(`select coalesce(value->>'${LOT(2)}','x') from app_state where key='lookout_links'`) === "false");
seed();
await abrir();
await page.locator("section li", { hasText: "capa VG" }).first().getByRole("button", { name: "Criar novo álbum de olho a partir deste lote" }).click();
await page.waitForTimeout(2500);
ok("+ numa origem de álbum juntado: vira um disco próprio (3 discos)", psql("select count(*) from lookout_items") === "3" && psql(`select count(*) from lookout_items where lot_id='${LOT(3)}'`) === "1");
ok("sem erros de JavaScript", errors.length === 0, errors);

seed();
psql("delete from lookout_items; delete from lots; delete from lot_ident; delete from app_state where key like 'lookout%'");
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES E2E PASSARAM");
process.exit(fails ? 1 : 0);

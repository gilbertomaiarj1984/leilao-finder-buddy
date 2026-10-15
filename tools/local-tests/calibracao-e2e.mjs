// Aba «Calibração» do painel de IA (compras recebidas × estado real). Ver README.md.
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules") + "/");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const SECRET = process.env.SESSION_SECRET ?? "segredo-de-teste-local";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const payload = b64u(JSON.stringify({ email: "teste@example.com", exp: Date.now() + 3600e3 }));
const cookie = `${payload}.${b64u(crypto.createHmac("sha256", SECRET).update(payload).digest())}`;
const psql = (q) => execSync(`psql -At -c "${q}"`).toString().trim();

let fails = 0;
const ok = (name, cond, extra) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`); if (!cond) fails++; };

const reset = () => {
  psql("delete from purchase_calibration where lot_id like 'cal-%'");
  psql("delete from purchases where lot_id like 'cal-%'");
  psql("delete from purchase_auctions where id_leilao in ('801','802')");
  psql("delete from lot_sales where lot_id like 'cal-%'");
  psql("delete from app_state where key = 'ai_panel'");
};
reset();
// Pregão 801 recebido (4 discos lidos como VG+; 3 chegaram VG), pregão 802 ainda em trânsito.
psql("insert into purchase_auctions (id_leilao,status,received_at) values ('801','recebido','2026-10-10'), ('802','transito',null)");
for (const i of [1, 2, 3, 4]) {
  psql(`insert into purchases (lot_id,id_peca,id_leilao,title,won_price,won_date,house,uf) values ('cal-${i}','cal-${i}','801','LP Artista ${i} - Album ${i}','R$ ${20 + i},00','2026-10-01','Casa','SP')`);
  psql(`insert into lot_sales (lot_id,id_leilao,id_peca,artist,title,sold_price,orig_text) values ('cal-${i}','801','cal-${i}','Artista ${i}','Artista ${i} - Album ${i}',${20 + i},'ARTISTA ${i} - ALBUM ${i} - CAPA VG+ - DISCO VG+')`);
}
psql("insert into purchases (lot_id,id_peca,id_leilao,title,won_price,won_date,house,uf) values ('cal-9','cal-9','802','LP Em Transito','R$ 10,00','2026-10-01','Casa','SP')");
for (const i of [1, 2, 3]) psql(`insert into purchase_calibration (lot_id, real_media, real_sleeve) values ('cal-${i}', 'VG', 'VG+')`);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/ia-painel", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Calibração" }).click();
await page.getByText("4 compra(s) recebida(s)").waitFor({ timeout: 10000 });
ok("só as compras de pregão «recebido» aparecem (4 de 5)", await page.getByText("4 compra(s) recebida(s)").isVisible() && (await page.getByText("LP Em Transito").count()) === 0);
const text = await page.locator("main").innerText();
ok("resumo do estado do disco: 3 discos, 0% exato (lido VG+, chegou VG)", /Estado do disco/i.test(text) && /3 discos/.test(text) && /0% exato/.test(text), text.slice(0, 600));
ok("o app lê melhor do que o disco é (viés otimista)", /o app lê melhor/.test(text), text.slice(0, 600));
ok("sugestão aparece (VG+ chegou pior em 3 de 3)", /VG\+ chegaram piores em 3 de 3/.test(text), text);
ok("capa lida VG+ e real VG+: 100% exato", /Estado da capa[\s\S]{0,40}100% exato/i.test(text), text.slice(0, 600));

// Preenche a opinião da 4ª compra pela tela.
const card = page.locator("div.rounded-md.border", { hasText: "Artista 4 - Album 4" }).last();
await card.getByRole("combobox", { name: "Estado real do disco" }).click();
await page.getByRole("option", { name: "VG", exact: true }).click();
await card.getByLabel("Nota que eu daria (0 a 100)").fill("40");
await card.getByRole("button", { name: "Não valeu" }).click();
await card.getByLabel("Observação").fill("riscos fundos");
await card.getByRole("button", { name: "Salvar" }).click();
await page.waitForTimeout(1000);
const saved = psql("select real_media || '|' || real_score || '|' || verdict || '|' || note from purchase_calibration where lot_id = 'cal-4'");
ok("a opinião da tela foi gravada no banco", saved === "VG|40|nao_valeu|riscos fundos", saved);
await page.getByText("4 discos").first().waitFor({ timeout: 5000 }).catch(() => {});
ok("o resumo se atualiza (4 discos com estado)", /4 discos/.test(await page.locator("main").innerText()));

await page.getByRole("button", { name: "Só as que faltam opinar" }).click();
ok("filtro «só as que faltam» esconde as respondidas (as 4 já têm opinião)", (await page.getByText(/Album [1-4]/).count()) === 0, await page.getByText(/Album [1-4]/).count());

await page.setViewportSize({ width: 390, height: 800 });
await page.goto(BASE + "/ia-painel", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Calibração" }).click();
await page.getByText("compra(s) recebida(s)").waitFor({ timeout: 10000 });
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
ok(`Calibração no celular: sem rolagem horizontal (scrollWidth ${sw} / 390)`, sw <= 391, sw);
ok("sem erros de JavaScript", errors.length === 0, errors);

reset();
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES E2E PASSARAM");
process.exit(fails ? 1 : 0);

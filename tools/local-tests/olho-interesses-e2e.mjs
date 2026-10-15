// De olho + Meus interesses (perfil do colecionador); a Sondagem foi removida.
// Pré-requisitos: ver README.md (servidor em BASE_URL e PGHOST/PGPORT/PGUSER/PGDATABASE).
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
  psql("delete from lookout_items");
  psql("delete from app_state where key in ('user_interests')");
};
reset();
psql("insert into lookout_items (lot_id, artist, album, year, status) values ('manual-e2e', 'Chico Buarque', 'Construção', 1971, 'active')");

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/olho", { waitUntil: "networkidle" });
ok("não existe mais o aviso de migração da Sondagem", (await page.getByText("A Sondagem foi descontinuada").count()) === 0);

await page.getByRole("button", { name: /Meus interesses/ }).click();
ok("«Meus interesses» mostra os artistas do De olho", await page.getByText(/Do De olho \(1\)/).isVisible() && await page.getByRole("button", { name: /Chico Buarque/ }).isVisible());
await page.getByRole("button", { name: /Chico Buarque/ }).click();
ok("fixar copia o artista para a lista manual", (await page.locator("textarea").inputValue()).includes("Chico Buarque"));
await page.getByRole("button", { name: "Salvar" }).click();
await page.waitForTimeout(800);
ok("salvou os interesses no banco", psql("select value::text from app_state where key = 'user_interests'").includes("Chico Buarque"));

await page.goto(BASE + "/analise", { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Análise de Lotes" }).waitFor({ timeout: 15000 });
const analiseHtml = await page.locator("main").innerText();
ok("Análise sem «Sondagem»; com atalho «De olho e interesses»", !/sondagem/i.test(analiseHtml) && await page.getByRole("link", { name: /De olho e interesses/ }).isVisible(), analiseHtml.slice(0, 300));

await page.setViewportSize({ width: 390, height: 800 });
await page.goto(BASE + "/olho", { waitUntil: "networkidle" });
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
ok(`De olho no celular: sem rolagem horizontal da página (scrollWidth ${sw} / 390)`, sw <= 391, sw);
ok("sem erros de JavaScript", errors.length === 0, errors);

reset();
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES E2E PASSARAM");
process.exit(fails ? 1 : 0);

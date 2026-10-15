import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules") + "/");
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const SECRET = process.env.SESSION_SECRET ?? "segredo-de-teste-local";
const OUT = process.env.OUT_DIR ?? "/tmp";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const payload = b64u(JSON.stringify({ email: "teste@example.com", exp: Date.now() + 3600e3 }));
const cookie = `${payload}.${b64u(crypto.createHmac("sha256", SECRET).update(payload).digest())}`;
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
await page.goto(BASE + "/ia-painel", { waitUntil: "networkidle" });
for (const [tab, name] of [["Blocos de contexto", "m-blocos"], ["Correlação de condições", "m-correl"], ["Frete e padrões", "m-frete"], ["Modelo e modo", "m-modelo"]]) {
  await page.getByRole("tab", { name: tab }).click();
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log(`${sw.sw <= sw.cw + 1 ? "PASS" : "FAIL"}  ${tab}: sem rolagem horizontal da página (scrollWidth ${sw.sw} / ${sw.cw})`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

// ---- Menu do celular: atalho do painel (e sem os seletores antigos) ----
{
  const p2 = await ctx.newPage();
  const errors = [];
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(2500);
  await p2.getByRole("button", { name: "Menu" }).click();
  await p2.waitForTimeout(600);
  const hasLink = (await p2.getByRole("link", { name: /Painel de IA/ }).count()) >= 1;
  const old = (await p2.getByRole("combobox", { name: "Modo da IA" }).count()) + (await p2.getByRole("combobox", { name: "IA e modelo" }).count());
  console.log(`${hasLink ? "PASS" : "FAIL"}  menu mobile tem o atalho «Painel de IA»`);
  console.log(`${old === 0 ? "PASS" : "FAIL"}  menu mobile sem os seletores antigos de modo/modelo`);
  console.log(`${errors.length === 0 ? "PASS" : "FAIL"}  sem erros de JavaScript na tela inicial`);
}
await browser.close();

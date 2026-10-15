// «Ver no Analytics» (nota da IA → grupo do Analytics): a rota abre o artista e o álbum certos.
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

psql("delete from lot_sales where lot_id like 'lsale-%'");
for (const [id, album, price] of [["lsale-1", "Raça Humana", 30], ["lsale-2", "Raça Humana", 50], ["lsale-3", "Refazenda", 70]])
  psql(`insert into lot_sales (lot_id,id_leilao,id_peca,artist,title,sold_price,sold_date,score) values ('${id}','1','${id}','Gilberto Gil','Gilberto Gil - ${album}',${price},'2026-09-10',70)`);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "gs_session", value: cookie, url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/vinil-analytics?artist=gilberto%20gil&album=raca%20humana", { waitUntil: "networkidle" });
await page.getByText("Raça Humana").first().waitFor({ timeout: 10000 }).catch(() => {});
ok("o artista do link abre sozinho", await page.getByText("Raça Humana").first().isVisible());
ok("o álbum do link fica destacado (borda do grupo)", (await page.locator("div.ring-primary\\/40").count()) === 1);
ok("o outro álbum aparece, sem destaque", await page.getByText("Refazenda").first().isVisible());
await page.goto(BASE + "/vinil-analytics", { waitUntil: "networkidle" });
ok("sem link, nada fica aberto nem destacado", (await page.locator(".ring-primary\\/40").count()) === 0 && (await page.getByText("Refazenda").count()) === 0);
ok("sem erros de JavaScript", errors.length === 0, errors);

psql("delete from lot_sales where lot_id like 'lsale-%'");
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : "\nTODOS OS TESTES E2E PASSARAM");
process.exit(fails ? 1 : 0);

// Trava por step do cron (`cron-lock.server.ts`) contra um Postgres de verdade: a 2ª chamada do mesmo
// step enquanto a 1ª roda volta `busy`; outro step e a chamada depois da 1ª passam.
import { withStepLock } from "../../src/lib/cron-lock.server";
process.env["DATABASE_URL"] ??= process.env["TEST_DATABASE_URL"];
const a = withStepLock("teste", async () => { await new Promise(r => setTimeout(r, 1500)); return "A"; });
await new Promise(r => setTimeout(r, 300));
const b = await withStepLock("teste", async () => "B");
const c = await withStepLock("outro", async () => "C");
const aRes = await a;
const d = await withStepLock("teste", async () => "D");
console.log(JSON.stringify({ a: aRes, b, c, d }));
process.exit(0);

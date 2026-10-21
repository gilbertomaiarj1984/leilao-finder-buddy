// Alerta de teto de lance (`bid-cap-alerts.server.ts`) contra o Postgres: com push desligado, o lote barato
// lança "nenhum aparelho recebeu" (alerta detectado) e o estado só avança depois do envio.
process.env["DATABASE_URL"] ??= process.env["TEST_DATABASE_URL"];
const root = new URL("../../src/lib/", import.meta.url).pathname;
const { db } = await import(root + "db-client.server");
const { notifyBidCaps } = await import(root + "bid-cap-alerts.server");
const { upcomingDayKeys } = await import(root + "vinyl-parse");
const day = upcomingDayKeys(2)[1]!; const [y, m, d] = day.split("-");
await db.from("lots").upsert({ id: "cap-1", id_leilao: "9", id_peca: "1", base: "b", lote: "1", title: "t", url: "u", day_key: day, uf: "SP" }, { onConflict: "id" });
await db.from("lot_market").upsert({ id: "cap-1", basis: "m2:x", matched: true, release_id: 1, release_title: "x", year: 1975, num_for_sale: 3, lowest_price: 5, currency: "BRL", suggested_price: 100, suggested_condition: "VG+", suggested_by_condition: { "VG+": 100, "G+": 60 }, have: 1, want: 2 }, { onConflict: "id" });
const w = (price: string) => [{ id: "cap-1", idPeca: "1", idLeilao: "9", base: "b", lote: "1", title: "Disco", url: "u", image: null, price, date: `${d}/${m}/${y}`, time: "19:00h", house: "Casa", houseUrl: "#", uf: "SP", artist: "", watched: true as const }];
// âncora G+ 60 (sem estado) + frete 25 = 85 -> teto barato 59
try { console.log("caro:", JSON.stringify(await notifyBidCaps(w("R$ 80,00")))); } catch (e) { console.log("caro erro:", (e as Error).message); }
try { console.log("barato:", JSON.stringify(await notifyBidCaps(w("R$ 40,00")))); } catch (e) { console.log("barato erro:", (e as Error).message); }
console.log("estado:", JSON.stringify((await db.from("app_state").select("value").eq("key", "bid_cap_state").maybeSingle()).data?.value));
await db.from("lots").delete().eq("id", "cap-1"); await db.from("app_state").delete().eq("key", "bid_cap_state");
process.exit(0);

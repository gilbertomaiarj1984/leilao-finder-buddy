import { db } from "@/lib/db-client.server";

/**
 * `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` têm FK `ON DELETE CASCADE` pra `lots(id)`
 * (v0.67.0, "FKs de limpeza"). Quem escreve nessas tabelas às vezes trabalha em cima de dados
 * que sobrevivem à exclusão de um lote (`lot_sales`, o histórico de vendas, nunca é apagado) ou
 * de um batch montado antes de um `step=prune`/exclusão manual rodar no meio do caminho — nesse
 * intervalo, o `id` do payload pode não existir mais em `lots` e o upsert quebra com violação de
 * FK (`23503`). Devolve só os `id`s do array de entrada que AINDA existem em `lots`, para os
 * writers descartarem as linhas órfãs em vez de propagar a exceção (achado v0.76.2/v0.76.3 —
 * ver CHANGELOG.md).
 */
export async function filterExistingLotIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db.from("lots").select("id").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}

/** dd/mm/yyyy (site) -> yyyy-mm-dd, ou null quando não casa OU é uma data inválida. */
function brDateToDayKey(value: string): string | null {
  const m = (value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[1])) return null;
  return iso;
}

/**
 * Garante uma linha em `lots` para lotes da CONTA (vigiados/lances) que a varredura geral não
 * traz (casas parceiras/catálogos, v0.105.6). Sem ela, a FK de `lot_ai` rejeita a nota e o
 * guard acima a descartava em silêncio — o card mostrava "Nota atualizada" e a nota sumia no
 * próximo refetch. Os dados vêm das listas da conta (`listWatchedFromSite`/`listMyBidsFromSite`);
 * id que não está em nenhuma delas (ou excluído manualmente) é ignorado. Devolve os `id`s criados.
 */
export async function ensureAccountLotStubs(ids: string[]): Promise<Set<string>> {
  const created = new Set<string>();
  if (!ids.length) return created;
  const [{ listWatchedFromSite }, { listMyBidsFromSite }, { getExcludedLotIds }] =
    await Promise.all([
      import("./leiloesbr-watch.server"),
      import("./leiloesbr-bids.server"),
      import("./lot-exclusion.server"),
    ]);
  const wanted = new Set(ids);
  const [watched, bids, excluded] = await Promise.all([
    listWatchedFromSite().catch(() => []),
    listMyBidsFromSite().catch(() => []),
    getExcludedLotIds(),
  ]);
  const nowIso = new Date().toISOString();
  const rows = new Map<string, Record<string, unknown>>();
  // Vigiados primeiro: trazem hora/preço/casa; o lance só entra se o lote não está vigiado.
  for (const l of [...watched, ...bids]) {
    if (!wanted.has(l.id) || rows.has(l.id) || excluded.has(l.id)) continue;
    const dayKey = brDateToDayKey(l.date);
    if (!dayKey) continue;
    rows.set(l.id, {
      id: l.id,
      id_leilao: l.idLeilao,
      id_peca: l.idPeca,
      base: l.base,
      lote: l.lote,
      title: l.title,
      url: l.url,
      image: l.image,
      price: "price" in l ? l.price : "",
      day_key: dayKey,
      start_time: "time" in l ? l.time : "",
      uf: l.uf,
      house: l.house,
      house_url: "houseUrl" in l ? l.houseUrl : "",
      artist: "artist" in l ? l.artist : "",
      last_seen_at: nowIso,
      updated_at: nowIso,
    });
  }
  if (!rows.size) return created;
  const { error } = await db.from("lots").upsert([...rows.values()], { onConflict: "id" });
  if (error) {
    console.error("[lot-orphan-guard] não foi possível criar lotes da conta em lots", error);
    return created;
  }
  for (const id of rows.keys()) created.add(id);
  return created;
}

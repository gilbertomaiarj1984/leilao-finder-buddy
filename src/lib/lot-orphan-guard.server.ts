import { db } from "@/lib/db-client.server";
import type { VinylLot } from "./vinyl-parse";

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
async function filterExistingLotIds(ids: string[]): Promise<Set<string>> {
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

// `reident` esbarra em dezenas de órfãos por rodada: evita reler a conta (2 logins/fetches) a cada uma.
let accountCache: { at: number; lots: Promise<VinylLot[]> } | null = null;
const ACCOUNT_TTL_MS = 60_000;

/**
 * Lotes da CONTA (vigiados + com lance) no formato da varredura, com cache de 60s. Lance sem data
 * válida é ignorado. Vigiado vence lance (traz hora/preço/casa). Falha de leitura = lista vazia.
 */
export async function getAccountLots(): Promise<VinylLot[]> {
  if (accountCache && Date.now() - accountCache.at <= ACCOUNT_TTL_MS) return accountCache.lots;
  const load = async (): Promise<VinylLot[]> => {
    const [{ listWatchedFromSite }, { listMyBidsFromSite }, { extractArtist }] = await Promise.all([
      import("./leiloesbr-watch.server"),
      import("./leiloesbr-bids.server"),
      import("./vinyl-parse"),
    ]);
    const [watched, bids] = await Promise.all([
      listWatchedFromSite().catch(() => []),
      listMyBidsFromSite().catch(() => []),
    ]);
    const out = new Map<string, VinylLot>();
    for (const l of [...watched, ...bids]) {
      if (out.has(l.id)) continue;
      const dayKey = brDateToDayKey(l.date);
      if (!dayKey) continue;
      out.set(l.id, {
        id: l.id,
        idPeca: l.idPeca,
        idLeilao: l.idLeilao,
        base: l.base,
        lote: l.lote,
        watched: true,
        title: l.title,
        url: l.url,
        image: l.image,
        price: "price" in l ? l.price : "",
        dayKey,
        time: "time" in l ? l.time : "",
        uf: l.uf,
        house: l.house,
        houseUrl: "houseUrl" in l ? l.houseUrl : "",
        artist: "artist" in l ? l.artist : extractArtist(l.title),
      });
    }
    return [...out.values()];
  };
  accountCache = { at: Date.now(), lots: load() };
  return accountCache.lots;
}

/**
 * Garante uma linha em `lots` para lotes da CONTA (vigiados/lances) que a varredura geral não
 * traz (casas parceiras/catálogos, ou além da janela). Sem ela, a FK de `lot_ai` rejeita a nota e
 * o guard descartava a linha em silêncio. Id que não está na conta (ou foi excluído manualmente)
 * é ignorado. Devolve os `id`s criados.
 */
async function ensureAccountLotStubs(ids: string[]): Promise<Set<string>> {
  const created = new Set<string>();
  if (!ids.length) return created;
  const { getExcludedLotIds } = await import("./lot-exclusion.server");
  const wanted = new Set(ids);
  const [account, excluded] = await Promise.all([getAccountLots(), getExcludedLotIds()]);
  const nowIso = new Date().toISOString();
  const rows = account
    .filter((l) => wanted.has(l.id) && !excluded.has(l.id))
    .map((l) => ({
      id: l.id,
      id_leilao: l.idLeilao,
      id_peca: l.idPeca,
      base: l.base,
      lote: l.lote,
      title: l.title,
      url: l.url,
      image: l.image,
      price: l.price,
      day_key: l.dayKey,
      start_time: l.time,
      uf: l.uf,
      house: l.house,
      house_url: l.houseUrl,
      artist: l.artist,
      last_seen_at: nowIso,
      updated_at: nowIso,
    }));
  if (!rows.length) return created;
  const { error } = await db.from("lots").upsert(rows, { onConflict: "id" });
  if (error) {
    console.error("[lot-orphan-guard] não foi possível criar lotes da conta em lots", error);
    return created;
  }
  for (const r of rows) created.add(r.id);
  return created;
}

/**
 * Ids de `ids` que existem em `lots`, criando antes (via conta) os de vigiado/lance fora da
 * varredura. Usado pelos writers de `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` no `23503`.
 */
export async function resolveLotIdsWithAccount(ids: string[]): Promise<Set<string>> {
  const valid = await filterExistingLotIds(ids);
  const missing = ids.filter((id) => !valid.has(id));
  if (!missing.length) return valid;
  const created = await ensureAccountLotStubs(missing).catch((e: unknown) => {
    console.error("[lot-orphan-guard] falha ao criar lotes da conta em lots", e);
    return new Set<string>();
  });
  return new Set([...valid, ...created]);
}

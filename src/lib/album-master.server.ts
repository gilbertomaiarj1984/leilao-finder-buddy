import { db } from "@/lib/db-client.server";

import { discogsConfigured, lookupMaster } from "./discogs.server";

/**
 * Preenche o master do Discogs (`master_id`) dos itens do De olho e da Coleção que ainda não têm
 * (NULL = não consultado). Resultado gravado: o id do master, ou 0 quando consultado e sem master
 * (homônimo sem ano, sem casamento seguro) — 0 não é consultado de novo até a identidade mudar
 * (editar artista/álbum/ano devolve o item a NULL). Poucos por rodada: a API do Discogs é lenta.
 */
type Row = { id: string; artist: string | null; album: string | null; year: number | null };

async function fillTable(
  table: "lookout_items" | "collection_items",
  max: number,
): Promise<number> {
  const { data, error } = await db
    .from(table)
    .select("id, artist, album, year")
    .is("master_id", null)
    .limit(max * 4);
  if (error) throw error;
  let done = 0;
  for (const row of (data ?? []) as Row[]) {
    if (done >= max) break;
    const artist = (row.artist ?? "").trim();
    const album = (row.album ?? "").trim();
    // Sem artista+álbum não há o que consultar: marca como consultado para sair da fila.
    let masterId = 0;
    if (artist && album) {
      try {
        masterId = (await lookupMaster(artist, album, row.year))?.masterId ?? 0;
      } catch (e) {
        console.error(`[masters] falha ao consultar ${artist} - ${album}`, e);
        continue; // erro transitório: tenta de novo na próxima rodada
      }
    }
    const { error: upErr } = await db.from(table).update({ master_id: masterId }).eq("id", row.id);
    if (upErr) throw upErr;
    done += 1;
  }
  return done;
}

const MASTERS_VERSION_KEY = "masters_version";
const MASTERS_VERSION = 2;

/**
 * v0.182.1: a 1ª versão da busca (v0.182.0) aceitava o master de OUTRO ano para álbum homônimo
 * (Caetano Veloso 1968 recebia o master do 1986 e virava "o mesmo disco"). Uma vez, devolve a NULL
 * os masters já gravados (>0) para o passo refazê-los com a regra nova; 0 ("sem master") fica.
 */
async function resetStaleMasters(): Promise<void> {
  const { data } = await db
    .from("app_state")
    .select("value")
    .eq("key", MASTERS_VERSION_KEY)
    .maybeSingle();
  if (Number((data as { value?: unknown } | null)?.value) >= MASTERS_VERSION) return;
  for (const table of ["lookout_items", "collection_items"] as const) {
    const { error } = await db.from(table).update({ master_id: null }).gt("master_id", 0);
    if (error) throw error;
  }
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: MASTERS_VERSION_KEY, value: MASTERS_VERSION, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

export async function fillMissingMasters(
  max = 10,
): Promise<{ lookout: number; collection: number; skipped: boolean }> {
  if (!discogsConfigured()) return { lookout: 0, collection: 0, skipped: true };
  await resetStaleMasters();
  const lookout = await fillTable("lookout_items", max);
  const collection = await fillTable("collection_items", max);
  return { lookout, collection, skipped: false };
}

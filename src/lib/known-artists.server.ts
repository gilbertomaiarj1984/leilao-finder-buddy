import { KNOWN_ARTISTS_SEED } from "./known-artists-seed";
import { buildKnownArtistIndex, matchKnownArtist, type KnownArtistIndex } from "./vinyl-parse";

const TTL_MS = 60 * 60 * 1000; // a base muda pouco: recarrega no máximo 1x/hora
const PAGE = 1000;

let cache: { at: number; index: KnownArtistIndex } | null = null;

// Nomes adicionais cadastrados na tabela known_artists (best-effort; a base
// principal vem do bundle versionado no código, então funciona sem o banco).
async function loadDbNames(): Promise<string[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const names: string[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("known_artists")
        .select("name")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = data ?? [];
      for (const row of batch) names.push(row.name);
      if (batch.length < PAGE) break;
    }
    return names;
  } catch (error) {
    console.error("[known-artists] falha ao ler nomes do banco (usando só o bundle)", error);
    return [];
  }
}

/** Índice de nomes conhecidos: bundle do código + tabela do Supabase, cacheado. */
export async function getKnownArtistIndex(): Promise<KnownArtistIndex> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;
  const index = buildKnownArtistIndex([...KNOWN_ARTISTS_SEED, ...(await loadDbNames())]);
  cache = { at: Date.now(), index };
  return index;
}

/**
 * Reforço: para lotes que a heurística deixou sem artista, tenta casar um nome
 * conhecido dentro do título. Muta os lotes recebidos.
 */
export async function fillMissingArtists(lots: { title: string; artist: string }[]): Promise<void> {
  if (!lots.some((lot) => !lot.artist)) return;
  const index = await getKnownArtistIndex();
  if (!index.byNorm.size) return;
  for (const lot of lots) {
    if (lot.artist) continue;
    const hit = matchKnownArtist(lot.title, index);
    if (hit) lot.artist = hit;
  }
}

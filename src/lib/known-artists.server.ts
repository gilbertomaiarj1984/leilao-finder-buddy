import { KNOWN_ARTISTS_SEED } from "./known-artists-seed";
import { buildKnownArtistIndex, matchKnownArtist, type KnownArtistIndex } from "./vinyl-parse";

const TTL_MS = 60 * 60 * 1000; // a base muda pouco: recarrega no máximo 1x/hora

let cache: { at: number; index: KnownArtistIndex } | null = null;

// Nomes adicionais cadastrados na tabela known_artists (best-effort; a base
// principal vem do bundle versionado no código, então funciona sem o banco).
async function loadDbNames(): Promise<string[]> {
  try {
    const { db } = await import("@/lib/db-client.server");
    const { data, error } = await db.from<{ name: string }>("known_artists").select("name");
    if (error) throw error;
    return (data ?? []).map((row) => row.name);
  } catch (error) {
    console.error("[known-artists] falha ao ler nomes do banco (usando só o bundle)", error);
    return [];
  }
}

/** Índice de nomes conhecidos: bundle do código + tabela `known_artists`, cacheado. */
async function getKnownArtistIndex(): Promise<KnownArtistIndex> {
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

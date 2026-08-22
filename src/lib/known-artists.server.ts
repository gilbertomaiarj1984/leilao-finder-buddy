import { buildKnownArtistIndex, matchKnownArtist, type KnownArtistIndex } from "./vinyl-parse";

const TTL_MS = 60 * 60 * 1000; // a base muda pouco: recarrega no máximo 1x/hora
const PAGE = 1000;

let cache: { at: number; index: KnownArtistIndex } | null = null;

async function loadNames(): Promise<string[]> {
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
}

/** Índice de nomes conhecidos, carregado do Supabase e cacheado em memória. */
export async function getKnownArtistIndex(): Promise<KnownArtistIndex> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;
  try {
    const index = buildKnownArtistIndex(await loadNames());
    cache = { at: Date.now(), index };
    return index;
  } catch (error) {
    console.error("[known-artists] falha ao carregar a base de nomes", error);
    return cache?.index ?? buildKnownArtistIndex([]);
  }
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

/**
 * Ranking de reproduções por artista no ListenBrainz (grátis; exige `LISTENBRAINZ_TOKEN`).
 * O artista é achado pelo nome no MusicBrainz; o ranking sai de
 * `GET /1/popularity/top-recordings-for-artist/{mbid}`. Best-effort: qualquer falha vira `null`
 * e a fama cai para a IA. Cache em memória (o dado muda devagar).
 */
import { buildRanking, type ArtistRanking } from "./track-popularity";

const UA = "LeilaoFinderBuddy/1.0 (https://github.com/gilbertomaiarj1984/leilao-finder-buddy)";
const OK_TTL_MS = 7 * 24 * 3600_000;
const FAIL_TTL_MS = 3600_000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<ArtistRanking | null> }>();

function listenbrainzConfigured(): boolean {
  return Boolean(process.env["LISTENBRAINZ_TOKEN"]?.trim());
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadRanking(artist: string): Promise<ArtistRanking | null> {
  const token = process.env["LISTENBRAINZ_TOKEN"]!.trim();
  const q = encodeURIComponent(`artist:"${artist.replace(/"/g, " ")}"`);
  const found = (await fetchJson(
    `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=1`,
    {},
  )) as {
    artists?: { id?: string; score?: number }[];
  };
  const top = found.artists?.[0];
  if (!top?.id || (top.score ?? 0) < 90) return null;
  const recs = (await fetchJson(
    `https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${top.id}`,
    { Authorization: `Token ${token}` },
  )) as { recording_name?: string; total_listen_count?: number }[];
  if (!Array.isArray(recs)) return null;
  return buildRanking(
    recs.map((r) => ({ name: r.recording_name ?? "", listens: r.total_listen_count ?? 0 })),
  );
}

/** Ranking de músicas do artista, ou `null` (sem token, artista não achado, dado fraco, erro). */
export async function getArtistRanking(artist: string): Promise<ArtistRanking | null> {
  if (!listenbrainzConfigured() || !artist.trim()) return null;
  const key = artist.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = loadRanking(artist).catch((error) => {
    console.error(`[listenbrainz] ranking falhou para "${artist}"`, error);
    cache.set(key, { at: Date.now(), ttl: FAIL_TTL_MS, value: Promise.resolve(null) });
    return null;
  });
  cache.set(key, { at: Date.now(), ttl: OK_TTL_MS, value });
  return value;
}

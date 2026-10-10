/**
 * Tracklist (`lot_ai.tracklist`) em DUAS etapas independentes:
 *  1. `runTracklistBackfill` (`step=tracklist`) — **Discogs**: traz TODAS as faixas e a ordem
 *     (`/releases/{id}`), com `fame: null`. Não usa IA (a IA errava faixas e ordem).
 *  2. `runFameBackfill` (`step=fame`) — **IA**: só classifica a fama (alta/media/baixa) das
 *     faixas que ainda estão sem fama; roda conforme a IA é acionada, sem bloquear a etapa 1.
 *
 * Retroativo da etapa 1: lotes de HOJE em diante (`day_key >=` hoje em São Paulo) com álbum
 * identificado em `lot_ai` e `tracklist` NULL. Álbuns repetidos na rodada são consultados uma
 * vez; o `release_id` já casado em `lot_market` evita nova busca. Quando o Discogs não acha o
 * disco, grava `[]` ("já tentei"). Só atualiza linhas existentes de `lot_ai`.
 */
import { db } from "./db-client.server";
import { runText } from "./ai-provider.server";
import { getAiProvider } from "./app-state.server";
import { resolveGeminiModel, SYNC_CONCURRENCY } from "./ai-eval.server";
import { discogsConfigured, fetchDiscogsTracklist } from "./discogs.server";
import { getAllLotMarket } from "./lot-market.server";
import type { AiProvider } from "./ai-provider.server";
import {
  applyFame,
  buildFamePrompt,
  needsFame,
  normalizeTracklist,
  parseFameText,
  withoutFame,
  type Track,
} from "./tracklist";

const FAME_SYSTEM =
  "Você conhece discografias de música (principalmente brasileira) e fala sobre discos de " +
  "vinil. Responda SOMENTE com um objeto JSON, sem nenhum texto fora do JSON.";

/**
 * Pede à IA só a fama de cada faixa (a lista em si é dado do Discogs). Devolve `null` se a IA
 * falhou ou a resposta veio ilegível — as faixas ficam sem fama e são tentadas de novo.
 */
export async function rateFame(
  album: string,
  tracks: Track[],
  provider: AiProvider,
  geminiModel: Awaited<ReturnType<typeof resolveGeminiModel>>,
): Promise<Track[] | null> {
  try {
    const r = await runText(
      {
        system: FAME_SYSTEM,
        maxTokens: 400,
        text: buildFamePrompt(album, tracks),
        image: null,
        json: true,
      },
      provider,
      geminiModel,
    );
    const fames = parseFameText(r.text, tracks.length);
    return fames.some(Boolean) ? applyFame(tracks, fames) : null;
  } catch (error) {
    console.error(`[tracklist] fama falhou em "${album}"`, error);
    return null;
  }
}

function todayKeySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const MIGRATION_KEY = "tracklist_discogs_migrated";

/**
 * Migração única (v0.124.0): as tracklists gravadas antes vieram da IA (faixas/ordem erradas).
 * Zera `lot_ai.tracklist` e `collection_items.tracklist` uma vez, para o retroativo / botão
 * "Identificar faixas" refazê-las a partir do Discogs. Marcada em `app_state` só se zerar sem erro.
 */
async function migrateAiTracklists(): Promise<void> {
  const { data } = await db
    .from("app_state")
    .select("value")
    .eq("key", MIGRATION_KEY)
    .maybeSingle();
  if (data?.value) return;
  const a = await db.from("lot_ai").update({ tracklist: null }).not("tracklist", "is", null);
  const b = await db
    .from("collection_items")
    .update({ tracklist: null })
    .not("tracklist", "is", null);
  if (a.error || b.error) {
    console.error("[tracklist] migração falhou", a.error ?? b.error);
    return;
  }
  await db
    .from("app_state")
    .upsert(
      { key: MIGRATION_KEY, value: true, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/** Faixas do Discogs (sem fama). `null` quando o Discogs não achou o disco. */
export async function buildTracklist(
  album: string,
  releaseId: number | null,
): Promise<Track[] | null> {
  const raw = await fetchDiscogsTracklist(album, releaseId);
  return raw ? withoutFame(raw) : null;
}

export async function runTracklistBackfill(max = 20): Promise<{
  updated: number;
  failed: number;
  remaining: number;
  done: boolean;
}> {
  if (!discogsConfigured()) return { updated: 0, failed: 0, remaining: 0, done: true };
  await migrateAiTracklists();
  const today = todayKeySaoPaulo();
  const { data: lotRows, error: lotErr } = await db
    .from<{ id: string }>("lots")
    .select("id")
    .gte("day_key", today);
  if (lotErr) throw lotErr;
  const upcoming = new Set((lotRows ?? []).map((r) => r.id));

  const { data: aiRows, error: aiErr } = await db
    .from<{ id: string; album: string | null }>("lot_ai")
    .select("id, album")
    .is("tracklist", null);
  if (aiErr) throw aiErr;
  const pending = (aiRows ?? []).filter((r) => upcoming.has(r.id) && r.album?.trim());

  const batch = pending.slice(0, Math.min(Math.max(max, 1), 40));
  if (!batch.length) return { updated: 0, failed: 0, remaining: 0, done: true };

  // release_id já casado pelo step=market (poupa a busca no Discogs), por lote.
  const releaseByLot = new Map<string, number>();
  for (const m of await getAllLotMarket()) {
    if (m.matched && m.release_id) releaseByLot.set(m.id, m.release_id);
  }

  const byAlbum = new Map<string, Track[] | null>();
  const releaseOf = new Map<string, number | null>();
  for (const r of batch) {
    const key = r.album!.trim();
    if (!releaseOf.get(key)) releaseOf.set(key, releaseByLot.get(r.id) ?? null);
  }
  const albums = [...releaseOf.keys()];
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const album = albums[cursor++];
      if (!album) return;
      try {
        byAlbum.set(album, await buildTracklist(album, releaseOf.get(album) ?? null));
      } catch (error) {
        failed += 1;
        console.error(`[tracklist] falha em "${album}"`, error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, albums.length) }, () => worker()),
  );

  let updated = 0;
  for (const row of batch) {
    const key = row.album!.trim();
    if (!byAlbum.has(key)) continue; // falha de rede/IA: tenta de novo na próxima rodada
    const { error } = await db
      .from("lot_ai")
      .update({ tracklist: byAlbum.get(key) ?? [] })
      .eq("id", row.id);
    if (error) console.error(`[tracklist] falha ao gravar ${row.id}`, error);
    else updated += 1;
  }
  const { invalidateLotAiCache } = await import("./lot-ai.server");
  invalidateLotAiCache();
  const remaining = Math.max(pending.length - updated, 0);
  return { updated, failed, remaining, done: remaining === 0 || updated === 0 };
}

/**
 * Fama pela IA: lotes de hoje em diante cuja tracklist (do Discogs) ainda tem faixa sem fama.
 * Uma consulta por álbum (dedup). Falha/resposta ilegível deixa a fama vazia para a próxima rodada.
 */
export async function runFameBackfill(max = 20): Promise<{
  updated: number;
  failed: number;
  remaining: number;
  done: boolean;
}> {
  const today = todayKeySaoPaulo();
  const { data: lotRows, error: lotErr } = await db
    .from<{ id: string }>("lots")
    .select("id")
    .gte("day_key", today);
  if (lotErr) throw lotErr;
  const upcoming = new Set((lotRows ?? []).map((r) => r.id));

  const { data: aiRows, error: aiErr } = await db
    .from<{ id: string; album: string | null; tracklist: unknown }>("lot_ai")
    .select("id, album, tracklist")
    .not("tracklist", "is", null);
  if (aiErr) throw aiErr;
  const pending = (aiRows ?? [])
    .map((r) => ({
      id: r.id,
      album: r.album?.trim() ?? "",
      tracks: normalizeTracklist(r.tracklist),
    }))
    .filter((r) => upcoming.has(r.id) && r.album && needsFame(r.tracks));

  const batch = pending.slice(0, Math.min(Math.max(max, 1), 40));
  if (!batch.length) return { updated: 0, failed: 0, remaining: 0, done: true };

  const provider = await getAiProvider();
  const geminiModel = await resolveGeminiModel();
  const byAlbum = new Map<string, Track[] | null>();
  const albums = [...new Set(batch.map((r) => r.album))];
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const album = albums[cursor++];
      if (!album) return;
      const tracks = batch.find((r) => r.album === album)!.tracks!;
      const rated = await rateFame(album, tracks, provider, geminiModel);
      if (rated) byAlbum.set(album, rated);
      else failed += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, albums.length) }, () => worker()),
  );

  let updated = 0;
  for (const row of batch) {
    const rated = byAlbum.get(row.album);
    if (!rated) continue;
    // Álbuns iguais podem ter listas diferentes (releases distintos): só reaproveita se baterem.
    if (rated.length !== row.tracks!.length) continue;
    const { error } = await db.from("lot_ai").update({ tracklist: rated }).eq("id", row.id);
    if (error) console.error(`[tracklist] falha ao gravar fama ${row.id}`, error);
    else updated += 1;
  }
  const { invalidateLotAiCache } = await import("./lot-ai.server");
  invalidateLotAiCache();
  const remaining = Math.max(pending.length - updated, 0);
  return { updated, failed, remaining, done: remaining === 0 || updated === 0 };
}

/**
 * Refresh manual de UM lote: re-busca as faixas no Discogs (ignora o que já está gravado) e só
 * depois pede a fama à IA. Fama já conhecida de uma faixa de mesmo título é preservada; sem IA
 * (ou se ela falhar) as faixas novas ficam com a fama anterior ou sem fama.
 */
export async function refreshLotTracklist(
  lotId: string,
  provider: AiProvider,
  useAi: boolean,
): Promise<{ tracklist: Track[]; rated: boolean }> {
  if (!discogsConfigured()) {
    throw new Error("O Discogs não está configurado (DISCOGS_TOKEN ausente no servidor).");
  }
  const { data: row, error } = await db
    .from<{ id: string; album: string | null; tracklist: unknown }>("lot_ai")
    .select("id, album, tracklist")
    .eq("id", lotId)
    .maybeSingle();
  if (error) throw error;
  const album = row?.album?.trim();
  if (!row || !album) throw new Error("Este lote ainda não tem álbum identificado pela IA.");

  const { data: mk } = await db
    .from<{ release_id: number | null; matched: boolean }>("lot_market")
    .select("release_id, matched")
    .eq("id", lotId)
    .maybeSingle();
  const fresh = await buildTracklist(album, mk?.matched ? (mk.release_id ?? null) : null);
  if (!fresh) throw new Error(`O Discogs não encontrou as faixas de "${album}".`);

  // Preserva a fama já conhecida (por título) para a lista nova.
  const known = new Map(
    (normalizeTracklist(row.tracklist) ?? [])
      .filter((t) => t.fame)
      .map((t) => [t.title.toLowerCase(), t.fame] as const),
  );
  let tracklist = fresh.map((t) => ({ ...t, fame: known.get(t.title.toLowerCase()) ?? null }));
  let rated = false;
  if (useAi) {
    const r = await rateFame(album, fresh, provider, await resolveGeminiModel());
    if (r) {
      tracklist = r;
      rated = true;
    }
  }
  const { error: upErr } = await db.from("lot_ai").update({ tracklist }).eq("id", lotId);
  if (upErr) throw new Error(`Não foi possível gravar a tracklist: ${upErr.message}`);
  const { invalidateLotAiCache } = await import("./lot-ai.server");
  invalidateLotAiCache();
  return { tracklist, rated };
}

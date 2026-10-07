/**
 * Retroativo da tracklist (`lot_ai.tracklist`): para lotes de HOJE em diante (`day_key >=`
 * hoje em São Paulo) que já têm avaliação com álbum identificado mas ainda sem tracklist, pede
 * à IA só as faixas (por NOME do álbum, sem imagem — barato) e grava. Álbuns repetidos na
 * rodada são consultados uma vez. Quando a IA não sabe, grava `[]` ("já tentei") para não
 * reconsultar a cada rodada. Só atualiza linhas existentes de `lot_ai`.
 */
import { db } from "./db-client.server";
import { runText } from "./ai-provider.server";
import { getAiProvider } from "./app-state.server";
import { resolveGeminiModel, SYNC_CONCURRENCY } from "./ai-eval.server";
import { buildTracklistPrompt, parseTracklistText, type Track } from "./tracklist";

export const TRACKLIST_SYSTEM =
  "Você conhece discografias de música (principalmente brasileira) e fala sobre discos de " +
  "vinil. Responda SOMENTE com um objeto JSON, sem nenhum texto fora do JSON.";

function todayKeySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function runTracklistBackfill(max = 20): Promise<{
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
    .from<{ id: string; album: string | null }>("lot_ai")
    .select("id, album")
    .is("tracklist", null);
  if (aiErr) throw aiErr;
  const pending = (aiRows ?? []).filter((r) => upcoming.has(r.id) && r.album?.trim());

  const batch = pending.slice(0, Math.min(Math.max(max, 1), 40));
  if (!batch.length) return { updated: 0, failed: 0, remaining: 0, done: true };

  const provider = await getAiProvider();
  const geminiModel = await resolveGeminiModel();
  const byAlbum = new Map<string, Track[] | null>();
  const albums = [...new Set(batch.map((r) => r.album!.trim()))];
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const album = albums[cursor++];
      if (!album) return;
      try {
        const r = await runText(
          {
            system: TRACKLIST_SYSTEM,
            maxTokens: 1000,
            text: buildTracklistPrompt(album),
            image: null,
            json: true,
          },
          provider,
          geminiModel,
        );
        byAlbum.set(album, parseTracklistText(r.text));
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

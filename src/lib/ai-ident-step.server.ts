/**
 * Identificação SIMPLIFICADA (camada `lot_ident`): roda para TODOS os lotes, SEM gate de
 * modo. Idempotente por chamada (estado próprio `ai_ident_batch`). Provedor = padrão em
 * `app_state`: Claude via Batches, Gemini síncrono em bloco (failover por quota). Sem
 * NENHUM provedor configurado → no-op. 1ª passada só por título; escala para a capa nos de
 * baixa confiança. Alimenta exibição/busca/filtro por artista e o Discogs.
 *
 * Extraído de `cron.server.ts` (`step=aiident`) para ser reaproveitado também pelo botão
 * manual "Atualizar tudo" (`leiloesbr.functions.ts`, `runAiident`) — mesmo comportamento dos
 * dois lados: uma chamada só SUBMETE um lote (Claude batch) ou GRAVA na hora (Gemini
 * síncrono), nunca espera o batch terminar. O chamador decide o que fazer com o retorno.
 */
const GEMINI_SYNC_CAP = 25;

export async function runAiIdentStep(maxParam?: number) {
  const {
    aiConfigured,
    selectLotsToIdentify,
    selectLotsToReident,
    submitIdentBatch,
    collectIdentBatch,
    identLotsSyncRows,
  } = await import("./ai-eval.server");
  if (!aiConfigured()) return { skipped: "nenhum provedor de IA configurado" as const };
  const { getPendingAiIdentBatch, setPendingAiIdentBatch, getAiProvider } =
    await import("./app-state.server");
  const { providerSupportsBatch, providerConfigured, isQuotaError } =
    await import("./ai-provider.server");
  const { getAllLotIdent, upsertLotIdent } = await import("./lot-ident.server");

  // 1) Batch (Claude) de identificação em andamento? Coleta — independe do provedor atual.
  const pending = await getPendingAiIdentBatch();
  if (pending) {
    const { done, rows } = await collectIdentBatch(pending.batchId, pending.hashes, pending.source);
    if (!done) return { pending: true as const, batchId: pending.batchId };
    const collected = await upsertLotIdent(rows);
    await setPendingAiIdentBatch(null);
    return { collected, batchId: pending.batchId, source: pending.source };
  }

  // Provedor efetivo (padrão, ou o primeiro configurado se o padrão não tiver chave).
  const preferred = await getAiProvider();
  const provider = providerConfigured(preferred)
    ? preferred
    : providerConfigured("anthropic")
      ? "anthropic"
      : "gemini";
  const useBatch = providerSupportsBatch(provider);

  const { scrapeVinylLots } = await import("./leiloesbr-scrape.server");
  const [snapshot, identRows] = await Promise.all([scrapeVinylLots(false), getAllLotIdent()]);
  const max = Math.min(Math.max(Number(maxParam) || 800, 1), 2000);

  // Caminho SÍNCRONO (Gemini/failover): grava direto até o teto por rodada.
  const runSync = async (
    lots: Parameters<typeof identLotsSyncRows>[0],
    withImage: boolean,
    source: string,
  ) => {
    const toSync = lots.slice(0, GEMINI_SYNC_CAP);
    const { rows, served, switched } = await identLotsSyncRows(toSync, withImage, "gemini");
    const collected = await upsertLotIdent(rows);
    return {
      collected,
      source,
      provider: served ?? "gemini",
      switched,
      sync: true as const,
      done: lots.length <= GEMINI_SYNC_CAP,
    };
  };

  // 2) Identifica por TÍTULO os ainda não identificados (ou com título mudado).
  const toIdent = selectLotsToIdentify(snapshot.lots, identRows, max);
  if (toIdent.length) {
    if (useBatch) {
      try {
        const { batchId, hashes, count } = await submitIdentBatch(toIdent, false);
        await setPendingAiIdentBatch({
          batchId,
          submittedAt: new Date().toISOString(),
          hashes,
          source: "title",
        });
        return { submitted: count, batchId, source: "title" as const, provider };
      } catch (error) {
        if (!isQuotaError(error) || !providerConfigured("gemini")) throw error;
        console.error("[aiident] Claude sem créditos — failover Gemini (título)", error);
      }
    }
    return await runSync(toIdent, false, "title");
  }

  // 3) Nada por título: reidentifica com a CAPA os de baixa confiança.
  const toReident = selectLotsToReident(snapshot.lots, identRows, max);
  if (toReident.length) {
    if (useBatch) {
      try {
        const { batchId, hashes, count } = await submitIdentBatch(toReident, true);
        await setPendingAiIdentBatch({
          batchId,
          submittedAt: new Date().toISOString(),
          hashes,
          source: "image",
        });
        return { submitted: count, batchId, source: "image" as const, provider };
      } catch (error) {
        if (!isQuotaError(error) || !providerConfigured("gemini")) throw error;
        console.error("[aiident] Claude sem créditos — failover Gemini (capa)", error);
      }
    }
    return await runSync(toReident, true, "image");
  }

  return { done: true as const, submitted: 0, provider };
}

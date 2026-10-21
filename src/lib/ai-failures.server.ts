import { db } from "@/lib/db-client.server";

import {
  clearFailures,
  normalizeFailureMap,
  pruneFailures,
  recordFailures,
  skippableIds,
  type FailureMap,
} from "./ai-failures";

/** Qual passada de IA o registro cobre (cada uma tem a sua chave em `app_state`). */
type FailureKind = "eval" | "ident";
const KEYS: Record<FailureKind, string> = { eval: "ai_eval_failures", ident: "ai_ident_failures" };

async function read(kind: FailureKind): Promise<FailureMap> {
  const { data, error } = await db
    .from("app_state")
    .select("value")
    .eq("key", KEYS[kind])
    .maybeSingle();
  if (error) throw error;
  return normalizeFailureMap(data?.value);
}

async function write(kind: FailureKind, map: FailureMap): Promise<void> {
  const { error } = await db
    .from("app_state")
    .upsert(
      { key: KEYS[kind], value: map, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

/**
 * Registra o resultado de uma rodada: os que falharam ganham uma falha, os que deram certo saem do
 * registro. Best-effort: um erro aqui só impede de pular o lote, nunca derruba o cron.
 */
export async function noteAiResults(
  kind: FailureKind,
  result: { failed: { id: string; hash: string }[]; succeededIds: string[] },
): Promise<void> {
  if (!result.failed.length && !result.succeededIds.length) return;
  try {
    const now = Date.now();
    let map = await read(kind);
    map = recordFailures(map, result.failed, now);
    map = clearFailures(map, result.succeededIds);
    await write(kind, pruneFailures(map, now));
  } catch (error) {
    console.error(`[ai-failures] não foi possível registrar as falhas (${kind})`, error);
  }
}

/** Ids que a rodada automática deve pular, dado o hash atual de cada lote. Vazio se a leitura falhar. */
export async function loadSkippableIds(
  kind: FailureKind,
  hashOf: (id: string) => string | null,
): Promise<Set<string>> {
  try {
    return skippableIds(await read(kind), hashOf, Date.now());
  } catch (error) {
    console.error(`[ai-failures] não foi possível ler as falhas (${kind})`, error);
    return new Set();
  }
}

/**
 * Controle de lotes que a IA não consegue processar (resposta ilegível, imagem morta, bloqueio de
 * segurança...). Sem isso o lote volta à fila a cada rodada, é pago de novo e, no modo síncrono,
 * os primeiros da fila que sempre falham seguram o resto. Puro: o armazenamento fica em
 * `ai-failures.server.ts` (`app_state`).
 */

export type FailureEntry = {
  /** Falhas seguidas com o mesmo `hash`. */
  n: number;
  /** Hash do título quando falhou: se o título muda, a contagem recomeça. */
  hash: string;
  /** Quando foi a última falha (ms). */
  at: number;
};
export type FailureMap = Record<string, FailureEntry>;

/** Depois de tantas falhas seguidas o lote sai da fila automática. */
export const MAX_ATTEMPTS = 2;
/** Passado esse tempo o lote ganha outra chance (o problema pode ter sido do provedor). */
export const RETRY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** Entradas mais velhas que isso são descartadas (o lote já saiu da janela). */
const FORGET_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Soma uma falha por lote; troca de `hash` zera a contagem. */
export function recordFailures(
  map: FailureMap,
  failed: readonly { id: string; hash: string }[],
  now: number,
): FailureMap {
  const next: FailureMap = { ...map };
  for (const f of failed) {
    const prev = next[f.id];
    next[f.id] = { n: prev && prev.hash === f.hash ? prev.n + 1 : 1, hash: f.hash, at: now };
  }
  return next;
}

/** Tira os lotes que deram certo. */
export function clearFailures(map: FailureMap, ids: readonly string[]): FailureMap {
  if (!ids.some((id) => id in map)) return map;
  const next: FailureMap = { ...map };
  for (const id of ids) delete next[id];
  return next;
}

/** Lotes que a rodada automática deve pular: falharam `MAX_ATTEMPTS` vezes com o mesmo hash há pouco. */
export function skippableIds(
  map: FailureMap,
  hashOf: (id: string) => string | null,
  now: number,
): Set<string> {
  const out = new Set<string>();
  for (const [id, e] of Object.entries(map)) {
    if (e.n >= MAX_ATTEMPTS && now - e.at < RETRY_AFTER_MS && hashOf(id) === e.hash) out.add(id);
  }
  return out;
}

/** Descarta entradas antigas para o registro não crescer para sempre. */
export function pruneFailures(map: FailureMap, now: number): FailureMap {
  const next: FailureMap = {};
  for (const [id, e] of Object.entries(map)) if (now - e.at < FORGET_AFTER_MS) next[id] = e;
  return next;
}

/** Lê o valor cru de `app_state` tolerando lixo. */
export function normalizeFailureMap(value: unknown): FailureMap {
  const out: FailureMap = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const e = raw as Partial<FailureEntry> | null;
    if (
      e &&
      typeof e.n === "number" &&
      Number.isFinite(e.n) &&
      typeof e.hash === "string" &&
      typeof e.at === "number" &&
      Number.isFinite(e.at)
    )
      out[id] = { n: e.n, hash: e.hash, at: e.at };
  }
  return out;
}

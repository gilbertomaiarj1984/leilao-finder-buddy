/**
 * Escrita ATÔMICA em `app_state`. Cada chave guarda um JSON inteiro; o padrão antigo (ler com um
 * leitor tolerante que devolve vazio em erro → alterar → regravar tudo) perdia dados de duas formas:
 * um erro de leitura virava "lista vazia + item novo" gravada por cima de tudo, e duas escritas
 * simultâneas (dois aparelhos, cron + usuário) deixavam só a última. Aqui a leitura e a gravação
 * acontecem numa transação com a linha travada (`FOR UPDATE`): escritores se enfileiram e um erro de
 * leitura aborta sem gravar nada.
 */
import { getSql } from "./db.server";

type Tx = {
  (strings: TemplateStringsArray, ...values: unknown[]): PromiseLike<Record<string, unknown>[]>;
  json: (value: unknown) => unknown;
};

/** Parte do `postgres.js` que a mutação usa (permite testar com um falso). */
export type SqlLike = { begin: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> };

/**
 * `parse` normaliza o JSON cru da chave (e aplica TTL, se houver); `change` devolve o novo valor.
 * Erros de leitura/gravação PROPAGAM — quem chama decide se engole (best-effort) ou mostra.
 */
export async function mutateJsonState<T>(
  sql: SqlLike,
  key: string,
  parse: (raw: unknown) => T,
  change: (current: T) => T,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`insert into app_state (key) values (${key}) on conflict (key) do nothing`;
    const rows = await tx`select value from app_state where key = ${key} for update`;
    const next = change(parse(rows[0]?.["value"]));
    await tx`update app_state set value = ${tx.json(next)}, updated_at = now() where key = ${key}`;
    return next;
  });
}

/** Atalho para o banco real. */
export function mutateAppState<T>(
  key: string,
  parse: (raw: unknown) => T,
  change: (current: T) => T,
): Promise<T> {
  return mutateJsonState(getSql() as unknown as SqlLike, key, parse, change);
}

// ------------------------------------------------------------- normalizadores puros ---

export function parseStringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** União sem duplicatas, preservando a ordem (atual primeiro). */
export function unionStrings(current: readonly string[], extra: readonly string[]): string[] {
  return [...new Set([...current, ...extra])];
}

export function parseStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/** Objeto cru (sem validar os valores) — base para mapas com formato próprio. */
export function parseObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

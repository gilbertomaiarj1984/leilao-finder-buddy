// Partes das tabelas por lote pedidas pela home (v0.155.0) — client-safe (usado na validação das
// server functions e no `queries.ts`). O recorte em si fica em `lot-scope.server.ts`.

/** `core`: lotes que a home mostra ao abrir; `rest`: todo o resto. Sem parte = tabela inteira. */
export type LotScope = "core" | "rest";

/** Normaliza a entrada das server functions: só `core`/`rest` valem; o resto = tabela inteira. */
export function parseLotScope(input: { scope?: unknown } | undefined): LotScope | undefined {
  return input?.scope === "core" || input?.scope === "rest" ? input.scope : undefined;
}

// Recorte das tabelas por lote (`lot_ai`, `lot_ident`, `lot_market`, `lot_condition`) para a home
// (v0.155.0): a parte `core` são os lotes que a home mostra ao abrir (de `CORE_PAST_DAYS` dias
// atrás — retenção dos lances no acumulador, `watched-accum.ts` — até o fim da janela padrão,
// `WINDOW_DAYS`); `rest` é todo o resto (histórico mais antigo, dias futuros além da janela). As
// duas juntas = a tabela inteira (toda linha tem FK para `lots`). O servidor continua lendo a
// tabela inteira (com o cache curto de cada módulo) e só filtra aqui — o ganho é no tamanho da
// resposta que o navegador baixa e processa primeiro. Ver `useScopedLotRows` (`queries.ts`) e
// `lot-scope.ts` (tipo `LotScope`, aqui repetido inline: `*.server.ts` não importa de client-safe).

const CORE_PAST_DAYS = 2;
const CORE_TTL_MS = 30_000;
let coreCache: { at: number; from: string; to: string; ids: Set<string> } | null = null;

async function coreLotIds(): Promise<Set<string>> {
  const { dayKeyAt, WINDOW_DAYS } = await import("./leiloesbr-scrape.server");
  const from = dayKeyAt(-CORE_PAST_DAYS);
  const to = dayKeyAt(WINDOW_DAYS - 1);
  if (
    coreCache &&
    coreCache.from === from &&
    coreCache.to === to &&
    Date.now() - coreCache.at < CORE_TTL_MS
  )
    return coreCache.ids;
  const { db } = await import("@/lib/db-client.server");
  const { data, error } = await db
    .from<{ id: string }>("lots")
    .select("id")
    .gte("day_key", from)
    .lte("day_key", to);
  if (error) throw error;
  const ids = new Set((data ?? []).map((r) => r.id));
  coreCache = { at: Date.now(), from, to, ids };
  return ids;
}

/** Filtra as linhas pela parte pedida; sem `scope`, devolve todas (outras telas, cron). */
export async function filterByLotScope<T extends { id: string }>(
  rows: T[],
  scope: "core" | "rest" | undefined,
): Promise<T[]> {
  if (!scope) return rows;
  let ids: Set<string>;
  try {
    ids = await coreLotIds();
  } catch (error) {
    // Sem o recorte, a parte `core` leva tudo e a `rest` vem vazia — nada some da tela.
    console.error("[lot-scope] não foi possível ler os lotes da janela", error);
    return scope === "core" ? rows : [];
  }
  const wantCore = scope === "core";
  return rows.filter((r) => ids.has(r.id) === wantCore);
}

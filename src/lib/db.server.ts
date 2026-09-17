// Conexão Postgres direta (Fase 1 da migração para VPS — ver
// docs/economia-fase-2-vps-unico.md). Singleton lazy, mesmo padrão de Proxy
// usado em src/integrations/supabase/client.server.ts. Só é instanciada
// quando DATABASE_URL está definida (client.server.ts decide qual camada usar).
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

// OIDs de date/timestamp/timestamptz. O postgres.js por padrão converte essas
// colunas em objetos Date do JS; o PostgREST (Supabase) sempre devolvia string
// ISO 8601 crua no JSON. O código de negócio assume string (ex.: compras.tsx
// chama .localeCompare() no dia) — interceptamos o parse para manter a string,
// replicando o formato que o PostgREST sempre entregou.
const DATE_LIKE_OIDS = [1082, 1114, 1184];

// OID de numeric/decimal. O postgres.js por padrão devolve como string (evita
// perda de precisão); o PostgREST sempre devolveu número JSON. Código como
// analytics.ts filtra com `typeof v === "number"` — em string, os valores
// silenciosamente somem das médias em vez de dar erro. Preços deste app cabem
// em Number sem problema de precisão prática.
const NUMERIC_OID = 1700;

function createSql(): Sql {
  const DATABASE_URL = process.env["DATABASE_URL"];
  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }
  return postgres(DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
    types: {
      date: {
        to: 1082,
        from: DATE_LIKE_OIDS,
        serialize: (x: unknown) => x,
        parse: (x: string) => x,
      },
      numeric: {
        to: NUMERIC_OID,
        from: [NUMERIC_OID],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => Number(x),
      },
    },
    onnotice: () => {
      // silencia NOTICE do Postgres (ex. "there is no unique or exclusion constraint"
      // em savepoints) — o app não usa transações nomeadas
    },
  });
}

let _sql: Sql | undefined;

export function getSql(): Sql {
  if (!_sql) _sql = createSql();
  return _sql;
}

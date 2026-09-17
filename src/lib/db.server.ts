// Conexão Postgres direta (Fase 1 da migração para VPS — ver
// docs/economia-fase-2-vps-unico.md). Singleton lazy, mesmo padrão de Proxy
// usado em src/integrations/supabase/client.server.ts. Só é instanciada
// quando DATABASE_URL está definida (client.server.ts decide qual camada usar).
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

function createSql(): Sql {
  const DATABASE_URL = process.env["DATABASE_URL"];
  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }
  return postgres(DATABASE_URL, {
    max: 5,
    idle_timeout: 30,
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

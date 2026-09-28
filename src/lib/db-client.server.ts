// Cliente de acesso a dados do app: builder encadeável sobre Postgres direto (postgres.js),
// com a mesma API `from(...).select/eq/upsert/...` usada desde a época do Supabase — ver
// `db-query.server.ts`. Requer DATABASE_URL.
// Em rota/`*.functions.ts` (que também vão pro bundle do cliente), carregar dentro do handler:
//   const { db } = await import("@/lib/db-client.server");
// Import no topo só em outros módulos `*.server.ts`.
import { createDbQueryClient } from "./db-query.server";

export const db = createDbQueryClient();

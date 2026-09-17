// Server-side Supabase client with service role key - bypasses RLS.
// Use this for admin operations in server functions and server routes only.
// For user-authenticated queries (with RLS), use the auth middleware instead.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { createSupabaseFetch } from "./api-fetch";
import { createDbQueryClient } from "@/lib/db-query.server";

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_SERVICE_ROLE_KEY),
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Fase 1 da migração para VPS (docs/economia-fase-2-vps-unico.md): com
// DATABASE_URL definida, `.from`/`.rpc` passam a falar direto com o Postgres via
// o shim `postgres.js` (src/lib/db-query.server.ts). `.storage` continua no
// Supabase até a Fase 3 — sem DATABASE_URL, cai de volta no cliente Supabase
// original. Nenhum import muda em lugar nenhum; reverter é apagar a env var.
function createDbBackedAdminClient() {
  const db = createDbQueryClient();
  let _storageClient: ReturnType<typeof createSupabaseAdminClient> | undefined;
  function storageClient() {
    if (!_storageClient) _storageClient = createSupabaseAdminClient();
    return _storageClient;
  }
  return {
    from: db.from,
    rpc: db.rpc,
    get storage() {
      return storageClient().storage;
    },
  };
}

type AdminClient =
  ReturnType<typeof createSupabaseAdminClient> | ReturnType<typeof createDbBackedAdminClient>;

let _supabaseAdmin: AdminClient | undefined;

function createAdminClient(): AdminClient {
  return process.env["DATABASE_URL"] ? createDbBackedAdminClient() : createSupabaseAdminClient();
}

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
// Top-level import is safe only in other .server.ts modules - route files and *.functions.ts ship to the client bundle.
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

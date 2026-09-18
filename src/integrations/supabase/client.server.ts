// Cliente de acesso a dados do app (nome histórico: era o cliente Supabase via
// PostgREST). Migração para VPS (docs/economia-fase-2-vps-unico.md): Postgres
// direto via postgres.js (Fase 1), Auth via Google OAuth (Fase 2) e Storage em
// disco (Fase 3) — nenhuma dessas camadas depende mais do Supabase. Nome do
// export mantido (`supabaseAdmin`) para não tocar nos 15 arquivos de lógica de
// negócio que já chamam `.from`/`.rpc`. Requer DATABASE_URL.
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
// Top-level import is safe only in other .server.ts modules - route files and *.functions.ts ship to the client bundle.
import { createDbQueryClient } from "@/lib/db-query.server";

export const supabaseAdmin = createDbQueryClient();

-- ---------------------------------------------------------------------
-- excluded_lots — lotes excluídos manualmente pelo usuário. `id` é a mesma PK
-- de `lots.id`: serve de lista negra (o cron nunca reinsere) e sobrevive ao
-- DELETE físico do lote em `lots` (documenta que ele foi apagado, mesma razão
-- de `lot_sales` nunca cascatear com `lots`). `keywords` alimenta a heurística
-- de "possível lixo" (ver src/lib/lot-exclusion.ts) — sem IA, por enquanto.
-- Aplicado automaticamente pelo `deploy.yml` a cada push (ver seção correspondente em
-- docs/notas-desenvolvimento.md); localmente, `psql -f supabase/setup.sql`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.excluded_lots (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  house        text NOT NULL DEFAULT '',
  artist       text NOT NULL DEFAULT '',
  reason       text,
  keywords     text[] NOT NULL DEFAULT '{}',
  excluded_by  text NOT NULL DEFAULT '',
  excluded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS excluded_lots_keywords_gin_idx
  ON public.excluded_lots USING GIN (keywords);

ALTER TABLE public.excluded_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.excluded_lots FROM anon, authenticated;
GRANT ALL ON public.excluded_lots TO service_role;

-- "De olho": palavras extras do usuário para o casamento (v0.118.0).
-- Aplicado automaticamente pelo deploy.yml (via setup.sql); localmente, `psql -f supabase/setup.sql`.
ALTER TABLE public.lookout_items ADD COLUMN IF NOT EXISTS terms jsonb NOT NULL DEFAULT '[]'::jsonb;

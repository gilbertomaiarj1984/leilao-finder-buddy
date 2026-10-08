-- "De olho": álbuns juntados a um item (mesmo disco com outro nome/edição) — v0.117.0.
-- Lista de snapshots [{lotId, artist, album, year, title, house, image, url, dayKey}].
-- Aplicado automaticamente pelo deploy.yml (via setup.sql); localmente, `psql -f supabase/setup.sql`.
ALTER TABLE public.lookout_items ADD COLUMN IF NOT EXISTS merged jsonb NOT NULL DEFAULT '[]'::jsonb;

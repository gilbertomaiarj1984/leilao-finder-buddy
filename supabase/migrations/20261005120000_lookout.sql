-- ---------------------------------------------------------------------
-- lookout_items — "Ficar de olho": discos que o usuário quer MUITO e quer reconhecer quando
-- reaparecerem em leilões futuros. Snapshot do lote de origem, sem FK para `lots` (o
-- `pruneOutOfWindow` apaga lotes antigos; o marcador não pode ir junto). Ver
-- src/lib/lookout.server.ts e src/lib/lookout-match.ts.
-- Aplicado automaticamente pelo `deploy.yml` a cada push (via setup.sql); localmente,
-- `psql -f supabase/setup.sql`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lookout_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id       text UNIQUE NOT NULL,
  artist       text NOT NULL DEFAULT '',
  album        text NOT NULL DEFAULT '',
  year         integer,
  title        text NOT NULL DEFAULT '',
  house        text NOT NULL DEFAULT '',
  image        text,
  url          text NOT NULL DEFAULT '',
  day_key      text NOT NULL DEFAULT '',
  max_price    numeric,
  note         text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lookout_items_status_idx ON public.lookout_items (status, created_at DESC);

DROP TRIGGER IF EXISTS update_lookout_items_updated_at ON public.lookout_items;
CREATE TRIGGER update_lookout_items_updated_at BEFORE UPDATE ON public.lookout_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lookout_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lookout_items FROM anon, authenticated;
GRANT ALL ON public.lookout_items TO service_role;

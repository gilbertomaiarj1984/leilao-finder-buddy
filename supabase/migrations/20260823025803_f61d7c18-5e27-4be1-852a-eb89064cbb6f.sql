CREATE TABLE public.lots (
  id text PRIMARY KEY,
  id_leilao text NOT NULL,
  id_peca text NOT NULL,
  base text NOT NULL,
  lote text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  image text,
  price text NOT NULL DEFAULT '',
  day_key text NOT NULL,
  start_time text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  house text NOT NULL DEFAULT '',
  house_url text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lots_day_key_idx ON public.lots (day_key);

GRANT SELECT ON public.lots TO authenticated;
GRANT ALL ON public.lots TO service_role;

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lots"
ON public.lots FOR SELECT TO authenticated USING (true);

CREATE TABLE public.known_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.known_artists TO authenticated;
GRANT ALL ON public.known_artists TO service_role;

ALTER TABLE public.known_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view known artists"
ON public.known_artists FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_lots_updated_at BEFORE UPDATE ON public.lots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_known_artists_updated_at BEFORE UPDATE ON public.known_artists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
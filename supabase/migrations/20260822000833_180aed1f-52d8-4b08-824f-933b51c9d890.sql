CREATE TABLE public.seen_auctions (
  id_leilao TEXT PRIMARY KEY,
  house TEXT NOT NULL,
  house_url TEXT,
  entry_url TEXT,
  day_key TEXT NOT NULL,
  start_time TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  lot_count INTEGER NOT NULL DEFAULT 0,
  sample_titles TEXT[] NOT NULL DEFAULT '{}',
  uf TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seen_auctions TO authenticated;
GRANT ALL ON public.seen_auctions TO service_role;
ALTER TABLE public.seen_auctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view seen auctions" ON public.seen_auctions FOR SELECT TO authenticated USING (true);
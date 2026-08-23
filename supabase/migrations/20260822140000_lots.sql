-- Persistência dos lotes de vinil: a varredura faz upsert aqui e o app lê daqui.
-- Assim o "não perder itens quando o leilão entra ao vivo" fica durável (não
-- depende do cache em memória, que some em cold start), e o preço é atualizado.
CREATE TABLE IF NOT EXISTS public.lots (
  id TEXT PRIMARY KEY,
  id_leilao TEXT NOT NULL,
  id_peca TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT '0',
  lote TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  image TEXT,
  price TEXT NOT NULL DEFAULT '',
  day_key TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  house TEXT NOT NULL DEFAULT '',
  house_url TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lots_day_key_idx ON public.lots (day_key);
CREATE INDEX IF NOT EXISTS lots_last_seen_at_idx ON public.lots (last_seen_at DESC);
GRANT SELECT ON public.lots TO authenticated;
GRANT ALL ON public.lots TO service_role;
ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view lots" ON public.lots FOR SELECT TO authenticated USING (true);

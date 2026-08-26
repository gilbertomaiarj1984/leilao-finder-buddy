-- =====================================================================
-- Setup consolidado do schema (estado final das migrations existentes).
-- Rode isto UMA vez no projeto Supabase novo (SQL Editor) para recriar
-- toda a estrutura. Depois importe os DADOS do export do Lovable.
--
-- Estado de segurança: RLS habilitado em todas as tabelas e acesso
-- concedido apenas a service_role. O app lê/escreve pelo servidor com a
-- SUPABASE_SERVICE_ROLE_KEY; o login do Google apenas controla o acesso
-- ao app (não dá acesso direto às tabelas).
-- =====================================================================

-- Função utilitária de updated_at (usada pelos triggers abaixo)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- ---------------------------------------------------------------------
-- seen_auctions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seen_auctions (
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

-- ---------------------------------------------------------------------
-- lots
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lots (
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
CREATE INDEX IF NOT EXISTS lots_day_key_idx ON public.lots (day_key);

CREATE TRIGGER update_lots_updated_at BEFORE UPDATE ON public.lots
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- known_artists
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.known_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_known_artists_updated_at BEFORE UPDATE ON public.known_artists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- app_state
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- lot_ai — avaliação da IA por lote (cache durável; 1 avaliação por disco).
-- `id` casa com lots.id ("${idLeilao}-${idPeca}"); `title_hash` guarda o hash
-- do título avaliado, então só re-avaliamos quando o título muda.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lot_ai (
  id           text PRIMARY KEY,
  title_hash   text NOT NULL,
  score        integer,
  rarity       text,
  deal         text,
  reason       text,
  tags         jsonb NOT NULL DEFAULT '[]',
  model        text,
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Segurança: RLS on + acesso somente para service_role (estado final)
-- ---------------------------------------------------------------------
ALTER TABLE public.seen_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.known_artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lot_ai        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seen_auctions FROM anon, authenticated;
REVOKE ALL ON public.lots          FROM anon, authenticated;
REVOKE ALL ON public.known_artists FROM anon, authenticated;
REVOKE ALL ON public.app_state     FROM anon, authenticated;
REVOKE ALL ON public.lot_ai        FROM anon, authenticated;

GRANT ALL ON public.seen_auctions TO service_role;
GRANT ALL ON public.lots          TO service_role;
GRANT ALL ON public.known_artists TO service_role;
GRANT ALL ON public.app_state     TO service_role;
GRANT ALL ON public.lot_ai        TO service_role;

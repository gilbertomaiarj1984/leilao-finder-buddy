-- v0.197.0: contatos lidos da página de cada pregão (bloco "Local") para reconhecer a LOJA de pregões
-- novos de leiloeiros que hospedam várias lojas, e de onde veio a loja de um pregão
-- ('manual' | 'confirmado' | 'auto'; '' = sem loja). Histórico: migrations/20261113120000_*.
CREATE TABLE IF NOT EXISTS public.auction_contacts (
  id_leilao     text PRIMARY KEY,
  domain        text NOT NULL DEFAULT '',
  strong        text[] NOT NULL DEFAULT '{}',
  weak          text[] NOT NULL DEFAULT '{}',
  model         text NOT NULL DEFAULT '',
  local_text    text NOT NULL DEFAULT '',
  ok            boolean NOT NULL DEFAULT true,
  note          text NOT NULL DEFAULT '',
  suggest_store text NOT NULL DEFAULT '',
  suggest_via   text NOT NULL DEFAULT '',
  linked_via    text NOT NULL DEFAULT '',
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_auctions ADD COLUMN IF NOT EXISTS store_source text NOT NULL DEFAULT '';
-- Lojas informadas antes desta versão (v0.193.0–v0.196) foram informadas à mão.
UPDATE public.purchase_auctions SET store_source = 'manual' WHERE store <> '' AND store_source = '';

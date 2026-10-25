-- v0.182.0 — edição (original/reedição) e master do Discogs (histórico; o setup.sql é a fonte).
ALTER TABLE public.lookout_items ADD COLUMN IF NOT EXISTS edition text;
ALTER TABLE public.lookout_items ADD COLUMN IF NOT EXISTS master_id integer;
ALTER TABLE public.collection_items ADD COLUMN IF NOT EXISTS edition text;
ALTER TABLE public.collection_items ADD COLUMN IF NOT EXISTS master_id integer;
ALTER TABLE public.lot_market ADD COLUMN IF NOT EXISTS master_id integer;

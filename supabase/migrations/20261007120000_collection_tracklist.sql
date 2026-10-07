-- Tracklist do disco da coleção (mesmo formato de `lot_ai.tracklist`: [{side,title,fame}]),
-- buscada pela IA sob demanda no botão de tracklist do card. NULL = ainda não buscada.
ALTER TABLE public.collection_items ADD COLUMN IF NOT EXISTS tracklist jsonb;

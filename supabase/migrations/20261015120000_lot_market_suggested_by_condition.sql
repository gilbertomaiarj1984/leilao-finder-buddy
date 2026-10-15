-- Preço sugerido do Discogs por condição (M, NM, VG+, VG, G+, G, F, P), em BRL.
-- NULL = ainda não coletado (o cron `step=market` preenche); {} = consultado, sem sugestões.
ALTER TABLE public.lot_market ADD COLUMN IF NOT EXISTS suggested_by_condition jsonb;

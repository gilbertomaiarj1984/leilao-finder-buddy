-- Campos ricos do catálogo (endpoint JSON), na MESMA varredura por leilão:
-- sinais de demanda (VISITAS/QTDLANCE), taxa do leiloeiro e valor inicial/contratado.
-- Demanda pré-leilão no cache de estado (cards); demanda + taxa + inicial no histórico.
ALTER TABLE public.lot_condition ADD COLUMN IF NOT EXISTS views integer;
ALTER TABLE public.lot_condition ADD COLUMN IF NOT EXISTS bids  integer;

ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS views         integer;
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS bids          integer;
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS fee_pct       numeric;
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS initial_price numeric;

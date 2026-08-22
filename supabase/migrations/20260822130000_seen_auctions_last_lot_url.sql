-- URL do último lote (que temos) de cada leilão, para checar se já foi vendido
-- (marcador "is-vendido" / "Lote vendido") e então considerar o leilão finalizado.
ALTER TABLE public.seen_auctions ADD COLUMN IF NOT EXISTS last_lot_url TEXT;

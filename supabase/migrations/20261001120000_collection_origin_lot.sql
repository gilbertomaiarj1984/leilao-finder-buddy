-- Disco extra de uma compra com vários LPs ("Adicionar disco" no "Enviar para a coleção"):
-- guarda só o rastro da compra de origem; `lot_id` segue único e fica com o disco principal.
ALTER TABLE public.collection_items ADD COLUMN IF NOT EXISTS origin_lot_id text;
CREATE INDEX IF NOT EXISTS collection_items_origin_lot_idx ON public.collection_items (origin_lot_id);

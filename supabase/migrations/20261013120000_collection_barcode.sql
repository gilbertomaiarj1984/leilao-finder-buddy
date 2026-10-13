-- Coleção: código de barras / nº de catálogo do disco (leitura por câmera → busca no Discogs).
ALTER TABLE public.collection_items ADD COLUMN IF NOT EXISTS barcode text NOT NULL DEFAULT '';

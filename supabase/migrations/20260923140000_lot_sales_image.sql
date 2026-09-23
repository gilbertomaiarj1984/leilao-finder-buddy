-- Thumbnail pequeno/comprimido do lote em `lot_sales`, só para ajudar a identificação visual no
-- Vinil Analytics. NUNCA a URL crua do CDN do catálogo (não sobrevive ao leilão) — nosso próprio
-- storage (`/collection/sales/<lot_id>.webp`). NULL = ainda não tentado; '' = tentado sem
-- imagem-fonte disponível (marcador definitivo). Ver `captureSaleThumbnail`/
-- `backfillSaleThumbnails` em `lot-sales.server.ts`. Changelog apenas — `setup.sql` é reaplicado
-- automaticamente a cada deploy (idempotente), sem passo manual.
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS image text;

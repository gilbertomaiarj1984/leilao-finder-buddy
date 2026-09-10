-- lot_sales.orig_text — descritivo COMPLETO do card do catálogo, preservado como "texto
-- original" do lote. É gravado na captura (o mesmo `data.text` que alimenta o estado) e NÃO é
-- reescrito pela reidentificação por IA (que só ajusta `title`/`artist`). Serve para o usuário
-- ver o que o lote realmente é e corrigir os não identificados (override por venda no Analytics).
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS orig_text text NOT NULL DEFAULT '';

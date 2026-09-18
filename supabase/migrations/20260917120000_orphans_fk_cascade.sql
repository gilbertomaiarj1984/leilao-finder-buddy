-- Fase 5 da migração para VPS (docs/economia-fase-2-vps-unico.md): o schema nunca teve FK
-- nem CASCADE. `pruneOutOfWindow` (leiloesbr-scrape.server.ts) apaga de `lots` os lotes fora
-- da janela de dias, e `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` (todos com `id` =
-- `lots.id`) acumulam órfãos desde então — linha lida à toa pelos anti-joins do cron.
--
-- ⚠️ NUNCA cascatear `lot_sales` → `lots`: é o arquivo permanente de vendas, sobrevive à
-- poda de `lots` de propósito (histórico do Vinil Analytics). Por isso esta migração toca
-- só nas quatro tabelas de cache/avaliação por lote, nunca em `lot_sales`.

-- 1) Limpa os órfãos já acumulados (idempotente — não há o que fazer numa 2ª execução).
DELETE FROM public.lot_ai       la WHERE NOT EXISTS (SELECT 1 FROM public.lots l WHERE l.id = la.id);
DELETE FROM public.lot_ident    li WHERE NOT EXISTS (SELECT 1 FROM public.lots l WHERE l.id = li.id);
DELETE FROM public.lot_market   lm WHERE NOT EXISTS (SELECT 1 FROM public.lots l WHERE l.id = lm.id);
DELETE FROM public.lot_condition lc WHERE NOT EXISTS (SELECT 1 FROM public.lots l WHERE l.id = lc.id);

-- 2) FKs com ON DELETE CASCADE, para as próximas podas de `lots` não deixarem órfão de novo.
-- `ADD CONSTRAINT` não tem `IF NOT EXISTS`; checar `pg_constraint` é o jeito idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_ai_id_fkey') THEN
    ALTER TABLE public.lot_ai
      ADD CONSTRAINT lot_ai_id_fkey FOREIGN KEY (id) REFERENCES public.lots(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_ident_id_fkey') THEN
    ALTER TABLE public.lot_ident
      ADD CONSTRAINT lot_ident_id_fkey FOREIGN KEY (id) REFERENCES public.lots(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_market_id_fkey') THEN
    ALTER TABLE public.lot_market
      ADD CONSTRAINT lot_market_id_fkey FOREIGN KEY (id) REFERENCES public.lots(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_condition_id_fkey') THEN
    ALTER TABLE public.lot_condition
      ADD CONSTRAINT lot_condition_id_fkey FOREIGN KEY (id) REFERENCES public.lots(id) ON DELETE CASCADE;
  END IF;
END $$;

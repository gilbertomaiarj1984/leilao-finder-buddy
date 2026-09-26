-- Preço (R$) do lote no momento da avaliação da IA. A nota mistura raridade + oportunidade;
-- quando o preço de um vigiado/lance sobe o bastante desde a avaliação, ela é refeita (ver
-- `src/lib/ai-reprice.ts`). NULL = avaliação antiga (antes desta coluna) ou sem preço.
-- Changelog apenas — `setup.sql` é reaplicado automaticamente a cada deploy (idempotente).
ALTER TABLE public.lot_ai ADD COLUMN IF NOT EXISTS eval_price numeric;

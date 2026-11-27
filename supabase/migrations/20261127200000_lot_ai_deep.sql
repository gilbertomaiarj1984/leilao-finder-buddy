-- Análise profunda dos vigiados (v0.204.0).
ALTER TABLE public.lot_ai ADD COLUMN IF NOT EXISTS deep jsonb;

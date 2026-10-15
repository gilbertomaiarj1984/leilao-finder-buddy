-- Descrição completa do lote (tooltip do catálogo da casa), limpa e truncada em ~600 caracteres.
-- Preenchida pelo cron `step=condition` (que relê todos os lotes ao subir CONDITION_PARSER_VERSION).
ALTER TABLE public.lot_condition ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

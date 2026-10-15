-- purchase_calibration — calibração da IA com as compras RECEBIDAS (v0.150.0, painel de IA).
-- `snapshot` = o que a IA/o leitor de estado/o Discogs diziam do lote NA ÉPOCA da compra (o lote sai
-- de `lots` 10 dias depois; sem FK de propósito — a compra sobrevive). `real_*`, `verdict` e `note`
-- são a opinião do usuário depois que o disco chegou. Histórico:
-- supabase/migrations/20261015140000_purchase_calibration.sql.
CREATE TABLE IF NOT EXISTS public.purchase_calibration (
  lot_id       text PRIMARY KEY,                       -- = purchases.lot_id
  snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at  timestamptz,
  real_media   text NOT NULL DEFAULT '',               -- estado real do disco ('' = não informado)
  real_sleeve  text NOT NULL DEFAULT '',
  real_score   integer,                                -- nota (0–100) que o usuário daria
  verdict      text NOT NULL DEFAULT '' CHECK (verdict IN ('', 'valeu', 'ok', 'nao_valeu')),
  note         text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS update_purchase_calibration_updated_at ON public.purchase_calibration;
CREATE TRIGGER update_purchase_calibration_updated_at BEFORE UPDATE ON public.purchase_calibration
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Histórico: acompanhamento de pagamento/envio por pregão (ver supabase/setup.sql).

-- ---------------------------------------------------------------------
-- shipments + purchase_auctions
-- Acompanhamento de pagamento/envio das compras POR PREGÃO (`id_leilao`).
-- `purchase_auctions` só tem linha quando o usuário mexeu no pregão (ausência =
-- "aberto"), por isso a sync de `purchases` nunca sobrescreve o status.
-- `shipments` = remessa que junta pregões "na guarda" da MESMA casa (frete
-- único + rastreio). Histórico: supabase/migrations/20261012120000_purchase_shipping.sql.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house       text NOT NULL DEFAULT '',
  freight     numeric(10,2) NOT NULL DEFAULT 0,
  tracking    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_auctions (
  id_leilao    text PRIMARY KEY,
  status       text NOT NULL DEFAULT 'aberto'
               CHECK (status IN ('aberto','pago','guarda','transito','recebido')),
  paid_at      date,
  received_at  date,
  note         text NOT NULL DEFAULT '',
  shipment_id  uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_auctions_shipment_idx ON public.purchase_auctions (shipment_id);

DROP TRIGGER IF EXISTS update_shipments_updated_at ON public.shipments;
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_purchase_auctions_updated_at ON public.purchase_auctions;
CREATE TRIGGER update_purchase_auctions_updated_at BEFORE UPDATE ON public.purchase_auctions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

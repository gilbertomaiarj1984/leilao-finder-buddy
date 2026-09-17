-- ---------------------------------------------------------------------
-- purchases
-- Histórico de compras (vinil) do usuário, lido de "Minhas compras"
-- (conta_site.asp?l=6), varredura INCREMENTAL por leilão (id=<idLeilao>).
-- De-dup por `lot_id` ("${idLeilao}-${idPeca}"). Só vinil (looksNonVinyl).
-- Independente de `collection_items` (mesma descoberta de leilões vencidos,
-- gravação separada — um lote pode aparecer nas duas tabelas).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id       text UNIQUE NOT NULL,      -- "${idLeilao}-${idPeca}"
  id_peca      text NOT NULL,
  id_leilao    text NOT NULL,
  base         text NOT NULL DEFAULT '0',
  lote         text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  won_price    text NOT NULL DEFAULT '',  -- valor pago (texto BR "R$ 70,00")
  won_date     date,
  url          text NOT NULL DEFAULT '',
  image        text,
  house        text NOT NULL DEFAULT '',
  uf           text NOT NULL DEFAULT '',
  domain       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Ordenação padrão da UI (mais recente primeiro).
CREATE INDEX IF NOT EXISTS purchases_won_date_idx ON public.purchases (won_date DESC NULLS LAST, created_at DESC);
-- Agrupamento "por casa".
CREATE INDEX IF NOT EXISTS purchases_house_idx ON public.purchases (house);
-- Diagnóstico/diff por leilão.
CREATE INDEX IF NOT EXISTS purchases_id_leilao_idx ON public.purchases (id_leilao);

DROP TRIGGER IF EXISTS update_purchases_updated_at ON public.purchases;
CREATE TRIGGER update_purchases_updated_at BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchases FROM anon, authenticated;
GRANT ALL ON public.purchases TO service_role;

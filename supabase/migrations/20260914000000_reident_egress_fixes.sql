-- Fase 1 (economia de egress/CPU) — ver docs/economia-fase-1-egress-e-cpu.md.
--
-- 1) RPC de anti-join: devolve só as vendas de `lot_sales` que AINDA não têm linha em
--    `lot_ident`, limitado a `p_limit`. Substitui o padrão antigo de `reidentifyAllSales`
--    (baixar as duas tabelas INTEIRAS a cada chamada para achar o que falta identificar).
CREATE OR REPLACE FUNCTION public.get_unidentified_lot_sales(p_limit integer)
RETURNS SETOF public.lot_sales
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ls.*
  FROM public.lot_sales ls
  WHERE NOT EXISTS (SELECT 1 FROM public.lot_ident li WHERE li.id = ls.lot_id)
  ORDER BY ls.lot_id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_unidentified_lot_sales(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unidentified_lot_sales(integer) TO service_role;

-- 2) `bundle` — sinal de "lote/kit com vários discos" (preço do CONJUNTO, não de um álbum),
--    calculado uma vez na captura a partir do `orig_text` e persistido. Deixa o Vinil Analytics
--    (`getVinylSales`) filtrar lotes sem precisar baixar `orig_text` (a coluna mais pesada por
--    linha) a cada abertura da tela — só esse booleano.
ALTER TABLE public.lot_sales ADD COLUMN IF NOT EXISTS bundle boolean NOT NULL DEFAULT false;

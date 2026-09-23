-- Fix: `get_unidentified_lot_sales` (v0.73.1/20260914000000) fazia anti-join só contra
-- `lot_ident`, sem checar se o lote ainda existe em `lots`. Como `lot_ident` tem FK
-- ON DELETE CASCADE pra `lots(id)` (v0.67.0/20260917120000), uma venda cujo lote foi podado
-- ou excluído NUNCA consegue ganhar linha em `lot_ident` — a RPC devolvia essa mesma venda
-- pra sempre como "não identificada", e `reidentifyAllSales` gastava uma chamada de IA por
-- rodada nela, em todo cron, sem nunca convergir (achado v0.76.4, run manual do refresh.yml
-- em 2026-09-23 girando 15 rodadas idênticas sem progresso — ver docs/notas-desenvolvimento.md).
-- Passa a exigir que o lote AINDA exista em `lots` para entrar na fila de identificação —
-- venda de lote já podado mantém o artista/título que já tinha da última vez que foi
-- identificada (normalmente enquanto o lote ainda estava ativo).
CREATE OR REPLACE FUNCTION public.get_unidentified_lot_sales(p_limit integer)
RETURNS SETOF public.lot_sales
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ls.*
  FROM public.lot_sales ls
  WHERE NOT EXISTS (SELECT 1 FROM public.lot_ident li WHERE li.id = ls.lot_id)
    AND EXISTS (SELECT 1 FROM public.lots l WHERE l.id = ls.lot_id)
  ORDER BY ls.lot_id
  LIMIT p_limit;
$$;

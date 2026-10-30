-- Consultas por leilão (`eq("id_leilao", …)`) em `lots` não tinham índice.
CREATE INDEX IF NOT EXISTS lots_id_leilao_idx ON public.lots (id_leilao);

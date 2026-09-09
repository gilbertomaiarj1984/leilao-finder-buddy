-- lot_sales — histórico de vendas dos lotes (base do Vinil Analytics).
-- Capturado do catálogo da casa (catalogo.asp) DEPOIS do leilão: 1 requisição por leilão,
-- não lote a lote. `sold_date` = data do LEILÃO (âncora temporal). Estado (Disco/Capa) é o
-- melhor que o texto do card permite; indefinido quando não há sigla.
CREATE TABLE IF NOT EXISTS public.lot_sales (
  lot_id         text PRIMARY KEY,               -- "${idLeilao}-${idPeca}"
  id_leilao      text NOT NULL,
  id_peca        text NOT NULL,
  artist         text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  sold_price     numeric,                          -- valor de venda normalizado
  sold_price_raw text NOT NULL DEFAULT '',         -- texto BR original ("R$ 1.234,56")
  sold_date      date,                             -- data do LEILÃO (não a da captura)
  house          text NOT NULL DEFAULT '',
  uf             text NOT NULL DEFAULT '',
  media          text NOT NULL DEFAULT '',         -- grau do disco (grading) ou ''
  sleeve         text NOT NULL DEFAULT '',         -- grau da capa ou ''
  score          integer,                          -- Score Final (0–100)
  faixa          text NOT NULL DEFAULT '',         -- rótulo da Faixa de Classificação
  insert_state   text NOT NULL DEFAULT '',         -- 'sim' | 'nao' | ''
  source_url     text NOT NULL DEFAULT '',
  captured_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lot_sales_artist_idx ON public.lot_sales (artist);
CREATE INDEX IF NOT EXISTS lot_sales_sold_date_idx ON public.lot_sales (sold_date);

ALTER TABLE public.lot_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_sales FROM anon, authenticated;
GRANT ALL ON public.lot_sales TO service_role;

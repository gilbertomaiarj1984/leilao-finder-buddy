-- lot_condition — cache de estado de conservação (Disco/Capa) por lote, para os cards
-- PRÉ-leilão. Alimentado pelo CATÁLOGO da casa (o descritivo completo vem no tooltip do
-- card), reaproveitando a varredura por leilão — sem abrir a peca.asp lote a lote.
-- `id` casa com lots.id ("${idLeilao}-${idPeca}"); `title_hash` re-avalia quando o título
-- do lote muda.
CREATE TABLE IF NOT EXISTS public.lot_condition (
  id           text PRIMARY KEY,
  title_hash   text NOT NULL,
  media        text NOT NULL DEFAULT '',   -- grau do disco (grading) ou ''
  sleeve       text NOT NULL DEFAULT '',   -- grau da capa ou ''
  insert_state text NOT NULL DEFAULT '',   -- 'sim' | 'nao' | ''
  score        integer,                    -- Score Final (0–100)
  faixa        text NOT NULL DEFAULT '',   -- rótulo da Faixa de Classificação
  source       text NOT NULL DEFAULT '',   -- 'catalog' | 'title' | 'indefinido'
  evaluated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lot_condition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_condition FROM anon, authenticated;
GRANT ALL ON public.lot_condition TO service_role;

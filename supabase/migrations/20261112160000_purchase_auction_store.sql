-- Loja que de fato vende/envia o pregão, quando difere da casa mostrada pelo LeilõesBR (leiloeiro que
-- hospeda lojas sem site próprio). Vazio = a própria casa. Usada em remessa, guarda e semáforo.
ALTER TABLE public.purchase_auctions ADD COLUMN IF NOT EXISTS store text NOT NULL DEFAULT '';

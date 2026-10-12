-- Histórico: novo status 'frete' (aguardando retorno do frete) em purchase_auctions.
-- v0.131.0: novo status "frete" (em aberto, aguardando retorno do frete). O CHECK inline do
-- CREATE TABLE acima só vale em banco novo; recria-o aqui para bancos que já têm a tabela.
ALTER TABLE public.purchase_auctions DROP CONSTRAINT IF EXISTS purchase_auctions_status_check;
ALTER TABLE public.purchase_auctions ADD CONSTRAINT purchase_auctions_status_check
  CHECK (status IN ('aberto','frete','pago','guarda','transito','recebido'));

/**
 * Frete estimado de um lote de leilão. As casas brasileiras sempre cobram frete, então a
 * comparação com o preço de mercado (Discogs) fica justa somando o frete ao valor do lote:
 * R$ 25 na região Sudeste, R$ 35 fora dela (estimativa fixa do usuário; vai para o painel de IA).
 */
const FREIGHT_SUDESTE = 25;
const FREIGHT_OUTRAS_REGIOES = 35;

const SUDESTE = new Set(["SP", "RJ", "MG", "ES"]);

/** Frete estimado pela UF do lote. UF desconhecida usa o valor maior (conservador). */
export function auctionFreight(uf: string | null | undefined): number {
  return SUDESTE.has((uf ?? "").trim().toUpperCase()) ? FREIGHT_SUDESTE : FREIGHT_OUTRAS_REGIOES;
}

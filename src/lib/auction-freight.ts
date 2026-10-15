/**
 * Frete estimado de um lote de leilão. As casas brasileiras sempre cobram frete, então a
 * comparação com o preço de mercado (Discogs) fica justa somando o frete ao valor do lote:
 * R$ 25 na região Sudeste, R$ 35 fora dela (estimativa fixa do usuário; vai para o painel de IA).
 */
export const FREIGHT_SUDESTE = 25;
export const FREIGHT_OUTRAS_REGIOES = 35;

const SUDESTE = new Set(["SP", "RJ", "MG", "ES"]);

type FreightConfig = { sudeste: number; outras: number };

/** Frete estimado pela UF do lote. UF desconhecida usa o valor das demais regiões. */
export function auctionFreight(
  uf: string | null | undefined,
  cfg: FreightConfig = { sudeste: FREIGHT_SUDESTE, outras: FREIGHT_OUTRAS_REGIOES },
): number {
  return SUDESTE.has((uf ?? "").trim().toUpperCase()) ? cfg.sudeste : cfg.outras;
}

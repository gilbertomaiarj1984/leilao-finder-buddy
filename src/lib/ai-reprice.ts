/**
 * Reavaliação da nota da IA quando o preço do lote SOBE (client-safe, sem I/O).
 *
 * A nota (`lot_ai.score`) mistura raridade + OPORTUNIDADE (preço pedido vs. valor estimado),
 * então uma nota dada com o lote a R$ 5 fica otimista demais depois que os lances levam o
 * lote a R$ 100. `lot_ai.eval_price` guarda o preço usado na avaliação; quando o preço atual
 * passa dele por uma margem relevante, o lote volta a ser elegível para avaliação — só para
 * VIGIADOS + LANCES (conjunto pequeno; na listagem inteira isso custaria caro demais).
 *
 * Margem dupla (relativa E absoluta) para não reavaliar a cada incremento mínimo de lance:
 * precisa subir pelo menos `REPRICE_MIN_RATIO` (20%) E `REPRICE_MIN_DELTA` (R$ 10).
 */
export const REPRICE_MIN_RATIO = 1.2;
export const REPRICE_MIN_DELTA = 10;

/**
 * `true` quando o preço atual subiu o bastante desde a avaliação para justificar refazê-la.
 * `evalPrice` null/undefined = avaliação antiga (antes de `eval_price` existir) ou feita sem
 * preço → reavalia uma vez se houver preço atual (daí em diante o preço fica gravado).
 */
export function priceRoseSinceEval(
  evalPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): boolean {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  if (evalPrice == null || !Number.isFinite(evalPrice) || evalPrice <= 0) return true;
  return (
    currentPrice >= evalPrice * REPRICE_MIN_RATIO && currentPrice - evalPrice >= REPRICE_MIN_DELTA
  );
}

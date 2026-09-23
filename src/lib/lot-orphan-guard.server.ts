import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` têm FK `ON DELETE CASCADE` pra `lots(id)`
 * (v0.67.0, "FKs de limpeza"). Quem escreve nessas tabelas às vezes trabalha em cima de dados
 * que sobrevivem à exclusão de um lote (`lot_sales`, o histórico de vendas, nunca é apagado) ou
 * de um batch montado antes de um `step=prune`/exclusão manual rodar no meio do caminho — nesse
 * intervalo, o `id` do payload pode não existir mais em `lots` e o upsert quebra com violação de
 * FK (`23503`). Devolve só os `id`s do array de entrada que AINDA existem em `lots`, para os
 * writers descartarem as linhas órfãs em vez de propagar a exceção (achado v0.76.2/v0.76.3 —
 * ver docs/notas-desenvolvimento.md).
 */
export async function filterExistingLotIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabaseAdmin.from("lots").select("id").in("id", ids);
  if (error) throw error;
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}

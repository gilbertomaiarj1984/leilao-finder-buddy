import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASELINE_KEY = "dashboard_baseline";

export type Baseline = { prices: Record<string, string>; seenAt: string | null };

export async function getBaseline(): Promise<Baseline> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value, updated_at")
      .eq("key", BASELINE_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    const prices =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, string>)
        : {};
    return { prices, seenAt: data?.updated_at ?? null };
  } catch (error) {
    console.error("[app-state] não foi possível ler o baseline (usando vazio)", error);
    return { prices: {}, seenAt: null };
  }
}

export async function markSeen(prices: Record<string, string>): Promise<{ seenAt: string }> {
  const seenAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert({ key: BASELINE_KEY, value: prices, updated_at: seenAt }, { onConflict: "key" });
  // Antes engolíamos o erro e retornávamos "sucesso": o baseline nunca era
  // gravado e o painel ficava eternamente com tudo "novo" e sem último acesso.
  // Agora propagamos a falha para o cliente exibir e não mascarar o problema.
  if (error) {
    console.error("[app-state] não foi possível gravar o baseline", error);
    throw new Error(`Não foi possível gravar o baseline: ${error.message}`);
  }
  return { seenAt };
}

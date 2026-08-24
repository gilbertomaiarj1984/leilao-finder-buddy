/**
 * Estado por conta guardado na tabela `app_state` (key text PK, value jsonb,
 * updated_at timestamptz). Usado como "último acesso" do painel: guardamos o mapa
 * { lotId: price } visto na última visita para calcular a variação.
 *
 * Best-effort: se a tabela ainda não existir (o Lovable é quem cria o schema),
 * tudo degrada para vazio e o painel funciona sem os deltas. A tabela `app_state`
 * ainda não está nos tipos gerados, por isso o cliente é acessado por um shape
 * mínimo (via `unknown`) só para estas duas operações.
 */

const BASELINE_KEY = "dashboard_baseline";

export type Baseline = { prices: Record<string, string>; seenAt: string | null };

type AppStateRow = { value: unknown; updated_at: string | null };

type AppStateClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: AppStateRow | null; error: unknown }>;
      };
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ error: unknown }>;
  };
};

async function client(): Promise<AppStateClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AppStateClient;
}

export async function getBaseline(): Promise<Baseline> {
  try {
    const admin = await client();
    const { data, error } = await admin
      .from("app_state")
      .select("value, updated_at")
      .eq("key", BASELINE_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    const prices = value && typeof value === "object" ? (value as Record<string, string>) : {};
    return { prices, seenAt: data?.updated_at ?? null };
  } catch (error) {
    console.error("[app-state] não foi possível ler o baseline (usando vazio)", error);
    return { prices: {}, seenAt: null };
  }
}

export async function markSeen(prices: Record<string, string>): Promise<{ seenAt: string }> {
  const seenAt = new Date().toISOString();
  try {
    const admin = await client();
    const { error } = await admin
      .from("app_state")
      .upsert({ key: BASELINE_KEY, value: prices, updated_at: seenAt }, { onConflict: "key" });
    if (error) throw error;
  } catch (error) {
    console.error("[app-state] não foi possível gravar o baseline", error);
  }
  return { seenAt };
}

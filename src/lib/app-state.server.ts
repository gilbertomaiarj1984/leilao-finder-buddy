import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASELINE_KEY = "dashboard_baseline";
const VERIFIED_HOUSES_KEY = "verified_houses";
const USER_INTERESTS_KEY = "user_interests";
const AI_BATCH_KEY = "ai_batch";
const AI_MODE_KEY = "ai_mode";

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

/**
 * Casas de leilão marcadas como "verificadas" (chaves `${dia}|${casa}`). Global, um
 * único registro em `app_state` (mesmo modelo do baseline). ANTES ficava só no
 * localStorage do navegador — trocar de dispositivo/navegador ou usar a URL de
 * preview (outra origem) perdia a marcação. Agora é durável no Supabase.
 */
export async function getVerifiedHouses(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", VERIFIED_HOUSES_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    return Array.isArray(value)
      ? (value as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  } catch (error) {
    console.error("[app-state] não foi possível ler as casas verificadas (usando vazio)", error);
    return [];
  }
}

export async function setVerifiedHouses(keys: string[]): Promise<{ savedAt: string }> {
  const savedAt = new Date().toISOString();
  const unique = [...new Set(keys.filter((k) => typeof k === "string" && k))];
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: VERIFIED_HOUSES_KEY, value: unique, updated_at: savedAt },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar as casas verificadas", error);
    throw new Error(`Não foi possível gravar as casas verificadas: ${error.message}`);
  }
  return { savedAt };
}

/**
 * Lista de interesses do usuário (artistas/álbuns/gêneros que ele curte), usada pela
 * página "Análise de Lotes" para marcar/priorizar os lotes que casam com ela. Global,
 * um único registro em `app_state` (mesmo modelo das casas verificadas).
 */
export async function getUserInterests(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", USER_INTERESTS_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    return Array.isArray(value)
      ? (value as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  } catch (error) {
    console.error("[app-state] não foi possível ler os interesses (usando vazio)", error);
    return [];
  }
}

export async function setUserInterests(items: string[]): Promise<{ savedAt: string }> {
  const savedAt = new Date().toISOString();
  // Normaliza: aparado, sem vazios, sem duplicatas (preservando a ordem).
  const clean = [
    ...new Set(items.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)),
  ];
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert({ key: USER_INTERESTS_KEY, value: clean, updated_at: savedAt }, { onConflict: "key" });
  if (error) {
    console.error("[app-state] não foi possível gravar os interesses", error);
    throw new Error(`Não foi possível gravar os interesses: ${error.message}`);
  }
  return { savedAt };
}

/**
 * Modo da avaliação por IA (controla o gasto de créditos da rodada automática do cron):
 * - `"off"`     → desligada (o cron não coleta nem submete nada).
 * - `"all"`     → avalia todos os lotes novos (comportamento histórico).
 * - `"watched"` → só os lotes que o usuário VIGIA ou já deu LANCE (união). Padrão.
 * Global, um único registro em `app_state` (mesmo modelo das casas verificadas). NÃO afeta
 * a análise SOB DEMANDA (botões por dia/casa), que é explícita e sempre roda.
 */
export type AiMode = "off" | "all" | "watched";

export const AI_MODES: readonly AiMode[] = ["off", "all", "watched"] as const;

/** Modo padrão quando nada foi configurado: econômico (só vigiados + lances). */
export const DEFAULT_AI_MODE: AiMode = "watched";

export async function getAiMode(): Promise<AiMode> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", AI_MODE_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    return typeof value === "string" && (AI_MODES as readonly string[]).includes(value)
      ? (value as AiMode)
      : DEFAULT_AI_MODE;
  } catch (error) {
    console.error("[app-state] não foi possível ler o modo da IA (usando padrão)", error);
    return DEFAULT_AI_MODE;
  }
}

export async function setAiMode(mode: AiMode): Promise<{ savedAt: string }> {
  if (!(AI_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Modo da IA inválido: ${mode}`);
  }
  const savedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert({ key: AI_MODE_KEY, value: mode, updated_at: savedAt }, { onConflict: "key" });
  if (error) {
    console.error("[app-state] não foi possível gravar o modo da IA", error);
    throw new Error(`Não foi possível gravar o modo da IA: ${error.message}`);
  }
  return { savedAt };
}

// `hashes` guarda o title_hash de cada lote enviado (id → hash), calculado na SUBMISSÃO,
// para o passo de COLETA (execução posterior do cron) gravar o cache com o hash correto
// mesmo que o título tenha mudado no meio-tempo.
export type PendingAiBatch = {
  batchId: string;
  submittedAt: string;
  hashes: Record<string, string>;
};

/** Batch de avaliação da IA em andamento (para o cron coletar). null quando não há. */
export async function getPendingAiBatch(): Promise<PendingAiBatch | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", AI_BATCH_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      if (typeof v["batchId"] === "string" && v["batchId"]) {
        const rawHashes = v["hashes"];
        const hashes: Record<string, string> = {};
        if (rawHashes && typeof rawHashes === "object" && !Array.isArray(rawHashes)) {
          for (const [k, hv] of Object.entries(rawHashes as Record<string, unknown>)) {
            if (typeof hv === "string") hashes[k] = hv;
          }
        }
        return { batchId: v["batchId"], submittedAt: String(v["submittedAt"] ?? ""), hashes };
      }
    }
    return null;
  } catch (error) {
    console.error("[app-state] não foi possível ler o batch pendente", error);
    return null;
  }
}

export async function setPendingAiBatch(batch: PendingAiBatch | null): Promise<void> {
  if (batch === null) {
    const { error } = await supabaseAdmin.from("app_state").delete().eq("key", AI_BATCH_KEY);
    if (error) console.error("[app-state] não foi possível limpar o batch pendente", error);
    return;
  }
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: AI_BATCH_KEY, value: batch, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar o batch pendente", error);
    throw new Error(`Não foi possível gravar o batch pendente: ${error.message}`);
  }
}

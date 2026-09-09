import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Definido localmente (mesma forma do `OwnedFeedback` de `wantlist-match`) para o módulo do
// SERVIDOR não depender de um módulo client-safe — evita surpresas de bundling no servidor.
export type OwnedFeedback = {
  lotId: string;
  itemId: string;
  verdict: "pos" | "neg";
  artist: string[];
  album: string[];
  year: number | null;
};

const VERIFIED_HOUSES_KEY = "verified_houses";
const USER_INTERESTS_KEY = "user_interests";
const AI_BATCH_KEY = "ai_batch";
const AI_IDENT_BATCH_KEY = "ai_ident_batch";
const AI_MODE_KEY = "ai_mode";
const AI_PROVIDER_KEY = "ai_provider";
const COLLECTION_LINKS_KEY = "collection_links";
const COLLECTION_FEEDBACK_KEY = "collection_feedback";
const SALES_CAPTURED_KEY = "sales_captured";

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
 * Relação manual lote → disco da Coleção ("já tenho"). Override EXPLÍCITO por lote:
 * - `"<collectionItemId>"` → vínculo confirmado pelo usuário;
 * - `false`               → "não tenho este disco" (sobrepõe o casamento automático);
 * - chave ausente         → vale o casamento automático (+ aprendizado).
 * `lotId = ${idLeilao}-${idPeca}`. Global, um único registro em `app_state`.
 */
export type CollectionLinks = Record<string, string | false>;

export async function getCollectionLinks(): Promise<CollectionLinks> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", COLLECTION_LINKS_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: CollectionLinks = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === false || typeof v === "string") out[k] = v;
    }
    return out;
  } catch (error) {
    console.error("[app-state] não foi possível ler os vínculos da coleção (usando vazio)", error);
    return {};
  }
}

async function saveCollectionLinks(links: CollectionLinks): Promise<{ savedAt: string }> {
  const savedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: COLLECTION_LINKS_KEY, value: links, updated_at: savedAt },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar os vínculos da coleção", error);
    throw new Error(`Não foi possível gravar os vínculos da coleção: ${error.message}`);
  }
  return { savedAt };
}

/**
 * Aplica UMA mudança no mapa de vínculos (read-modify-write): `null` apaga a chave
 * (volta ao automático); string/false gravam o vínculo/rejeição.
 */
export async function setCollectionLink(
  lotId: string,
  value: string | false | null,
): Promise<{ savedAt: string }> {
  const links = await getCollectionLinks();
  if (value === null) delete links[lotId];
  else links[lotId] = value;
  return saveCollectionLinks(links);
}

/**
 * Aprendizado por assinatura: cada decisão (confirmar/negar) guarda como o disco
 * apareceu no lote, para SUGERIR (nunca marcar sozinho) em outros lotes parecidos.
 */
export async function getCollectionFeedback(): Promise<OwnedFeedback[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", COLLECTION_FEEDBACK_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (!Array.isArray(value)) return [];
    return (value as unknown[]).filter(
      (e): e is OwnedFeedback =>
        !!e &&
        typeof e === "object" &&
        typeof (e as OwnedFeedback).lotId === "string" &&
        typeof (e as OwnedFeedback).itemId === "string" &&
        ((e as OwnedFeedback).verdict === "pos" || (e as OwnedFeedback).verdict === "neg") &&
        Array.isArray((e as OwnedFeedback).artist) &&
        Array.isArray((e as OwnedFeedback).album),
    );
  } catch (error) {
    console.error("[app-state] não foi possível ler o feedback da coleção (usando vazio)", error);
    return [];
  }
}

async function saveCollectionFeedback(entries: OwnedFeedback[]): Promise<void> {
  const savedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: COLLECTION_FEEDBACK_KEY, value: entries, updated_at: savedAt },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar o feedback da coleção", error);
    throw new Error(`Não foi possível gravar o feedback da coleção: ${error.message}`);
  }
}

/** Acrescenta uma entrada de aprendizado, deduplicando por `lotId`+`verdict`. */
export async function addCollectionFeedback(entry: OwnedFeedback): Promise<void> {
  const entries = (await getCollectionFeedback()).filter(
    (e) => !(e.lotId === entry.lotId && e.verdict === entry.verdict),
  );
  entries.push(entry);
  await saveCollectionFeedback(entries);
}

/** Remove todo o aprendizado originado de um lote (usado no "reativar automático"). */
export async function removeCollectionFeedbackByLot(lotId: string): Promise<void> {
  const entries = await getCollectionFeedback();
  const kept = entries.filter((e) => e.lotId !== lotId);
  if (kept.length !== entries.length) await saveCollectionFeedback(kept);
}

/**
 * Leilões cujo catálogo já foi varrido para capturar vendas (`lot_sales`). Uma vez que o
 * leilão terminou, o catálogo é estável, então gravamos o `idLeilao` aqui e não voltamos a
 * buscá-lo — é o checkpoint que torna a varredura/backfill idempotente e incremental
 * (processa um bloco por rodada até esgotar o backlog). Global, um registro em `app_state`.
 */
export async function getSalesCaptured(): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", SALES_CAPTURED_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    return new Set(
      Array.isArray(value)
        ? (value as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch (error) {
    console.error("[app-state] não foi possível ler os leilões capturados (usando vazio)", error);
    return new Set();
  }
}

/** Limpa o checkpoint de vendas capturadas (para re-capturar tudo, ex.: após ajustar o parser). */
export async function clearSalesCaptured(): Promise<void> {
  const { error } = await supabaseAdmin.from("app_state").delete().eq("key", SALES_CAPTURED_KEY);
  if (error) console.error("[app-state] não foi possível limpar o checkpoint de vendas", error);
}

/** Acrescenta `idLeilao`s ao conjunto de leilões já capturados (read-modify-write). */
export async function markSalesCaptured(idLeiloes: string[]): Promise<void> {
  const clean = idLeiloes.filter((s) => typeof s === "string" && s);
  if (!clean.length) return;
  const current = await getSalesCaptured();
  for (const id of clean) current.add(id);
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: SALES_CAPTURED_KEY, value: [...current], updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar os leilões capturados", error);
    throw new Error(`Não foi possível gravar os leilões capturados: ${error.message}`);
  }
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

/**
 * Provedor de IA PADRÃO (qual modelo usar quando o usuário não escolhe explicitamente):
 * `"anthropic"` (Claude) ou `"gemini"` (Google). Global, um registro em `app_state`.
 * Declarado localmente para o módulo do SERVIDOR não depender do client-safe `ai-provider.ts`
 * (mesma lição do `OwnedFeedback`). Precedência: `app_state` → env `AI_PROVIDER` → `anthropic`.
 */
export type AiProvider = "anthropic" | "gemini";

const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "gemini"] as const;

function envDefaultProvider(): AiProvider {
  const env = process.env["AI_PROVIDER"];
  return typeof env === "string" && (AI_PROVIDERS as readonly string[]).includes(env)
    ? (env as AiProvider)
    : "anthropic";
}

export async function getAiProvider(): Promise<AiProvider> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", AI_PROVIDER_KEY)
      .maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value)) {
      return value as AiProvider;
    }
    return envDefaultProvider();
  } catch (error) {
    console.error("[app-state] não foi possível ler o provedor de IA (usando padrão)", error);
    return envDefaultProvider();
  }
}

export async function setAiProvider(provider: AiProvider): Promise<{ savedAt: string }> {
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`Provedor de IA inválido: ${provider}`);
  }
  const savedAt = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert({ key: AI_PROVIDER_KEY, value: provider, updated_at: savedAt }, { onConflict: "key" });
  if (error) {
    console.error("[app-state] não foi possível gravar o provedor de IA", error);
    throw new Error(`Não foi possível gravar o provedor de IA: ${error.message}`);
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

// Batch da IDENTIFICAÇÃO simplificada (camada `lot_ident`), separado do de avaliação.
// `source` diz se a passada foi por título ou por capa, para a coleta gravar o `source`
// correto e o escalonamento título→capa funcionar.
export type PendingAiIdentBatch = {
  batchId: string;
  submittedAt: string;
  hashes: Record<string, string>;
  source: "title" | "image";
};

/** Batch de identificação em andamento (para o cron coletar). null quando não há. */
export async function getPendingAiIdentBatch(): Promise<PendingAiIdentBatch | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", AI_IDENT_BATCH_KEY)
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
        const source = v["source"] === "image" ? "image" : "title";
        return {
          batchId: v["batchId"],
          submittedAt: String(v["submittedAt"] ?? ""),
          hashes,
          source,
        };
      }
    }
    return null;
  } catch (error) {
    console.error("[app-state] não foi possível ler o batch de identificação pendente", error);
    return null;
  }
}

export async function setPendingAiIdentBatch(batch: PendingAiIdentBatch | null): Promise<void> {
  if (batch === null) {
    const { error } = await supabaseAdmin.from("app_state").delete().eq("key", AI_IDENT_BATCH_KEY);
    if (error) console.error("[app-state] não foi possível limpar o batch de identificação", error);
    return;
  }
  const { error } = await supabaseAdmin
    .from("app_state")
    .upsert(
      { key: AI_IDENT_BATCH_KEY, value: batch, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    console.error("[app-state] não foi possível gravar o batch de identificação", error);
    throw new Error(`Não foi possível gravar o batch de identificação: ${error.message}`);
  }
}

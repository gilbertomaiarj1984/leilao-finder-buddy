/**
 * Camada PLUGÁVEL de provedores de IA (server-only). Abstrai a chamada de geração de
 * texto para que o resto do app não saiba QUAL modelo está atendendo. Hoje há três:
 *
 * - **anthropic** (Claude) — via `@anthropic-ai/sdk` (Messages + Batches API).
 * - **gemini** (Google) — via REST (`generativelanguage.googleapis.com`), sem SDK/dep nova.
 * - **groq** — via REST OpenAI-compatível (`api.groq.com/openai/v1`), free tier; sem SDK/dep nova.
 *
 * O ponto central é `runText(req, provider)`: recebe uma requisição NEUTRA (system + texto +
 * imagem opcional) e devolve o texto do modelo. Faz **failover automático**: se o provedor
 * ativo responder "sem créditos"/quota (429/402/erro de billing), tenta o OUTRO provedor
 * configurado e segue — devolvendo qual provedor de fato atendeu (para a UI avisar).
 *
 * ⚠️ Lição do v0.24.x: este `*.server.ts` NÃO importa de `ai-provider.ts` (client-safe) —
 * a `AiProvider` é redeclarada localmente para não quebrar o code-splitting do cliente.
 */

/** Espelha `AiProvider` de `ai-provider.ts` (client-safe) — mantenha em sincronia. */
export type AiProvider = "anthropic" | "gemini" | "groq";

/** Ordem canônica (tentativa/failover). Espelha `AI_PROVIDERS` de `ai-provider.ts`. */
const PROVIDER_ORDER: readonly AiProvider[] = ["anthropic", "gemini", "groq"];

/** Requisição neutra: uma única fala de usuário (texto + imagem opcional) + system. */
export type AiRequest = {
  system: string;
  /** Teto de tokens de saída. */
  maxTokens: number;
  /** Texto do prompt do usuário. */
  text: string;
  /** URL http(s) de imagem (capa), quando houver visão. */
  image: string | null;
  /** Dica de que a saída é um objeto JSON (ativa `responseMimeType` no Gemini). */
  json?: boolean;
};

/** Resultado de `runText`: texto + qual provedor/modelo atendeu + se houve troca (failover). */
type RunTextResult = {
  text: string;
  provider: AiProvider;
  model: string;
  /** true quando o provedor pedido falhou por quota e o failover atendeu com outro. */
  switched: boolean;
  /**
   * Motivo de cada provedor tentado ANTES do que atendeu (ou de todos, se nenhum atendeu) —
   * ex.: `{ anthropic: "sem chave de API configurada", gemini: "sem créditos (429)" }`. Serve
   * pra UI mostrar, passo a passo, por que pulou de um provedor pro outro em vez de um
   * "trocou de provedor" genérico.
   */
  attemptErrors: Partial<Record<AiProvider, string>>;
};

// --- Configuração por provedor (chave de env + modelo, com override por env) ---------------

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";
/**
 * Modelo do Gemini padrão de fábrica: `gemini-3.1-flash-lite`, o mais barato CONFIRMADO
 * rodando de verdade (ver comentário grande em `ai-provider.ts` — `gemini-flash-lite-latest`
 * e `gemini-3.5-flash-lite` voltaram 400 INVALID_ARGUMENT em produção no v0.69.2, revertido
 * no v0.69.3). Espelha `DEFAULT_GEMINI_MODEL` de `ai-provider.ts` (client-safe, mesma lição
 * do v0.24.x: este arquivo não importa de lá).
 */
// DUP(modelos): lista/padrão dos modelos Gemini repetidos em 4 arquivos — centralizar em `ai-models.ts`.
const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";
/** Espelha `GROQ_DEFAULT_MODEL` de `ai-provider.ts` (client-safe; este arquivo não importa de lá). */
const GROQ_DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
/**
 * Modelo efetivo do provedor. Pro Gemini, `geminiModel` (a escolha do usuário, persistida em
 * `app_state.gemini_model` — ver `resolveGeminiModel` em `ai-eval.server.ts`) tem prioridade;
 * senão cai pro override por env (`GEMINI_MODEL`) e por último o padrão barato de fábrica.
 */
function providerModel(
  provider: AiProvider,
  geminiModel?: string,
  anthropicModel?: string,
): string {
  if (provider === "gemini")
    return geminiModel || process.env["GEMINI_MODEL"] || GEMINI_DEFAULT_MODEL;
  if (provider === "groq") return process.env["GROQ_MODEL"] || GROQ_DEFAULT_MODEL;
  return anthropicModel || process.env["ANTHROPIC_MODEL"] || ANTHROPIC_DEFAULT_MODEL;
}

/** Modelo do Claude escolhido na UI (`app_state`), com cache curto — evita 1 query por lote. */
let anthropicModelCache: { value: string; at: number } | null = null;
export async function resolveAnthropicModel(): Promise<string> {
  if (anthropicModelCache && Date.now() - anthropicModelCache.at < 30_000) {
    return anthropicModelCache.value;
  }
  let value: string;
  try {
    const { getAnthropicModel } = await import("./app-state.server");
    value = await getAnthropicModel();
  } catch {
    value = providerModel("anthropic");
  }
  anthropicModelCache = { value, at: Date.now() };
  return value;
}
export function invalidateAnthropicModelCache(): void {
  anthropicModelCache = null;
}

/** Nome da env com a chave de API do provedor. */
function providerKeyEnv(provider: AiProvider): string {
  if (provider === "gemini") return "GEMINI_API_KEY";
  if (provider === "groq") return "GROQ_API_KEY";
  return "ANTHROPIC_API_KEY";
}

/** true quando o provedor tem chave de API configurada no ambiente. */
function providerConfigured(provider: AiProvider): boolean {
  return Boolean(process.env[providerKeyEnv(provider)]);
}

/** Lista de provedores com chave (na ordem canônica). */
function configuredProviders(): AiProvider[] {
  return PROVIDER_ORDER.filter(providerConfigured);
}

/** true quando ao menos um provedor está configurado (senão a IA faz no-op). */
export function anyProviderConfigured(): boolean {
  return configuredProviders().length > 0;
}

/**
 * Provedor SÍNCRONO usado quando o Claude (Batches) não pode atender no cron: o primeiro
 * configurado fora do Claude, na ordem canônica (Gemini, depois Groq). `null` = nenhum.
 */
export function firstSyncProvider(): AiProvider | null {
  return configuredProviders().find((p) => !providerSupportsBatch(p)) ?? null;
}

/**
 * Provedor efetivo: o preferido quando tem chave; senão o primeiro configurado na ordem
 * canônica (Claude → Gemini → Groq); sem nenhuma chave, o último da ordem (a chamada vira no-op).
 */
export function effectiveProvider(preferred: AiProvider): AiProvider {
  if (providerConfigured(preferred)) return preferred;
  return configuredProviders()[0] ?? "gemini";
}

/**
 * Só a Anthropic tem Batches API nativa (assíncrona, ~50% mais barata) usada pelo cron.
 * Gemini e Groq rodam de forma síncrona no cron (ver `cron.server.ts`).
 */
export function providerSupportsBatch(provider: AiProvider): boolean {
  return provider === "anthropic";
}

// --- Erro de quota / "sem créditos" (dispara o failover) -----------------------------------

/**
 * Heurística para reconhecer "sem créditos"/quota/limite entre os dois provedores:
 * - HTTP 429 (rate limit / RESOURCE_EXHAUSTED) e 402 (payment required);
 * - mensagens de saldo/billing da Anthropic ("credit balance is too low");
 * - "quota", "exhausted", "insufficient", "billing" no texto do erro.
 * Só ESTES erros disparam o failover — falhas genéricas (parsing/rede) propagam.
 */
export function isQuotaError(error: unknown): boolean {
  const e = error as { status?: number; code?: number; message?: string } | null;
  const status = Number(e?.status ?? e?.code);
  if (status === 429 || status === 402) return true;
  const msg = String(e?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("credit balance") ||
    msg.includes("insufficient") ||
    msg.includes("quota") ||
    msg.includes("exhausted") ||
    msg.includes("resource_exhausted") ||
    msg.includes("billing") ||
    msg.includes("429") ||
    msg.includes("too low")
  );
}

/**
 * Erro TRANSITÓRIO do provedor (sobrecarga / indisponibilidade momentânea), que costuma
 * resolver ao **tentar de novo** ou no **outro provedor**:
 * - HTTP 500/502/503/504;
 * - mensagens "unavailable", "overloaded", "high demand", "try again", "timeout".
 * Ex. real do Gemini: `503 UNAVAILABLE "This model is currently experiencing high demand"`.
 */
function isTransientError(error: unknown): boolean {
  const e = error as { status?: number; code?: number; message?: string } | null;
  const status = Number(e?.status ?? e?.code);
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(e?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("try again") ||
    msg.includes("timeout") ||
    msg.includes("503")
  );
}

// --- Adaptador Anthropic (Claude) ----------------------------------------------------------

/** Cliente Anthropic (também usado pelo fluxo de Batches em `ai-eval.server.ts`). */
export async function getAnthropicClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
        data: string;
      };
    };

/** `data:image/...;base64,...` (foto tirada na hora, sem URL pública) → bloco base64. */
function anthropicImageBlock(image: string): AnthropicBlock {
  const m = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (m) {
    return {
      type: "image",
      source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2]! },
    };
  }
  return { type: "image", source: { type: "url", url: image } };
}

/** Converte a requisição neutra no formato de mensagem da Anthropic (Messages/Batches). */
export function toAnthropicMessageParams(req: AiRequest, model: string) {
  const content: AnthropicBlock[] = [];
  // A imagem vem ANTES do texto (recomendação da API de visão).
  if (req.image) content.push(anthropicImageBlock(req.image));
  content.push({ type: "text", text: req.text });
  return {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user" as const, content }],
    // Haiku 5.5 pensa por padrão (adaptive) e cobra isso como saída; a tarefa é só extrair
    // JSON, então desliga o raciocínio pra gastar menos tokens.
    ...(model.startsWith("claude-haiku-5") ? { thinking: { type: "disabled" as const } } : {}),
  };
}

/** Extrai o texto concatenado dos blocos `text` de uma resposta da Anthropic. */
function anthropicText(message: { content?: Array<{ type: string; text?: string }> }): string {
  return (message?.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** Teto de uma chamada síncrona à IA: sem ele, um provedor travado segura o cron até o `curl` do workflow desistir. */
const AI_CALL_TIMEOUT_MS = 60_000;

async function runAnthropic(req: AiRequest, model: string): Promise<string> {
  const client = await getAnthropicClient();
  const message = await client.messages.create(toAnthropicMessageParams(req, model), {
    timeout: AI_CALL_TIMEOUT_MS,
  });
  return anthropicText(message);
}

// --- Adaptador Gemini (Google, via REST) ---------------------------------------------------

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Baixa a imagem da capa e devolve `{mimeType, data(base64)}` para o Gemini (que — ao
 * contrário da Anthropic — NÃO busca URL arbitrária; a imagem precisa ir embutida).
 * Best-effort: em qualquer falha (rede/tipo), devolve null e a chamada segue só com texto.
 */
async function fetchInlineImage(url: string): Promise<{ mimeType: string; data: string } | null> {
  const dataUrl = url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/);
  if (dataUrl) return { mimeType: dataUrl[1]!, data: dataUrl[2]! };
  // A URL da capa pode vir do cliente (reavaliar um lote): nada de rede interna/metadados, redirect
  // revalidado a cada salto e teto de 6 MB lido em fluxo (capas maiores são descartadas, raro).
  const { fetchImageBytes } = await import("./safe-fetch.server");
  const img = await fetchImageBytes(url, { maxBytes: 6 * 1024 * 1024 });
  if (!img) return null;
  const mimeType = img.contentType.startsWith("image/") ? img.contentType : "image/jpeg";
  return { mimeType, data: img.bytes.toString("base64") };
}

/**
 * Só http(s) para um host público: recusa localhost, nomes sem ponto (serviços do Docker como
 * `app`/`postgres`), `.local`/`.internal`, IPv6 literal e faixas privadas/metadados (10/8, 127/8,
 * 169.254/16, 172.16/12, 192.168/16). Não impede DNS que aponte para dentro; reduz o risco (SSRF).
 */
export function isSafeImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":")) return false;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

async function runGemini(req: AiRequest, model: string): Promise<string> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("GEMINI_API_KEY ausente");

  const parts: GeminiPart[] = [];
  if (req.image) {
    const inline = await fetchInlineImage(req.image);
    if (inline) parts.push({ inlineData: inline });
  }
  parts.push({ text: req.text });

  // Folga de orçamento: o `thinkingBudget:0` abaixo TENTA desligar o raciocínio, mas o alias
  // `gemini-flash-latest` (hoje um flash mais novo) nem sempre o honra e gasta o orçamento de
  // saída "pensando" — estourando o teto ANTES de emitir a resposta (`finishReason:MAX_TOKENS`
  // com parts vazio). Por isso damos uma margem generosa acima do que o chamador pediu; o
  // conteúdo real ainda é cortado a jusante (ex.: descritivo da coleção a 6000 chars).
  const maxOutputTokens = Math.max(req.maxTokens + 4096, 8192);

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens,
      temperature: 0.2,
      // Tenta desligar o "thinking" (modelos 2.5) — best-effort; não confiamos só nisso, daí a
      // folga de `maxOutputTokens` acima.
      thinkingConfig: { thinkingBudget: 0 },
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  // Retry com backoff para erros TRANSITÓRIOS (ex.: 503 "high demand" do Gemini): 3 tentativas
  // com espera crescente. Se ainda falhar, o erro sobe e o `runText` faz failover ao outro
  // provedor. Erros não-transitórios (400/401/403/quota) propagam de imediato (sem retry).
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  } as const;

  let resp: Response;
  for (let attempt = 0; ; attempt += 1) {
    // O estouro do tempo vira "…aborted due to timeout", que `isTransientError` já trata como
    // transitório (retry e, se persistir, failover para o outro provedor).
    resp = await fetch(url, { ...init, signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS) });
    if (resp.ok) break;
    const detail = await resp.text().catch(() => "");
    // Propaga com status para o `isQuotaError`/`isTransientError` reconhecerem e agirem.
    const err = new Error(`Gemini HTTP ${resp.status}: ${detail.slice(0, 300)}`) as Error & {
      status?: number;
    };
    err.status = resp.status;
    // Só re-tenta o que é transitório e enquanto houver tentativas restantes (máx. 3 no total).
    if (attempt >= 2 || !isTransientError(err)) throw err;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt)); // 800ms, 1600ms
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  const candidate = data.candidates?.[0];
  const out = (candidate?.content?.parts ?? [])
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");

  // NÃO devolver "" em silêncio: um texto vazio vira `null` no parse e o app o trata como
  // "nada a fazer" (falso "já avaliado"/"nada a mudar"). Se o Gemini cortou a geração
  // (`MAX_TOKENS`, `SAFETY`, …) ou bloqueou o prompt, lançamos um erro com o motivo real —
  // que sobe aos logs e ao toast do usuário.
  if (!out.trim()) {
    const finish = candidate?.finishReason;
    const block = data.promptFeedback?.blockReason;
    const why = block ? `blockReason=${block}` : `finishReason=${finish ?? "desconhecido"}`;
    throw new Error(`Gemini não retornou texto (${why})`);
  }
  return out;
}

// --- Adaptador Groq (OpenAI-compatível, via REST) ------------------------------------------

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

async function runGroq(req: AiRequest, model: string): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("GROQ_API_KEY ausente");

  const userContent: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  // O Groq aceita data URL ou URL pública (ele mesmo baixa) — só repassa URL que passa no filtro SSRF.
  if (req.image && (req.image.startsWith("data:image/") || isSafeImageUrl(req.image))) {
    userContent.push({ type: "image_url", image_url: { url: req.image } });
  }
  userContent.push({ type: "text", text: req.text });

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: userContent },
    ],
    max_tokens: req.maxTokens,
    temperature: 0.2,
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
  });

  // Mesmo retry com backoff do Gemini para erros transitórios (5xx); 429 (limite do free tier)
  // não é re-tentado aqui — sobe como quota e o `runText` faz failover para o próximo provedor.
  let resp: Response;
  for (let attempt = 0; ; attempt += 1) {
    resp = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
    });
    if (resp.ok) break;
    const detail = await resp.text().catch(() => "");
    const err = new Error(`Groq HTTP ${resp.status}: ${detail.slice(0, 300)}`) as Error & {
      status?: number;
    };
    err.status = resp.status;
    if (attempt >= 2 || !isTransientError(err)) throw err;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const out = choice?.message?.content ?? "";
  // Nunca devolver "" em silêncio (viraria "nada a fazer" no parse) — ver `runGemini`.
  if (!out.trim()) {
    throw new Error(
      `Groq não retornou texto (finishReason=${choice?.finish_reason ?? "desconhecido"})`,
    );
  }
  return out;
}

// --- Orquestração: geração de texto com failover -------------------------------------------

async function runOne(
  req: AiRequest,
  provider: AiProvider,
  geminiModel?: string,
): Promise<{ text: string; model: string }> {
  if (provider === "anthropic") {
    const model = await resolveAnthropicModel();
    return { text: await runAnthropic(req, model), model };
  }
  const model = providerModel(provider, geminiModel);
  if (provider === "groq") return { text: await runGroq(req, model), model };

  return { text: await runGemini(req, model), model };
}

/** Rótulo curto do provedor pra mensagem de erro (evita puxar `ai-provider.ts` client-safe). */
function providerLabel(provider: AiProvider): string {
  if (provider === "gemini") return "Gemini";
  return provider === "groq" ? "Groq" : "Claude";
}

/** Resume o motivo de uma falha numa frase curta e legível pro usuário final. */
function attemptErrorMessage(error: unknown): string {
  if (isQuotaError(error)) return "sem créditos/quota";
  if (isTransientError(error)) return "indisponível no momento (tente de novo em instantes)";
  const msg = (error as Error)?.message || String(error);
  return msg.slice(0, 200);
}

/**
 * Gera texto no provedor pedido; se ele falhar por **quota/sem créditos** OU por
 * **indisponibilidade transitória** (ex.: 503 "high demand" do Gemini) e houver outro provedor
 * configurado, **troca automaticamente** e tenta nele — na ORDEM CANÔNICA dos provedores
 * (`AI_PROVIDERS`, hoje Claude → Gemini → Groq; dá pra crescer a lista sem mexer nesta função). No
 * caso do Gemini, ANTES de trocar de provedor por quota, `runOne` já tenta um downgrade para o
 * Flash-Lite (cota gratuita própria) — só cai pro Claude se o downgrade também falhar.
 * Cada provedor pulado (sem chave) ou que falhou vira uma entrada clara em `attemptErrors`,
 * pra UI mostrar o passo a passo ("Claude: sem chave de API configurada" → "Gemini: sem
 * créditos/quota" → sucesso no próximo, se houver). Outros erros (400/401/403, prompt
 * bloqueado, parsing) propagam de imediato (o chamador trata por-item). Lança se nenhum
 * provedor atender, com a mensagem juntando o motivo de cada tentativa.
 * `geminiModel` é a escolha do usuário pro Gemini (ver `resolveGeminiModel`); só é usada
 * quando o provedor efetivamente tentado é o Gemini (no pedido OU no failover).
 */
export async function runText(
  req: AiRequest,
  provider: AiProvider,
  geminiModel?: string,
): Promise<RunTextResult> {
  // Ordem de tentativa: o pedido primeiro, depois os demais na ordem canônica (failover).
  const order = [
    provider,
    ...configuredProviders().filter((p) => p !== provider),
    ...PROVIDER_ORDER.filter((p) => p !== provider && !providerConfigured(p)),
  ];
  const attemptErrors: Partial<Record<AiProvider, string>> = {};

  for (let i = 0; i < order.length; i += 1) {
    const p = order[i]!;
    if (!providerConfigured(p)) {
      attemptErrors[p] = "sem chave de API configurada";
      console.error(`[ai-provider] ${providerLabel(p)} sem chave de API configurada — pulando`);
      continue;
    }
    try {
      const { text, model } = await runOne(req, p, p === "gemini" ? geminiModel : undefined);
      return { text, provider: p, model, switched: p !== provider, attemptErrors };
    } catch (error) {
      // Troca de provedor por quota/sem créditos OU indisponibilidade transitória; senão propaga.
      if (!isQuotaError(error) && !isTransientError(error)) throw error;
      attemptErrors[p] = attemptErrorMessage(error);
      console.error(
        `[ai-provider] ${providerLabel(p)} indisponível (quota/transitório) — tentando failover`,
        error,
      );
    }
  }

  const trail = order
    .map((p) => `${providerLabel(p)}: ${attemptErrors[p] ?? "erro desconhecido"}`)
    .join(" · ");
  throw new Error(`Nenhum provedor de IA atendeu — ${trail}`);
}

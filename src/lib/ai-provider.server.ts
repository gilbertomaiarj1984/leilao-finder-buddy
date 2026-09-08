/**
 * Camada PLUGÁVEL de provedores de IA (server-only). Abstrai a chamada de geração de
 * texto para que o resto do app não saiba QUAL modelo está atendendo. Hoje há dois:
 *
 * - **anthropic** (Claude) — via `@anthropic-ai/sdk` (Messages + Batches API).
 * - **gemini** (Google) — via REST (`generativelanguage.googleapis.com`), sem SDK/dep nova.
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
export type AiProvider = "anthropic" | "gemini";

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
export type RunTextResult = {
  text: string;
  provider: AiProvider;
  model: string;
  /** true quando o provedor pedido falhou por quota e o failover atendeu com outro. */
  switched: boolean;
};

// --- Configuração por provedor (chave de env + modelo, com override por env) ---------------

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

/** Modelo efetivo do provedor (override por env, senão o padrão barato). */
export function providerModel(provider: AiProvider): string {
  if (provider === "gemini") return process.env["GEMINI_MODEL"] || GEMINI_DEFAULT_MODEL;
  return process.env["ANTHROPIC_MODEL"] || ANTHROPIC_DEFAULT_MODEL;
}

/** Nome da env com a chave de API do provedor. */
function providerKeyEnv(provider: AiProvider): string {
  return provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

/** true quando o provedor tem chave de API configurada no ambiente. */
export function providerConfigured(provider: AiProvider): boolean {
  return Boolean(process.env[providerKeyEnv(provider)]);
}

/** Lista de provedores com chave (na ordem canônica). */
export function configuredProviders(): AiProvider[] {
  return (["anthropic", "gemini"] as AiProvider[]).filter(providerConfigured);
}

/** true quando ao menos um provedor está configurado (senão a IA faz no-op). */
export function anyProviderConfigured(): boolean {
  return configuredProviders().length > 0;
}

/**
 * Só a Anthropic tem Batches API nativa (assíncrona, ~50% mais barata) usada pelo cron.
 * O Gemini roda de forma síncrona no cron (ver `cron.server.ts`).
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
export function isTransientError(error: unknown): boolean {
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
  { type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } };

/** Converte a requisição neutra no formato de mensagem da Anthropic (Messages/Batches). */
export function toAnthropicMessageParams(req: AiRequest, model: string) {
  const content: AnthropicBlock[] = [];
  // A imagem vem ANTES do texto (recomendação da API de visão).
  if (req.image) content.push({ type: "image", source: { type: "url", url: req.image } });
  content.push({ type: "text", text: req.text });
  return {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user" as const, content }],
  };
}

/** Extrai o texto concatenado dos blocos `text` de uma resposta da Anthropic. */
function anthropicText(message: { content?: Array<{ type: string; text?: string }> }): string {
  return (message?.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

async function runAnthropic(req: AiRequest, model: string): Promise<string> {
  const client = await getAnthropicClient();
  const message = await client.messages.create(toAnthropicMessageParams(req, model));
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
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const type = (resp.headers.get("content-type") || "").split(";")[0]?.trim();
    const mimeType = type && type.startsWith("image/") ? type : "image/jpeg";
    const buf = Buffer.from(await resp.arrayBuffer());
    // Evita estourar payload/limite: capas muito grandes são descartadas (raro).
    if (buf.byteLength > 6 * 1024 * 1024) return null;
    return { mimeType, data: buf.toString("base64") };
  } catch {
    return null;
  }
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
    resp = await fetch(url, init);
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

// --- Orquestração: geração de texto com failover -------------------------------------------

async function runOne(req: AiRequest, provider: AiProvider): Promise<string> {
  const model = providerModel(provider);
  return provider === "gemini" ? runGemini(req, model) : runAnthropic(req, model);
}

/**
 * Gera texto no provedor pedido; se ele falhar por **quota/sem créditos** OU por
 * **indisponibilidade transitória** (ex.: 503 "high demand" do Gemini) e houver outro provedor
 * configurado, **troca automaticamente** e tenta nele. Outros erros (400/401/403, prompt
 * bloqueado, parsing) propagam (o chamador trata por-item). Lança se nenhum provedor atender.
 */
export async function runText(req: AiRequest, provider: AiProvider): Promise<RunTextResult> {
  // Ordem de tentativa: o pedido primeiro, depois os demais configurados (failover).
  const order = [provider, ...configuredProviders().filter((p) => p !== provider)];
  let lastError: unknown = null;

  for (let i = 0; i < order.length; i += 1) {
    const p = order[i]!;
    if (!providerConfigured(p)) continue;
    try {
      const text = await runOne(req, p);
      return { text, provider: p, model: providerModel(p), switched: p !== provider };
    } catch (error) {
      lastError = error;
      // Troca de provedor por quota/sem créditos OU indisponibilidade transitória; senão propaga.
      if (!isQuotaError(error) && !isTransientError(error)) throw error;
      console.error(
        `[ai-provider] ${p} indisponível (quota/transitório) — tentando failover`,
        error,
      );
    }
  }
  throw lastError ?? new Error("Nenhum provedor de IA configurado");
}

# IA — referência das APIs (Claude, Gemini, Groq)

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Mecânica do app (failover, cron, seletor) fica em `docs/areas/ia.md`; aqui é só o que as
> **APIs dos provedores** dizem e o que o app faz com isso. Dados conferidos nas documentações
> oficiais em **25/out/2026** — preços, limites e catálogo mudam: **reconfira antes de decidir**
> (links no fim). Onde algo veio de testes em produção, está marcado.

## Como o app chama cada provedor

|                 | Claude (Anthropic)                                           | Gemini (Google)                                                        | Groq                                                                                     |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Código          | `runAnthropic` (SDK `@anthropic-ai/sdk`, Messages + Batches) | `runGemini` (REST)                                                     | `runGroq` / `runGroqWithImage` (REST OpenAI-compatível)                                  |
| Endpoint        | SDK                                                          | `generativelanguage.googleapis.com/v1beta/models/{id}:generateContent` | `api.groq.com/openai/v1/chat/completions`                                                |
| Auth            | `ANTHROPIC_API_KEY`                                          | `GEMINI_API_KEY` (header `x-goog-api-key`)                             | `GROQ_API_KEY` (`Authorization: Bearer`)                                                 |
| Modelo padrão   | `claude-haiku-5-5` (`ANTHROPIC_MODEL`)                       | `gemini-3.1-flash-lite` (`GEMINI_MODEL`, UI)                           | `openai/gpt-oss-120b` (`GROQ_MODEL`); com capa: `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`) |
| Imagem (capa)   | bloco `image` (URL ou base64)                                | **inline base64** (a API não busca URL)                                | `image_url` com URL pública ou `data:`; só no modelo de visão                            |
| JSON            | prompt pede JSON                                             | `responseMimeType: application/json`                                   | `response_format: {type: "json_object"}`                                                 |
| Lote assíncrono | **Batches API** (-50%), usada pelo cron                      | não usada (síncrono)                                                   | não usada (síncrono)                                                                     |
| Quota estourada | 429/402 → failover                                           | 429 `RESOURCE_EXHAUSTED` → failover                                    | 429 → failover                                                                           |

Failover e retry: ver `ia.md` (`isQuotaError`, `isTransientError`, `runText`). 400/404 **não** fazem
failover (propagam) — id de modelo errado quebra a chamada; no Groq com capa, o 400/404 do modelo
de visão cai para o modelo de texto.

## Claude (Anthropic)

- **Catálogo (docs de modelos, out/2026):** `claude-fable-5-1` ($10/$50 por 1M tok in/out),
  `claude-opus-5-5` ($4/…), `claude-sonnet-5-5` ($2/$10), **`claude-haiku-5-5` (a partir de
  $0,10/$0,50)**. Haiku 5.5: contexto 1M, saída máx. 128K, pensamento _adaptive_ (esforço padrão
  `medium`), aposentadoria "não antes de 7/out/2027".
- **Preço:** Batches API = **50% de desconto**; leitura de cache = 10% do preço de entrada (5% no
  Sonnet/Opus 5.5). Haiku 5.5: $0,10/$0,50 até 100K tokens de prompt, acima disso $0,50/$2,50 (nota
  do app; confira a página de preços).
- **O app desliga o raciocínio no Haiku** (`thinking: {type: "disabled"}` em
  `toAnthropicMessageParams`) para não pagar saída "pensando" numa tarefa de extrair JSON.
- **Rate limit:** por classe de modelo, em RPM, ITPM (tokens de entrada/min) e OTPM. Só tokens
  **não cacheados** contam no ITPM (`cache_read_input_tokens` não conta, exceto Haiku 3.5). 429
  traz `retry-after`; limite de gasto mensal do tier também devolve 429, mas **sem** `retry-after`
  (retentar não adianta até o mês virar).
- **Sem créditos:** erro "credit balance is too low" → `isQuotaError` dispara o failover.
- Timeout síncrono do app: 60 s (`AI_CALL_TIMEOUT_MS`).

## Gemini (Google)

- **Catálogo estável (docs de modelos):** `gemini-3.8-flash`, `gemini-3.6-flash`,
  **`gemini-3.5-flash-lite`**, **`gemini-3.1-flash-lite`**; prévias: `gemini-3.1-pro-preview`,
  `gemini-3-flash-preview`. A geração **2.5** só atende quem já a usava ("não deprecated", mas
  restrita); `gemini-2.5-flash-image` desliga em 2/out/2026.
- **Preço pago (por 1M tok, in/out):** `3.1-flash-lite` $0,25/$1,50 (batch $0,125/$0,75);
  `3.5-flash-lite` $0,30/$2,50 (batch $0,15/$1,25). Saída inclui tokens de "thinking". **Free
  tier: gratuito**, mas "usado para melhorar os produtos" do Google (no pago, não).
- ⚠️ A doc lista `gemini-3.5-flash-lite` como estável, mas o app ainda o marca como "não testado"
  (v0.69.2 deu 400 em ids "prováveis"). Teste uma chamada real antes de torná-lo padrão. Regra do
  projeto: **só adicionar id que a API aceitou de verdade**.
- **Rate limit:** RPM, TPM (entrada) e RPD, **por projeto** (não por chave); RPD zera à meia-noite
  do Pacífico. Tiers: Free → Tier 1 (cobrança ativa) → Tier 2 ($100 pagos + 3 dias) → Tier 3
  ($1.000 + 30 dias). Valores exatos por modelo só no AI Studio (`aistudio.google.com/rate-limit`).
  Limite por gasto (rolling 10 min) não vale no Free.
- **Thinking:** `thinkingBudget: 0` é _best-effort_; o app dá folga `maxOutputTokens =
max(maxTokens + 4096, 8192)` e lança erro (não devolve `""`) se vier `finishReason`
  `MAX_TOKENS`/`SAFETY` ou `blockReason`.
- 503 `UNAVAILABLE` "high demand" é comum → retry com backoff (800 ms, 1,6 s) e depois failover.

## Groq

- **Modelos (docs, out/2026):** produção: `openai/gpt-oss-120b` ($0,15/$0,60), `openai/gpt-oss-20b`
  ($0,075/$0,30), `llama-3.1-8b-instant`/`llama-3.3-70b-versatile` (enterprise), Whisper. Prévia:
  **`qwen/qwen3.8-27b`** ($0,80/$4,00), `openai/gpt-oss-safeguard-20b`, `meta-models/muse-spark-open`
  e `minimaxai/minimax-m2.7` (enterprise), Prompt Guard, Orpheus (voz).
- **Catálogo por conta:** `GET https://api.groq.com/openai/v1/models` com a chave (foi assim que se
  achou o 404 do Scout). Hoje o **Llama 4 Scout e o Qwen3-32B estão descontinuados** (17/jul/2026;
  substituto indicado: `gpt-oss-120b`/`qwen3.6-27b`).
- **Visão:** só `qwen/qwen3.8-27b` (aberto) e `muse-spark-open` (limitado). Qwen3.8: até **3 imagens**
  por requisição, URL ≤ **20 MB** (acima → 400), cada imagem = **2048 tokens** de entrada. gpt-oss é
  **só texto** (400 se receber imagem).
- **Free tier (limites por modelo):** `gpt-oss-120b`, `gpt-oss-20b` e `qwen3.8-27b` = **30 RPM,
  1.000 req/dia, 8.000 tokens/min, 200.000 tokens/dia**. 8K TPM é o gargalo: uma avaliação com
  contexto (~1,5–3K tokens + saída) já ocupa boa parte do minuto, e uma capa soma 2.048. O app
  roda a análise sob demanda com concorrência 4 — no Groq isso pode estourar o TPM e cair no
  failover (429 traz `retry-after` em segundos; cabeçalhos `x-ratelimit-*` mostram o restante).
  Plano Developer sobe os limites e libera Batch/Flex.
- **Raciocínio (`reasoning_effort`):** Qwen3.8 aceita `none` (sem raciocínio), `default`, `low`…
  ; gpt-oss aceita `low|medium|high` (e **não** aceita `none`); `reasoning_format` **não** existe
  para gpt-oss (use `include_reasoning: false`, que é mutuamente exclusivo com `reasoning_format`).
  Em JSON mode o formato padrão já é `parsed`/`raw` e **`raw` explícito dá 400**. O app manda
  `reasoning_effort: low` (gpt-oss) / `none` (Qwen) e dá +2048 de `max_tokens` só ao gpt-oss, porque
  o raciocínio conta no teto e pode deixar `content` vazio.
- **JSON mode:** `response_format: {type: "json_object"}` (o prompt precisa mencionar JSON);
  suportado por Qwen3.8 e gpt-oss.
- Parâmetros úteis: `max_completion_tokens` (padrão 1024 — baixo p/ raciocínio), `temperature`
  (padrão 0,6; o app usa 0,2).

## Comparativo rápido para decidir o provedor

| Necessidade                  | Melhor opção hoje                                                               |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Ler a capa com mais precisão | Claude Haiku 5.5 ou Gemini (visão nativa)                                       |
| Custo zero                   | Gemini free tier (dados usados p/ treino) ou Groq free (8K TPM)                 |
| Lote grande no cron          | Claude **Batches** (-50%)                                                       |
| Mais barato pago             | Haiku 5.5 ≈ $0,10/$0,50 · gpt-oss-20b $0,075/$0,30 · 3.1 Flash-Lite $0,25/$1,50 |

## Onde reconferir (docs oficiais)

- Anthropic: `platform.claude.com/docs/en/about-claude/models/overview`, `…/api/rate-limits`, `…/pricing`.
- Gemini: `ai.google.dev/gemini-api/docs/models`, `…/pricing`, `…/rate-limits`, `…/deprecations`.
- Groq: `console.groq.com/docs/models`, `…/vision`, `…/reasoning`, `…/rate-limits`, `…/deprecations`
  (todas aceitam o sufixo `.md` para texto puro).
- Ao mudar modelo padrão/preços no app, atualize `ai-provider.ts` (rótulos), `ai-provider.server.ts`
  (padrões), `.env.example` e este arquivo.

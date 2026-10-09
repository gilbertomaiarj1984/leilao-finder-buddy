# IA — avaliação, identificação, modo e provedores

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## IA (avaliação, identificação, modo)

**Multi-provedor (v0.27.0):** o app usa **Claude (Anthropic)** OU **Gemini (Google)** — camada
plugável em **`ai-provider.server.ts`** (+ metadados client-safe em `ai-provider.ts`). Modelos
baratos por padrão: **`claude-haiku-5-5`** (`ANTHROPIC_API_KEY`, override `ANTHROPIC_MODEL`) e
**`gemini-3.1-flash-lite`** (`GEMINI_API_KEY`, override `GEMINI_MODEL`, mas a UI tem
precedência — ver bullet do seletor de modelo abaixo). **Opcional:** sem NENHUMA
chave, tudo faz **no-op** e o app segue normal (`aiConfigured` = "qualquer provedor").

- **`runText(req, provider)`** é o ponto único: recebe uma requisição NEUTRA (`AiRequest`:
  system + texto + imagem opcional) e devolve `{text, provider, model, switched}`. Adaptadores:
  Anthropic via `@anthropic-ai/sdk` (`messages.create`); Gemini via **REST**
  (`generativelanguage.googleapis.com/v1beta`, header `x-goog-api-key`, sem dep nova) — como o
  Gemini **não** busca URL de imagem, a capa é baixada e enviada **inline (base64)**; usa
  `responseMimeType:json` e `thinkingConfig.thinkingBudget:0` (tenta desligar o "thinking").
  - ⚠️ **Gemini "não retorna nada" (corrigido v0.28.1):** o `thinkingBudget:0` NÃO é confiável
    no alias `gemini-flash-latest` (hoje um flash mais novo) — o modelo gasta o orçamento de
    saída "pensando" e estoura o teto **antes de emitir a resposta** (`finishReason:MAX_TOKENS`
    com `parts` vazio), o que virava `""` → parse `null` → app tratava como "nada a fazer"
    (falso "já avaliado" / "nada a mudar"). Correções em `runGemini`: (1) **folga de orçamento**
    `maxOutputTokens = max(req.maxTokens + 4096, 8192)`; (2) **não devolver `""` em silêncio** —
    inspeciona `candidates[0].finishReason` / `promptFeedback.blockReason` e **lança erro** com o
    motivo real. O descritivo da coleção subiu para `maxTokens:4096` (`buildCollectionRequest`).
- **Failover automático por quota OU indisponibilidade transitória** (v0.28.2): dispara em
  `isQuotaError` (429/402/"credit balance"/…) **e** `isTransientError` (500/502/503/504,
  "unavailable"/"overloaded"/"high demand"/"try again"/"timeout"). O provedor pedido falha →
  tenta o outro configurado; `switched`/`served` sobem à UI (toast "X indisponível — usei Y").
  Além disso, `runGemini` faz **retry com backoff** (3 tentativas: 800ms, 1600ms) para erros
  transitórios ANTES de propagar — útil quando o Gemini é o único provedor. Motivo real:
  `503 UNAVAILABLE "This model is currently experiencing high demand"` do `gemini-flash-latest`.
  Erros não-transitórios/não-quota (400/401/403, prompt bloqueado, parsing) propagam (por-item).
- **Downgrade de modelo dentro do Gemini antes do failover de provedor:** quando o Gemini
  escolhido/configurado bate em `isQuotaError`, `runOne` tenta primeiro
  **`GEMINI_FREE_FALLBACK_MODEL`** (`gemini-2.5-flash-lite`, cota gratuita própria, mais barato
  que o padrão de fábrica) antes de desistir do Gemini e cair pro Claude — evita queimar o
  Claude quando o problema é só a cota diária do modelo escolhido (ex.: usuário travou
  `gemini-flash-latest` e ele estourou quota — tenta o Flash-Lite 2.5 antes de ir pro Claude).
  Só propaga (e aciona o failover de provedor do `runText`) se o Flash-Lite 2.5 também falhar
  por quota, ou se o modelo pedido já era ele mesmo (sem loop).
- **Provedor PADRÃO** persistido em `app_state.ai_provider` (`getAiProvider`/`setAiProvider`;
  precedência: `app_state` → env `AI_PROVIDER` → `anthropic`). **Seletor único no header**
  (`AiProviderSelect`, na home, Coleção e Vinil Analytics) — é a **ÚNICA** forma de escolher a
  IA. Todo recurso do site usa esse provedor: os síncronos sob demanda leem o `aiProvider` do
  seletor no cliente; os assíncronos (cron) e as rotinas de servidor leem `resolveAiProvider()`
  (o padrão em `app_state`). **NÃO existe mais o diálogo "qual IA usar?"** por ação
  (`AiProviderDialog`/`useAiProviderPicker` foram removidos no v0.41.0 — a seleção por ação se
  confundia; agora só o topo decide).
- **Caixa única de IA + modelo (v0.121.0):** `AiModelSelect` (`ai-provider-controls.tsx`)
  substitui `AiProviderSelect` + `GeminiModelSelect` nas 3 telas (home/Coleção/Analytics).
  Um Select agrupado por provedor, cada opção com preço (US$/1M tok in/out); escolher grava
  provedor (`ai_provider`) + modelo daquele provedor (`gemini_model` / **`anthropic_model`**, novo,
  em `app_state`) e o componente cuida das queries sozinho. Opções (`ai-provider.ts`):
  Claude **só Haiku 5.5** $0,10/$0,50 (≤100K tok de prompt; **padrão**; roda com `thinking:
  disabled` pra não gastar saída pensando) — o Haiku 4.5 ($1/$5) foi removido por custo (v0.121.1), valor salvo/env de 4.5 cai no 5.5;
  Gemini Flash-Lite 3.1 $0,25/$1,50 (**padrão**, o mais barato sem prazo de desligamento) e
  Flash-Lite 3.5 ~$0,30/$2,50 (⚠️ id vindo de fontes públicas, **não testado** — se der 400,
  volte pro 3.1). Saíram: `gemini-2.5-flash-lite` (desliga 16/out/2026; segue só como downgrade
  interno de quota, e se ele falhar o erro ORIGINAL é propagado pro failover) e
  `gemini-flash-latest` (o mais caro). Valor salvo fora da lista cai no padrão. O modelo do Claude é
  lido por `resolveAnthropicModel` (cache de 30s) tanto no síncrono quanto nos batches. Footer
  global sem rolagem horizontal (controles quebram linha; "Atualizado" fica junto da versão).
- **Modelo do Gemini escolhível (v0.69.2, lista corrigida no v0.69.4):** `GeminiModelSelect`
  (`ai-provider-controls.tsx`), ao lado do `AiProviderSelect` nas mesmas 3 telas — sempre
  visível, mesmo com Claude escolhido (o failover por quota pode acabar caindo no Gemini).
  Lista `GEMINI_MODELS`/`GEMINI_MODEL_LABELS` (`ai-provider.ts`), do MAIS BARATO pro MAIS CARO:
  `gemini-2.5-flash-lite` $0,10/$0,40 (mais barato, mas desliga em 16/out/2026 — geração 2.5
  inteira), `gemini-3.1-flash-lite` $0,25/$1,50 (**padrão de fábrica**, sem prazo de
  desligamento anunciado), `gemini-flash-latest` ~$0,75/$3,75 (alias histórico, mais caro).
  ⚠️ **v0.69.2 tentou uma lista de 6 ids** (`gemini-flash-lite-latest`, `gemini-3.1-flash-lite`,
  `gemini-3.5-flash-lite`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.1-pro`) escolhidos
  por busca na web (aggregators de preço, não a doc oficial). Testado em produção pelo usuário
  no mesmo dia: `gemini-flash-lite-latest` (o padrão escolhido) e `gemini-3.5-flash-lite`
  voltam **400 INVALID_ARGUMENT** (não existem de verdade pra API) — quebrou a análise por IA
  até o usuário reportar o toast de erro; `gemini-3.1-flash-lite` funciona (confirmado
  rodando); os outros três nunca foram testados. **Lição:** nome de modelo "provável" achado
  em busca na web não é confiável — 400 (não-quota/não-transitório) propaga direto sem
  failover, então um id inventado quebra a chamada sem aviso prévio. v0.69.4 reverteu a lista
  pra só os TRÊS ids confirmados citados acima; **não adicionar um novo sem testar contra a
  API de verdade primeiro**. Persistido em `app_state.gemini_model` (`getGeminiModel`/
  `setGeminiModel` em `app-state.server.ts`, MESMO padrão de precedência do provedor:
  `app_state` → env `GEMINI_MODEL` → padrão de fábrica). Resolvido UMA VEZ por rodada síncrona
  (não por lote) via `resolveGeminiModel()` (`ai-eval.server.ts`, mesmo padrão de
  `resolveAiProvider`) dentro de cada função `*Sync` — os chamadores (rotas sob demanda, cron,
  `lot-condition`/`lot-sales`) não precisaram mudar. `runText`/`runOne` ganharam um 3º
  parâmetro opcional `geminiModel` que só é usado quando o provedor efetivamente tentado
  (pedido OU failover) é o Gemini.
- **Cron:** Claude usa **Batches** (assíncrono, ~50% mais barato); Gemini roda **síncrono** em
  bloco (`GEMINI_SYNC_CAP`, o laço do cron chama de novo até esgotar). Se o Claude estiver sem
  créditos no `submit`, o cron cai para o Gemini síncrono.

- **Avaliação completa — `lot_ai`** (`ai-eval.server.ts` + `lot-ai.server.ts`): via **Batches
  API** (~50% do preço, assíncrona), **1 request por lote** (`custom_id = lots.id`). Cache por
  título (`title_hash` djb2→base36; só reavalia lote sem linha ou com título mudado,
  `selectLotsToEvaluate`). Saída: `score`(0-100), `rarity`(`comum`/`interessante`/`raro`/
  `muito_raro`), `deal`, `album` ("Artista - Álbum"), `reason`, `tags[]` (`parseEvalObject`,
  tolerante a cercas). **Visão:** capa http(s) vai como bloco `image` (antes do texto) para
  identificar o disco (`usableImage` descarta `data:`).
- **Identificação simples — `lot_ident`** (isolada da avaliação, **sem gate de modo**): passada
  **barata** que preenche só artista/álbum/ano em **toda a base**. Tabela `lot_ident` (`id`,
  `title_hash`, `album`, `year`, `confidence`, `source`, `model`). `buildIdentUserPrompt`/
  `parseIdentObject`; `selectLotsToIdentify` (passada por título), `selectLotsToReident` (baixa
  confiança + tem imagem → **escala para a capa**). Persistência `lot-ident.server.ts`; estado
  próprio `app_state.ai_ident_batch`. **Discogs usa o álbum mesclado** `lot_ai` (preferido) +
  `lot_ident`.
- **Tracklist — `lot_ai.tracklist` (jsonb `[{side, title, fame}]`), v0.124.0:** faixas e ordem vêm
  do **Discogs** (`GET /releases/{id}` → `fetchDiscogsTracklist` em `discogs.server.ts`, que acha o
  release com o mesmo `findRelease` do `fetchMarket` ou usa o `release_id` já casado em
  `lot_market`; `parseDiscogsTracklist` em `tracklist.ts`: ignora `heading`, expande `index`/
  `sub_tracks`, lado pela `position` "A1"→A). A IA **só classifica a fama** (`alta`/`media`/`baixa`
  → verde/amarelo/vermelho) e **não precisa rodar junto**: duas etapas independentes em
  `tracklist-step.server.ts` — `step=tracklist` (Discogs, sem IA; exige `DISCOGS_TOKEN`; lotes com
  `day_key >=` hoje, `lot_ai.album` e `tracklist` NULL; `[]` = Discogs não achou, nunca cai para
  faixas da IA) grava com `fame: null`; `step=fame` (IA, `buildFamePrompt`/`parseFameText`, uma
  consulta por álbum, só nas listas com `fame` null — `needsFame`) preenche a fama quando a IA é
  acionada (ambos no `refresh.yml`). Faixa sem fama aparece com bolinha cinza no `TracklistHover`.
  A avaliação completa **não pede mais tracklist** (`maxTokens` 1200→600) e `upsertLotAi` não zera
  a existente. **Migração única** (`app_state.tracklist_discogs_migrated`): as tracklists antigas
  (geradas pela IA, erradas) de `lot_ai` e `collection_items` foram zeradas para refazer pelo Discogs.
  Normalização/agrupamento puros em `tracklist.ts`; UI em `tracklist-hover.tsx`.
- **Lote sem nota (v0.112.0):** o `LotCard` mostra `EvaluateCornerButton` (✨, onde ficaria o selo) que chama `reevaluateLot`; resposta ilegível da IA conta como `failed` em `evalLotsSync` e o toast de `analyzeOnDemand` distingue escopo vazio (login) de "tudo já avaliado".
- **Modo automático — chave `ai_mode`** (`getAiMode`/`setAiMode`): `"off" | "all" | "watched"`,
  **padrão `"watched"`** (econômico). No `step=aieval`: `off` não coleta/submete; `all` = todos
  os lotes; `watched` = só lotes vigiados ∪ com lance (ids de `listWatchedFromSite` +
  `listMyBidsFromSite`).
- **Vigiados fora da varredura:** lotes de `listWatchedFromSite`/`listMyBidsFromSite` ausentes de `scrapeVinylLots` entram como candidatos no `step=aieval` e no botão "Analisar vigiados" (`analyzeOnDemand({watched:true})`), senão nunca teriam `lot_ai`.
- **Análise sob demanda** (síncrona): `evalLotsSync(lots, provider)` usa `runText`
  (concorrência 4, com failover) — não a Batches. Server fn
  `analyzeOnDemand({day, house?, max, provider?})` avalia só os não avaliados (até `max`=25) e
  devolve `{evaluated, remaining, served, switched}` para o cliente repetir em laço. Roda **em
  qualquer modo**, inclusive com a IA desligada. UI: botões "Analisar dia" / "Analisar" (casa)
  perguntam o provedor antes; `Select` de modo + `Select` de provedor no header.
- **`matchesInterests` é da UI, NÃO da IA:** `buildInterestMatcher` (`ai-score-utils.ts`) casa
  a lista `app_state.user_interests` com o título via `normalizeForMatch` (determinístico,
  não gasta tokens); destaca com ⭐.
- **Nota acompanha o preço — `lot_ai.eval_price` (v0.88.0):** a nota mistura raridade +
  OPORTUNIDADE, então uma nota dada com o lote a R$ 5 ficava otimista depois que os lances o
  levavam a R$ 100. `eval_price` guarda o preço usado na avaliação (sync: `parsePrice(lot.price)`;
  Batches: `prices` gravado junto dos `hashes` em `app_state.ai_batch`). `priceRoseSinceEval`
  (`ai-reprice.ts`, client-safe): reavalia quando o preço atual ≥ `eval_price` × 1,2 **e** subiu
  ≥ R$ 10 (`eval_price` null = avaliação antiga → reavalia 1× se houver preço). Só para
  VIGIADOS + LANCES, por dois caminhos: (1) **cron `step=aieval`** — `selectLotsToEvaluate(...,
  repriceIds)` com os ids de vigiados ∪ lances (lidos agora em qualquer modo, não só "watched");
  (2) **cliente** (`index.tsx`, efeito após o `lot-details`) — com o valor AO VIVO do `peca.asp`
  (o cron defasa e perde o lote quando o pregão entra ao vivo), manda os lotes que subiram para
  a server fn `repriceLotAi` (≤10 por chamada; o servidor RECONFERE contra `eval_price`, só
  reavalia lote que já tem avaliação, respeita o modo "off") e grava as linhas no cache
  `["lot-ai"]`. Cada `id|preço` é tentado 1× por sessão; pregões de dias passados são ignorados.
  O painel da nota mostra "Avaliado a: R$ X".
- **Refazer consulta por lote (v0.60.0):** botão "refazer consulta" no painel de detalhes da
  nota (`ScoreDetails`, aberto ao passar o mouse/focar o selo — `ScoreCorner` nos cards,
  `ScoreBadge` nas tabelas da Análise). Server fn `reevaluateLot({id, title, price, house,
image})` chama `evalLotsSync` **direto** (ignora o cache por `title_hash` — é justamente
  para reavaliar com base em informação nova do lote, ex.: imagem trocada) e faz
  `upsertLotAi([row])`. Provedor: o PADRÃO do usuário (`resolveAiProvider`/`getAiProvider`).
  Self-contained em `ai-score.tsx` (`ReevaluateButton`): `useMutation` grava a linha devolvida
  direto no cache `["lot-ai"]` (mesmo padrão da edição de tags) — sem invalidar/reler tudo, o
  card/linha atualizam sozinhos. Só aparece quando o chamador passa o prop `lot` (dados
  mínimos do lote); `CardLot.id` é opcional só por cautela de tipo (todo lote real tem id).

### Custo de referência

- **Custo Gemini (referência):** `gemini-flash-latest` ≈ US$0,75/US$3,75 por 1M tok in/out (mais
  barato que o Haiku 4.5); o alias `-latest` acompanha o Flash mais novo — para fixar, usar
  `GEMINI_MODEL`.

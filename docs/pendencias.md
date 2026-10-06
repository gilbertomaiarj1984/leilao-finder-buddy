# Pendências em aberto

> Só o que ainda está em aberto. Ao resolver um item, mova-o para
> `docs/arquivo/pendencias-resolvidas.md` (e registre a versão no `CHANGELOG.md`).

**Interface mobile — o que ficou fora da v1 (v0.108.0)** — referência: protótipo aprovado
(artefato "Garimpo Mobile Protótipo") e `docs/areas/ui.md`, seção "Interface mobile".

- **Não validado com dados reais no celular**: build, lint, typecheck e testes passam e a casca
  (barra, Menu, cabeçalho, navegação entre telas, cartão compacto/aberto em harness) foi
  conferida num navegador headless, mas sem banco/rede; falta o usuário abrir no celular com os
  dados de verdade (faixa de dias, Vigiados/Lances, cartão aberto) e reportar ajustes visuais.
- **Telas secundárias com o desenho do protótipo**: linha sticky única (filtros à esquerda,
  lupa/atualizar/⋯ à direita), folha de **Filtros** da Análise (hoje os filtros seguem em
  linha), folha ⋯ de ações (Sondagem/Interesses, Adicionar em massa, Varredura completa),
  botão flutuante "Adicionar disco" na Coleção, "Enviar para a coleção" em tela cheia em Compras,
  tabela do Analytics com 1ª coluna fixa. Hoje essas telas mantêm o cabeçalho atual (rolável).
- **Cartão aberto — Coleção inline**: a aba Coleção abre o `OwnedPanel` existente (fecha a folha
  antes); no protótipo o painel (confirmar/não tenho/buscar disco/termos negáveis) era inline.
  Idem Excluir: confirma na folha e abre o `ExcludeLotDialog` (motivo) existente.
- **Gestos**: deslizar para trocar de dia / de lote, puxar para atualizar, deslizar para
  desvigiar (sugestões do protótipo, não implementadas).
- **Casa em pregão sobe para o topo do dia** e a **faixa vermelha de andamento** (lote, peça x/y,
  %) em toda casa ao vivo: hoje usa o `AuctionStatusInline`/`LiveLotNow` já existentes no cabeçalho
  de cada casa (informação completa, layout do desktop quebrando linha); falta a faixa dedicada
  tocável que abre o presencial.
- **Tela "Ao vivo"**: filtros Todos/Ao vivo/Em breve/Encerrados e ordem fixa (ao vivo → em breve →
  encerrados) do protótipo.
- **Vigiados**: tiles de resumo (vigiando/ganhando/coberto) que filtram por toque, como no
  protótipo (hoje só os filtros por dia e os badges de status das casas).

**Roadmap — novos provedores de IA (avaliado, não iniciado)**

Avaliamos o repo `tashfeenahmed/freellmapi` (proxy **local** `localhost:3001`, OpenAI-compatible,
declaradamente _"not production"_) e **descartamos integrá-lo**: o app roda server-side em
nuvem/CI (cron), a camada de `ai-provider.server.ts` já faz o failover que ele promete, e passar
por um proxy local perderia a **Batches API** da Anthropic (~50% mais barata) do cron. O caminho
aderente é **acrescentar provedores à camada plugável que já existe** (`runText` + `AiProvider`).

- **Requisitos de um bom candidato** (da seção "IA"): (1) **API HTTPS direta** (sem proxy/
  localhost, roda no cron/Vercel); (2) **visão** — mandamos a capa (`image`) para identificar o
  disco; (3) **JSON mode** (`responseMimeType`/`response_format`); (4) **barato/free tier**
  (padrão hoje = Haiku/Flash); (5) **encaixe fácil** — REST simples (como o Gemini) ou
  OpenAI-compatible; (6) **bônus: Batch API** (hoje só a Anthropic; corta ~50% do custo do cron).
- ⭐ **Alavanca de arquitetura:** em vez de um adaptador por provedor, criar **UM adaptador
  "OpenAI-compatible" genérico** (base URL + key + model por env). Destrava Groq / OpenRouter /
  DeepSeek / Together / Cerebras de uma vez, mantendo o espírito plugável do `runText` — cada novo
  provedor vira "mais uma entrada de config", não código novo.
- **Opções ranqueadas:**
  1. **OpenRouter** — agregador **hospedado** (um key → muitos modelos, inclui `:free`),
     OpenAI-compatible, com modelos de visão. É a versão "usável em produção" da ideia do
     freellmapi; melhor jogada de **resiliência**. Con: modelos free instáveis, **sem batch**.
  2. **Groq** — OpenAI-compatible, **muito rápido**, free tier generoso; visão via Llama 4 /
     Llama 3.2; JSON mode. Melhor **failover gratuito** do dia a dia. Con: rate limit no free,
     catálogo de modelos muda.
  3. **Mistral (La Plateforme)** — REST nativo (igual ao padrão do Gemini), **Pixtral** (visão),
     JSON mode, **e Batch API (~50% off)** → único que replica o modelo de custo do cron da
     Anthropic. Melhor encaixe **"custo + batch"**.
  4. **Menções honrosas:** DeepSeek (barato, JSON, off-peak; visão fraca na API principal → mais
     texto), Together AI (muitos modelos open + visão + batch), Cloudflare Workers AI (free tier,
     visão via LLaVA, REST).

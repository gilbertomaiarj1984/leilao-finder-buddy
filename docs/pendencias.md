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

## Reaproveitar a resolução por IA de texto livre (achado na v0.122.0)

`addLookoutFromText` (`lookout-bulk.server.ts`) resolve uma linha livre em artista/álbum/ano + capa do
Discogs. A Sondagem (`wantlist-parse.ts`) e a importação de compras para a Coleção poderiam usar o
mesmo resolvedor (hoje cada uma tem o seu parse/busca de capa). Extrair para um módulo comum se
valer a pena.

## PWA — próximos passos (v0.137.0/v0.138.0)

- **Leitura offline da última visão** (ex.: Coleção/Vigiados no sebo sem sinal): exigiria cachear
  respostas de server functions (hoje deliberadamente fora, para não mostrar lance velho).
- **Share target**: receber link/texto compartilhado do celular (ex.: lote do LeilõesBR) para
  vigiar/adicionar em "De olho".
- **Push de fim de pregão** e "meu lance está ganhando/perdendo" em tempo real: o cron roda 4×/dia
  (`refresh.yml`), então o aviso de lance superado chega com atraso de horas. Para ser quase
  imediato precisaria de um agendador mais frequente só para `step=bidnotify` (cuidar da sessão
  única por origem no LeilõesBR).

## Discogs — frete e faixa BR (levantado em 15/10/2026)

- **Faixa BR com frete está morta:** a página de venda do Discogs devolve 403/Cloudflare ao servidor
  (testado do VPS com o release 555878). Caminhos a avaliar: ler o **inventário por vendedor** pela
  API (mapear vendedores brasileiros; não confirmado se traz o frete), `GET /marketplace/listings/{id}`
  (preço, frete e origem de um anúncio, mas exige o id), ou um serviço de scraping pago. Enquanto
  isso o veredicto usa o sugerido por condição (v0.141.0).
- **Cotação USD→BRL** derivada da própria API (razão `stats?curr_abbr=BRL` ÷ `curr_abbr=USD`):
  hoje tudo é BRL, então ainda não é preciso; guardar a taxa se algum preço em outra moeda entrar.
- **Sugerido vs. estado da capa:** a âncora usa só a condição da mídia; capa muito pior que o disco
  poderia descontar. Só vale com dado real de calibração (painel de IA planejado).
- **Painel de gestão da IA:** prévia navegável aprovada em linhas gerais (blocos de contexto
  arrastáveis, calibração, ordem do cron). Implementação depende da ordem de fases decidida com o
  usuário; mover `aieval` para depois de `aiident`/`market`/`condition`/`sales` no `refresh.yml` é
  pré-requisito para a IA enxergar esses dados.

## Painel de IA — correlação de condições (pedido em 15/10/2026)

Tabela visual e editável que relaciona o vocabulário dos leilões (siglas, "ótimo estado", "estado
regular", "riscos que afetam a audição"…) com a escala do Discogs (M, NM, VG+, VG, G+, G, F, P), no
mesmo painel do mercado Discogs. Base já pronta: `condition-text.ts` (regras `set`/`cap`) e
`discogs-price.ts` (`gradeToCondKey`). O painel só precisa persistir as regras em `app_state` e
carregá-las no lugar das constantes. Frete do leilão (R$ 25 Sudeste / R$ 35 demais) também vira
campo editável ali.

## IA — blocos de contexto ainda fora do prompt (fase 2, 15/10/2026)

- **Vendas passadas (B5):** feito na v0.148.0 (ver `docs/areas/ia.md`). Limite conhecido: lote sem
  identificação (`lot_ident`/`lot_ai.album`) e com título sem "Artista - Álbum" não casa com o Analytics.
- **Perfil do colecionador (B6):** feito na v0.149.0 (De olho + interesses; ver `docs/areas/colecao-sondagem-compras.md`);
  a Sondagem foi migrada e a tabela `wantlist_items` removida na v0.151.0.
- **Reavaliação quando o contexto chega depois:** o hash não leva flags de contexto; um lote avaliado
  antes de ter estado/Discogs só é refeito ao subir `PROMPT_VERSION` ou ao mudar o título. Com a nova
  ordem do cron isso deve ser raro; se incomodar, acrescentar flags grossas (`+e`, `+m`) ao hash.
- **Medir o efeito:** comparar notas antes/depois da v0.142.0 em um punhado de lotes conhecidos antes
  de reavaliar a base toda (a calibração do painel de IA é o lugar disso).

## Painel de IA — lacunas conhecidas (auditoria de 15/10/2026)

- **"Meus lances"** (`bid-house-sections.tsx` → `LotCard`) não recebe `market`, `ai` nem `condition`:
  lance sem nota/veredicto/estado. Ausência antiga, não da regra nova; passar `marketFor`/`aiFor`/
  `conditionFor` se quiser.
- **De olho** (`lookout-matches.server.ts`): `toLotMarket` cru, `deal: null` na notificação e faixa BR
  crua no e-mail. Aplicar `withConditionAnchor` + `marketDeal` como no resumo diário.
- **`ai.deal` gravado vs. "vs. mercado" calculado** aparecem lado a lado em `ai-score.tsx`/`analise.tsx`
  e podem divergir até a próxima reavaliação.
- O fallback de IA do estado (`conditionAiSync`) e a identificação não usam as regras do painel (só o
  regex usa).

## Revisão de código da IA — itens adiados (15/10/2026)

Achados da revisão que ficaram para depois (nenhum quebra nada hoje):

- **Duplicação:** pool de workers copiado em `evalLotsSync`/`identLotsSync*`/`conditionAiSync`/
  `identCollectionSync` (extrair `runPool`); `identLotsSync` ≈ `identLotsSyncRows`; "primeiro `{` até o
  último `}`" em 5 parsers (`extractJsonObject`); lista de modelos e padrão do Gemini em 4 lugares
  (`ai-models.ts`); faixas 0,7/1,15 no texto do prompt e em `marketDeal` (constantes); pipeline
  "condição em cache ou título → âncora" triplicado em home/Análise/diálogo do De olho (`useLotInsights()`).
- **Camadas:** `daily-digest.server.ts` e `lookout-ident.server.ts` importam `components/vinyl/ai-score-utils`;
  mover `parseAiAlbum`, `marketDeal`, `toLotMarket`, `withConditionAnchor` para `src/lib`.
- **Desempenho:** `marketFor`/`conditionFor` criam objeto novo por lote a cada render (anula
  `React.memo` do `LotCard`) → `useMemo` dos mapas `id → condição/mercado`; `getAllLotAi` traz o jsonb
  `tracklist` de todos os lotes (cron e cliente) → projetar colunas e carregar a tracklist sob demanda;
  regex estáticas em `grading.ts` (cada parse recompila 4-5); `getLotMarket` manda `basis` ao cliente.
- **Cron:** `AI_CONDITION_CAP=25` grava `indefinido` para quem passou do corte (nunca mais usa o
  fallback de IA); falha de catálogo reseleciona os mesmos leilões nas 40 voltas; `salesdebug` roda em
  toda execução; `sleep 60` mesmo no caminho Gemini síncrono; resultado `errored` de lote com capa
  morta é reenviado a cada rodada (tentar sem imagem).
- **`PROMPT_VERSION` manual:** editar `SYSTEM_PROMPT` sem subir o número deixa notas defasadas →
  derivar o hash do texto do prompt.
- **`basis` do Discogs** usa o texto cru da IA; `lot_ident` → `lot_ai` com álbum diferente reconsulta o
  Discogs → normalizar com `normalizeForMatch` e tirar o ano.
- **Testes que faltam:** `parseEvalObject`/`parseIdentObject`/`parseConditionAiObject`, `priceRoseSinceEval`,
  `isQuotaError`/`isTransientError`, `pickBestRelease`/`parseAlbum`/`buildQuery`, `selectLotsForMarket`/
  `marketBasis`, starvation de `enrichConditions`.
- `ai-provider-controls.tsx`: trocar provedor+modelo grava em duas server functions (pode gravar só uma).

> Atualização (v0.143.2): já feitos dos itens da revisão — memoização de `marketFor`/`conditionFor`,
> `getAllLotAiLean`, teto do estado por IA, hash do prompt pelo texto, `basis` normalizado e testes dos
> parsers de resposta. (v0.146.0: a tracklist agora é carregada sob demanda — `getLotAi` manda só
> `hasTracklist`.) Continuam abertos: as duplicações/camadas e o restante da lista acima.

> Atualização (v0.144.0): feitos — «Meus lances» com nota/mercado/estado, De olho com veredicto de mercado, «Oportunidade»
> de mercado no lugar da gravada pela IA, blocos «em breve» no painel. Lista completa de pendências e dos testes
> manuais: `docs/checklist-ia.md`.

## Revisão geral (21/10/2026) — o que o PR de infra deixou de fora

- **Texto do prompt contra injeção (IA5)**: dizer ao `SYSTEM_PROMPT` que título e descrição são dado de terceiros muda o hash e reavalia até 800 lotes por rodada; vai junto com a mudança de frete do prompt, para pagar a reavaliação uma vez só.
- **Temperatura da Claude (IA8)**: não fixada; testar se o Haiku 5.5 aceita com `thinking` desligado.
- **Logout por GET** (logout-CSRF, baixo): trocar por POST exige mexer em `index.tsx` e `mobile-bottom-nav.tsx`.
- **CSP de script/estilo** no Caddy: precisa de nonces no SSR do TanStack Start.
- **Imagens flutuantes** (`postgres:17-alpine`, `caddy:2`, `portainer:lts`): fixar o minor.
- **Previews/Portainer** (S6) e **backup das fotos da Coleção** (B2): ver "Próximo" na revisão geral.

## Código repetido (marcado com `// DUP(...)`; regra no AGENTS.md)

Achar: `grep -rn "DUP(" src`. Pendentes: `DUP(pool)` — laço de workers com `cursor` em 8 lugares
(extrair `runPool`); `DUP(modelos)` — lista/padrão dos modelos Gemini em 4 arquivos (`ai-models.ts`).
Consolidados em v0.145.0: leitura de JSON de IA, faixas do veredicto, `lot-score.ts`. Em v0.164.0: pipeline de insights de lote (home × Análise) em `lot-insight-build.ts`.

## Análise de Lotes — o que ficou de fora das fases 1–4 (v0.161.0)

- **Alerta "vigiado passou/está abaixo do teto de lance"**: exige o valor AO VIVO do lote (a varredura geral
  defasa até 6 h) e a conta de mercado no servidor (`getAllLotMarket` + `withConditionAnchor` + `lotEconomics`,
  como o `daily-digest`). Pensar em aviso de **cruzamento** (snapshot lote → "abaixo"/"acima" em `app_state`), não
  de "continua abaixo". Sem `lot_market` casado o alerta não existe.
- **Medir o efeito do contexto do prompt** (comparar notas antes/depois da v0.142.0 pela calibração do painel).
- **Pendentes exatos**: a cobertura da Análise conta lote sem `lot_ai`/sem nota; o servidor também reavalia por
  mudança de título/versão do prompt (hash só existe no servidor). Uma server fn de contagem daria o número exato.
- ~~`DUP(lot-insights)`~~ resolvido em v0.164.0: home e Análise usam as mesmas funções puras de
  `src/lib/lot-insight-build.ts`; a home segue com as queries escopadas e os acessores por lote, que alimentam os
  diálogos de decisão da Coleção.
- **Pesos do índice de garimpo** são palpite: calibrar com compras reais (`purchases`) antes de tratá-lo como
  critério padrão.

- **Conta do lote com e sem frete (v0.162.0)**: a Análise usa o valor real do lote (frete à parte; Discogs = preço +
  frete), mas `marketDeal` (home, `daily-digest`, De olho, calibração) e o contexto do prompt da IA
  (`lote_mais_frete_brl`, `razao_lote_vs_sugerido`) ainda somam o frete do leilão ao lote. Decidir se unifica
  (subir `PROMPT_VERSION` reavalia até 800 lotes por rodada) e se o frete do Discogs passa a vir da mediana real
  dos anúncios BR (hoje usa a mesma estimativa fixa do painel).

# Notas de desenvolvimento — Garimpo de Vinil

> Documento de continuidade entre sessões: **arquitetura, mecânica dos sites de leilão,
> decisões e pendências**. O código é refatorado com frequência (helpers mudam de arquivo);
> prefira **procurar por nome de função** (`grep`) a confiar em caminhos/linhas exatos.
>
> ⚠️ **Atualize este documento ANTES de mesclar qualquer PR.** Toda mudança de
> arquitetura/mecânica entra na seção correspondente; toda entrega ganha uma linha no
> **Histórico de versões**; pendências resolvidas saem da lista. Manter isto em dia é o que
> torna a próxima sessão produtiva. (Como o arquivo já vive na `main`, ao "mesclar notas"
> faça fetch de `origin/main` e acrescente/edite a partir dele para evitar conflito add/add.)

## O que é o app

Garimpa **discos de vinil** em leilão no **LeilõesBR** e casas parceiras, agrupando por
**dia → casa de leilão → artista**, com **vigia** e **lances** sincronizados com a conta do
usuário, avaliação por **IA** e âncora de preço do **Discogs**. Stack: **TanStack Start +
React 19 (SSR) + Supabase**, deploy na **Vercel** (Nitro). Migrado do Lovable em 2026-08.

## Convenções de trabalho (ler primeiro)

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa** (a `main`
  recebe commits de outras sessões/PRs). Fluxo: branch → PR → merge.
- **Atualizar ESTE documento antes de mesclar o PR** (ver aviso no topo).
- **Bump de versão em TODO PR:** `APP_VERSION` em `src/lib/version.ts` **e** `version` no
  `package.json`, semver (PATCH=correção, MINOR=nova função, MAJOR=quebra). É o número no
  rodapé em produção. **Obrigatório:** o CI `.github/workflows/version-bump.yml` falha o PR
  se a versão não subir (⚠️ merge via API do GitHub **não** barra — não confie só no CI).
  Colocar a versão no título do PR (ex.: `v0.2.0 — filtro por casa`).
- **Rodapé de atribuição** em qualquer post no GitHub; commits terminam com `Co-Authored-By:`.
- **Não colar páginas HTML inteiras no chat** (consomem contexto) — pedir só o bloco
  relevante (um card) quando precisar do HTML de um site.

## Restrições do ambiente

- **Não dá para testar scraping/lance daqui** (sem rede aos sites de leilão) — validar por
  análise estática + `bun -e` de funções puras; o **usuário** testa na prévia/produção.
- **`bun install` funciona** (`bunfig.toml` → npm público), então `bun run build`,
  `bunx tsc --noEmit` e `bun run lint` rodam localmente. Lint verde salvo 2 warnings
  pré-existentes de shadcn (`ui/badge`, `ui/button`).
- **Migrações `.sql` NÃO são auto-aplicadas** — o schema é (re)criado via `supabase/setup.sql`
  (SQL Editor ou `psql -f`), re-executável (tudo `IF NOT EXISTS`). Ao criar tabela/coluna,
  editar `setup.sql` **e** `src/integrations/supabase/types.ts` à mão. Tabelas: `lots`,
  `known_artists`, `app_state`, `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`,
  `wantlist_items`, `collection_items`.
- **Git push HTTPS costuma funcionar**; quando não, usar os tools `mcp__github__*`.

## Arquitetura de dados

- Abrir o app **lê só do banco/cache** — NÃO varre o site (varredura completa estoura o tempo
  do servidor e deixa a tela vazia).
- **Popular** é sob demanda / agendado, em **blocos** (chunks) para caber no tempo do servidor:
  - `scrapeVinylChunk(fromPage, size)` — varre um bloco da listagem geral.
  - `enrichMissingLotes(maxAuctions, offset)` — preenche nº de lote via catálogo. Usa **cursor
    `offset`** sobre a lista estável/ordenada dos leilões da janela; retorna
    `{updated, total, nextOffset, done}`.
- Camadas: `memCache` (módulo, garante a lista sem banco) + tabela **`lots`** (durável, upsert
  por `id`, **merge** — nunca apaga o que não veio) + `app_state` (chaves globais: casas
  verificadas, interesses, modo de IA, batches pendentes, vínculos/aprendizado da Coleção).
- `id` do lote = `"${idLeilao}-${idPeca}"`. Janela = **5 dias** (`WINDOW_DAYS`).
- **Última atualização:** `getVinylLots` retorna `updatedAt` = maior `updated_at` de `lots` na
  janela (trigger `update_lots_updated_at` toca a coluna no upsert); exibido sob "Atualizar
  tudo" (`formatUpdatedAt`, fuso São Paulo).

## Scraping do LeilõesBR

- **Varredura geral é PÚBLICA** (sem login) via `publicFetch` — evita o 500 que o site dá
  logado sob carga. Categoria fixada por `tp=|446973636F2064652076696E696C|` (hex de "Disco de
  vinil") → **todo lote já é vinil**; não exigir palavra-chave no título, só descartar CD/DVD/K7
  (`looksNonVinyl`, em `vinyl-parse.ts`).
- **Login (`authFetch`)** só para a **conta**: env `LEILOESBR_EMAIL` / `LEILOESBR_SENHA`.
  - **Vigias**: `conta_site.asp?l=8` → `listWatchedFromSite` (cards `.oc-item`,
    `data-watch="idPeca,email,idLeilao,base"`, preço em `<b class="pb-1">`).
  - **Meus lances**: `conta_site.asp?l=4` → `listMyBidsFromSite` (mesmos `.oc-item`; **meu
    lance** em `.product-price b.pb-1`; **status** na classe/ícone `lstatus`:
    `Coberto`/`Vencendo`/`Vencedor`/`Coberto e Vendido`/`Não vendido`).
  - **Toggle vigia**: `POST vigiar_peca.asp` (`idpeca/idcliente/idleilao/base`, resposta `+`/`-`).
- **`fetchWithRetry`** (`leiloesbr-auth.server.ts`) falha de imediato em 404/403 (via
  `LeiloesBrHttpError`) e faz backoff só para 5xx/rede/timeout.
- **Sessão logada é POR ORIGEM** (`getSessionCookieFor(origin)`): `leiloesbr.com.br` para
  conta/vigias/lances e o **domínio de cada casa** para o pregão presencial (mesma plataforma,
  mesmo `login.asp`, mas cada domínio tem seu próprio `ASPSESSIONID`). `getSessionCookie()` é o
  atalho para `BASE_URL`. `absorbSetCookie` mantém o jar da origem vivo com os `Set-Cookie` que a
  casa devolve durante o pregão.

## Nº do lote (detalhe crítico)

- **A listagem geral NÃO traz o nº do lote** — ele só existe no **catálogo da casa**. O link
  de cada lote embute tudo: `abre_catalogo.asp?t=1|<domínio>|<idLeilao>|<idPeca>` →
  `parseAuctionRef` extrai `{domain, idLeilao}` (cada casa usa a própria URL, automaticamente).
- `fetchLoteMap(domain, idLeilao)` busca **`<domínio>/catalogo.asp?Num=<idLeilao>`** (público)
  e cruza `idPeca → nº do lote`. **1 requisição por leilão**, não por lote.
- **Parser por posição** (`parseCatalogLotes`, em `leiloesbr-catalog.server.ts`): NÃO depende
  da classe do container. Para cada `peca.asp?ID=<idPeca>`, pega o `Lote: <n>` (bloco
  `LoteProd`) até a próxima `peca.asp`.
- **Casas fora da plataforma LeilõesBR** (ex.: `abreucolecionismo`) renderizam o catálogo via
  JS → `peca.asp` não vem no HTML → **não rendem número** por esse caminho. Continuam cobertas
  pelo **overlay**: vigias (`l=8`) e lances (`l=4`) trazem o `lote`, sobreposto por `idPeca`
  (mapa `loteById`).
- Diagnóstico: `GET /api/cron?step=catdebug` (sonda os catálogos das casas sem número).

## Cores, badges e busca

- **Verde** = tenho lance e estou ganhando/arrematei (`bidIsWinning(status)` casa
  `venc|arremat|arrebat`). **Vermelho** = tenho lance mas coberto. **Amarelo** = só vigiado.
  Precedência: **lance vence vigia**.
- **Ícone roxo "já tenho na Coleção"** (`LotCard`, só na **home** `index.tsx`): disco `Disc3`
  num badge roxo no canto **direito, abaixo** da nota da IA (`absolute right-2 top-9`), quando
  o lote casa com um item de `collection_items`. **NÃO** mexe na borda (lance/vigia intactos).
  Casamento em `wantlist-match.ts` (`ownedCandidate`/`ownedMatchForLot`), **precisão em 1º
  lugar** (falso positivo é pior que faltar): **EXIGE o nome do álbum**, e só com tokens
  **distintivos** — descontando os que também são do **artista** (ex.: "A Arte de Jorge Ben" →
  distintivo só "arte"; senão "jorge"/"ben" casariam quando o lote só CITA o artista como
  compositor) e palavras **genéricas** (`GENERIC_ALBUM_TOKENS`: "ao vivo"/"sucessos"/…). Score
  0..1 dirigido pela **cobertura do álbum**, com o **artista** claramente presente
  (`OWNED_ARTIST_MIN` 0.75); o **ano** só reforça / desempata reedição. Faixas: `>=
OWNED_CONFIDENT_MIN` (80%) = ícone confiante; `>= OWNED_MATCH_MIN` (60%) = ícone **com "?"**;
  abaixo não marca. **Sem álbum distintivo → não marca** (só a peça exata por `lot_id`, score
  1, no chamador). `ownedCands` ignora buckets Lote/Coletâneas/Não classificados; mapa
  `ownedById` memoizado; prop `owned: OwnedHit` no `LotCard`.
  - **Coletânea/ao vivo (título genérico)** casa pelo **nome + ano EXATO** (`ownedScore`
    separa tokens distintivos × genéricos; "Ao Vivo (1989)"/"Seus Sucessos (1978)").
  - **Relação MANUAL + gerenciável (v0.24.0):** o ícone aparece em **TODO card** — **cinza**
    (sem relação), **roxo** (relação), **roxo + "?"** (incerta/sugerida). Ao tocar abre o
    **`OwnedPanel`** (`owned-panel.tsx`) com o **`CollectionCard`** do disco relacionado e ações:
    **Confirmar** (auto/sugestão → vínculo), **Não tenho** (fica cinza e não re-marca),
    **Reativar detecção automática**, e um **seletor** (busca) para relacionar/trocar por
    qualquer disco. `CollectionCard` ganhou `onEdit`/`onRemove` opcionais (modo leitura).
  - **Persistência (sem schema):** duas chaves em `app_state` — **`collection_links`**
    (`Record<lotId, itemId|false>`, override por lote) e **`collection_feedback`**
    (`OwnedFeedback[]`, aprendizado por assinatura). Server `app-state.server.ts`
    (`getCollectionLinks`/`setCollectionLink`, `getCollectionFeedback`/`addCollectionFeedback`/
    `removeCollectionFeedbackByLot`) + `leiloesbr.functions.ts` (`getCollectionLinks`/
    `getCollectionFeedback`/`applyCollectionDecision`). Cliente: queries `["collection-links"]`/
    `["collection-feedback"]`, gravação otimista.
  - **Aprendizado (modo "sugere, você confirma"):** `resolveOwned(lotId, links, autoHit,
feedback, id)` → `none|rejected|linked|auto|suggested`. Confirmar grava feedback **pos**;
    "Não tenho" grava **neg**. Em OUTROS lotes: **pos** sem auto → sugere **"?"**; **neg** que
    casa a assinatura rebaixa um auto-confiante para **"?"** (nunca marca confiante sozinho nem
    esconde). Reativar remove o feedback do lote (`ownedSignatureFromLot`/`OwnedFeedback` em
    `wantlist-match.ts`). Vale em **todos** os cards da home, incl. "Meus lances"
    (`bid-house-sections.tsx` recebe `ownedFor`/`onOpenOwned`).
- Helpers de classificação/agrupamento em `src/components/vinyl/grouping.ts` (`classifyBid`,
  `houseAnchor`, `computeHouseStats`, `groupByHouse`/`groupByHouseSimple`, `groupByArtist`,
  `watchedMatchesSearch`/`bidMatchesSearch`, `groupWatchedByHouse`, `loteNum` — ordena por nº
  de lote, vazio ao fim; `artistRank` põe artistas reais → `"Lote"` → não classificados).
- **Badges por casa:** `HouseStatBadges` (`badges.tsx`) alimentado por `computeHouseStats`
  (`HouseStats = {vigia, green, red}`, contagens mutuamente exclusivas seguindo a precedência
  de cor). Análoga `BidStatBadges`/`computeBidStats` para "Meus lances".
- **Busca das abas de dia:** `searchRelevance(identity, extra, queryNorm)` (`vinyl-parse.ts`)
  pontua por camadas (5 = identidade começa com o termo · 4 = contém · 3 = todos os termos na
  identidade · 2/1 = termo(s) em campo fraco casa/nº do lote · 0 = nada). `identity` = álbum
  IA + artista + título; `extra` = casa + nº do lote. **Com busca ativa**, a listagem do dia
  vira **lista única ordenada por relevância** (não agrupa por casa). Vigiados/Lances usam
  casamento contíguo (`watchedMatchesSearch`/`bidMatchesSearch`), sem ranqueamento.

## Grading de estado — Disco × Capa (`grading.ts`, v0.29.0)

Módulo **puro/client-safe** `src/lib/grading.ts` — fonte única da conservação, sem rede nem
imports de servidor. Consumido pelo card do lote, pela Coleção e (nas fases seguintes) pelo
enriquecimento no servidor e pelo Vinil Analytics.

- **Escala canônica de 10 graus** (melhor→pior): `M, NM, EX, VG+, VG, VG-, G+, G, G-, F/P`
  (`GRADE_ORDER`), com score-base (`GRADE_SCORES`, M=100…F/P=0). Sinônimos: `M-`≈NM, `VG++`≈EX
  e palavras (Mint/Lacrado, Near Mint, Excelente, Muito Bom, Bom, Regular, Fair/Poor).
- **Score Final** = matriz fixa **Disco × Capa** (`scoreCondition`; diagonal = score-base; um
  lado só → score-base desse lado; nenhum → null) e **Faixas de Classificação** (`FAIXAS`:
  90–100 Colecionador · 75–89 Excelente · 60–74 Muito Bom · 45–59 Aceitável · 30–44 Abaixo da
  Média · 0–29 Muito Danificado; `faixaFromScore`).
- **Extração do texto** (`parseConditionFromText`, determinística): rótulos `Disco/Mídia/Vinil`
  e `Capa/Sleeve`; rótulo geral `Estado/Conservação` aplica aos dois; palavra de item inteiro
  (Lacrado/Mint) → ambos; senão uma única sigla forte solta → Disco. **Nunca inventa** →
  `source: 'indefinido'`. Encarte: `detectInsert` (`sem encarte` vence `encarte`).
- **UI:** componente compartilhado `ConditionBadges` (`condition-badges.tsx`) no padrão de pill
  do app; pill de Faixa/Score colorida por `scoreTone`. No `LotCard` o estado é **derivado do
  título** nesta fase (prop `condition`, resolver `conditionFor` na home); no `CollectionCard`
  a Faixa/Score sai de `scoreCondition(normalizeGrade(midia), normalizeGrade(capa))`.
- **Coleção alinhada aos 10 graus:** `toGrade` (`collection-bulk.ts`) usa `normalizeGrade`; o
  `Select` de mídia/capa (`colecao.tsx`) mapeia `GRADE_ORDER`; o prompt de import lista os 10.
- **De onde vem o estado:** o **descritivo completo** do lote está no **tooltip** do card do
  catálogo (atributo `title`/`alt`/`data-*`) — ver "Estrutura do card do catálogo" abaixo. Logo o
  estado rico (Disco/Capa) sai do **catálogo** (1 req/leilão) SEM abrir a `peca.asp` lote a lote.
  Isso alimenta tanto o histórico de vendas (`lot_sales`, v0.30.0) quanto o cache de estado dos
  cards **pré-leilão** (`lot_condition`, v0.32.0). Depois a página **Vinil Analytics** agrega por
  artista→álbum sobre o histórico.

## Histórico de vendas — `lot_sales` (v0.30.0)

Base do Vinil Analytics: cada venda de cada lote, capturada do **catálogo da casa**
(`catalogo.asp`) DEPOIS do leilão — **1 requisição por leilão**, nunca lote a lote.

- **Fonte/parse:** `parseCatalogData`/`fetchCatalogData` (`leiloesbr-catalog.server.ts`)
  estendem o parser do nº do lote — no mesmo segmento por `peca.asp?ID=` capturam também o
  **valor de venda** e o **texto do card**. `fetchLoteMap` virou um wrapper fino disso.
  ⚠️ **Fail-closed**: só marca `sold` quando há valor (rótulo "Valor de venda: R$ …", ou
  marcador "vendido"/"arrematado" + `R$`) e nenhum marcador de "não vendido"; sem isso, não grava
  (nunca inventa venda). Calibrado a partir do catálogo real do **Discos Esquecidos** (v0.31.1) —
  ver "Estrutura do card do catálogo" abaixo; outras casas podem exigir ajuste de
  `SALE_VALUE_RE`/`SOLD_MARKER_RE`/`UNSOLD_RE`.
- **Varredura:** `captureFinishedSales` (`lot-sales.server.ts`) lê `seen_auctions` (durável,
  **nunca podado**), filtra os leilões **terminados** (`auctionFinished`) ainda não capturados
  (checkpoint `app_state.sales_captured`), busca o catálogo por leilão e grava as vendas. Processa
  um bloco por rodada (`max`), idempotente (leilão capturado não revisita).
  ⚠️ **Catálogo é efêmero:** o `catalogo.asp` da casa só fica de pé por um tempo após o leilão —
  os **antigos** devolvem página genérica sem lotes (`pecaMatches:0`). Por isso a ordem é **mais
  recente primeiro** e a captura acontece na prática no dia em que o leilão termina (cron 4×/dia).
  Backfill histórico profundo é limitado por isso.
- ⚠️ **Só VINIL, identidade nossa:** o catálogo lista TODAS as categorias (livros, DVDs, medalhas,
  miudezas…). Gravamos venda **só** dos lotes cujo id está no nosso vinil (`scrapeVinylLots`), e o
  **artista/título vêm do NOSSO lote já parseado** — não do texto ruidoso do catálogo (que só serve
  para valor + estado). Sem isso, entrava lixo (ex.: "Porta-caixa de fósforos") com artista
  `&ctd=…`. (v0.32.2) Diagnóstico `debugSales(num)` sonda um leilão específico.
- **Estado inline:** cada venda guarda `media`/`sleeve`/`score`/`faixa`/`insert_state` via
  `parseConditionFromText` do **descritivo do card** — capturado do **tooltip** (`longestAttr`
  pega o atributo mais longo: `title`/`alt`/`data-*`), que traz o texto completo tipo
  "CAPA VG+ - DISCO VG+/NM …". `detectInsert` é conservador (o boilerplate "se o LP possuir
  encarte…" NÃO conta como encarte).
- **`sold_date` = data do LEILÃO** (`seen_auctions.day_key`), não a da captura — âncora
  temporal do histórico. `artist`/`title` = do nosso lote de vinil (`lots`). Agendamento: cron
  `step=sales` (`cron.server.ts` + `refresh.yml`; reset com `?step=sales&reset=1`). Server fns
  `getVinylSales` (ler) e `captureSales` (disparar sob demanda) em `leiloesbr.functions.ts`.

### Estrutura do card do catálogo (descobertas — Discos Esquecidos, leilões br)

Inspeção de um card real do `catalogo.asp` (casa Discos Esquecidos). Fonte da calibração dos
parsers de venda/estado/nº do lote:

- **Descritivo completo no tooltip:** o texto que aparece ao passar o mouse sobre o lote é um
  atributo (`title`/`alt`/`data-*`) do card — **já vem no HTML**, não precisa da `peca.asp`.
  `longestAttr` pega o atributo mais longo (ignorando o "Lote-NN"). Ex.:
  `GILBERTO GIL - RAÇA HUMANA - CAPA VG+ - DISCO VG+/NM - Disco com mínimos riscos superficiais…`.
- **Estado no próprio título**, formato `CAPA <grau> - DISCO <grau>` (sem dois-pontos; `DISCO
  VG+/NM` = faixa entre VG+ e NM). `parseConditionFromText` casa pelos rótulos `CAPA`/`DISCO`.
- **Valor de venda** rotulado: `Valor de venda: R$ 70,00` (`SALE_VALUE_RE`), com botão
  **"Lote vendido"** (`SOLD_MARKER_RE`); não vendidos trazem "Lote não vendido" (`UNSOLD_RE`).
- **Nº do lote** no cabeçalho do card: `LOTE 4` (fallback genérico além de `LoteProd`/`title`).
- ⚠️ **Boilerplate de encarte:** a descrição termina com um texto padrão que inclui "Se o LP
  possuir encarte estará nas imagens" — **não** garante encarte. Por isso `detectInsert` é
  conservador (só afirmação definida "com/sem encarte" conta; menção condicional → indefinido).

## Estado dos lotes pré-leilão — `lot_condition` (v0.32.0)

Cache de estado (Disco/Capa) por lote para os **cards pré-leilão**, alimentado pelo **catálogo**
(o descritivo do tooltip), sem `peca.asp` lote a lote. Espelha `lot_ident`/`lot_market`.

- **Enriquecimento:** `enrichConditions` (`lot-condition.server.ts`) lê a janela (`scrapeVinylLots`),
  seleciona os lotes SEM linha em `lot_condition` (ou com `title_hash` mudado), agrupa por leilão,
  busca `fetchCatalogData` (1 req/leilão, até `max` por rodada) e parseia o descritivo do card;
  fallback ao título quando o catálogo não traz o estado. Grava linha para **todos** os lotes
  processados (mesmo `indefinido`, marcando `source` = `catalog`/`title`/`indefinido`) para não
  reprocessar à toa; drena por rodadas. Cron `step=condition` (`cron.server.ts` + `refresh.yml`).
- **UI:** server fn `getLotCondition` (query `["lot-condition"]`); no `VinylDashboard`
  (`index.tsx`) o resolver `conditionFor` passa a **priorizar o cache** (`conditionById`,
  reconstruído com `scoreCondition`) e cai no parse do título quando não há linha. O badge
  `ConditionBadges` no `LotCard` é o mesmo — agora com estado mais rico.
- **Cobertura:** preenche ao longo das rodadas do cron, como IA/mercado; casas fora do padrão de
  catálogo simplesmente ficam `indefinido`.

## Vinil Analytics — página (`/vinil-analytics`, v0.31.0)

Visão de mercado por obra, independente da casa de leilão, sobre o histórico `lot_sales`.

- **Rota** `src/routes/_authenticated/vinil-analytics.tsx` (herda o auth gate; link **Analytics**
  no header do `index.tsx`). Lê `getVinylSales` (query `["vinyl-sales"]`).
- **Agregação pura** `src/lib/analytics.ts` (`buildAnalytics`): agrupa **artista → álbum**
  (`deriveAlbum` deriva o álbum do título — heurístico, ruidoso; dá p/ refinar com `lot_ident`),
  com preço **médio/min/max**, **contagem na base**, **médias por Faixa** (`faixasFor` via
  `faixaFromScore`) e vendas ordenadas **pior→melhor** score.
- **Padronização de nomes (v0.41.0, evita duplicatas):** o agrupamento é por **CHAVE
  `normalizeForMatch`** (sem acento/caixa/pontuação) de artista E de álbum — pequenas diferenças
  de grafia ("Jorge Ben" vs "Jorge ben ", "Alceu Valença" vs "Alceu Valenca") caem no MESMO
  grupo; o nome exibido é a melhor grafia via **`pickCanonical`** (helper compartilhado em
  `vinyl-parse.ts` — mais acentuada, depois mais longa; a Coleção reusa o mesmo). Corrige os
  casos em que variações mínimas geravam 2 registros.
- **Reidentificação por IA de TODO o histórico (v0.41.0):** `reidentifyAllSales(max)`
  (`lot-sales.server.ts`) passa a IA (título+descrição da venda → "Artista - Álbum") pelas vendas
  **ainda não identificadas** (sem linha em `lot_ident`, o checkpoint durável), grava em
  `lot_ident` (inclusive linha "tentado" com álbum nulo, p/ não reprocessar) e **padroniza** a
  grafia do artista de TODAS as vendas (canonização), regravando só o que muda. Provedor =
  `resolveAiProvider()` (o do seletor do topo — Gemini quando escolhido). Cron `step=reident`
  (`cron.server.ts` + `refresh.yml`), server fn `reidentifySales`, e botão **"Reidentificar
  (IA)"** no header do Analytics (roda em laço até `done`). Sem provedor de IA, só a padronização
  roda.
- **UI:** artistas e álbuns **expansíveis** (padrão manual `useState` + Chevron, como a home —
  não há Accordion no `ui/`). Ao abrir o álbum: **eixo horizontal** (esquerda = pior, direita =
  melhor) de marcadores (mini card, no eixo por `byScoreAsc`), chips de **médias por Faixa**,
  contagem, e botão **Detalhes** → `Dialog` com tabela. Busca por artista/álbum.
- **Curadoria com aprendizado (v0.42.0) — apelidos manuais:** o usuário pode **renomear/fundir
  artistas e álbuns**; renomear e fundir são o MESMO mecanismo — mapear a **chave
  `normalizeForMatch`** de origem → **nome canônico** escolhido (duas chaves apontando ao mesmo
  nome caem no mesmo grupo). Persistido em `app_state` (mesmo modelo de override durável da
  Coleção): **`analytics_artist_aliases`** (`Record<artistKey, nome>`) e
  **`analytics_album_aliases`** (`Record<"${artistKeyFinal}|${albumKey}", nome>`). Server
  (`app-state.server.ts`): `getAnalyticsAliases`/`setAnalyticsArtistAlias`/
  `setAnalyticsAlbumAlias`/`clearAnalyticsAlias`; server fns homônimas em `leiloesbr.functions.ts`.
  Aplicado dentro de **`buildAnalytics(rows, aliases)`** ANTES de agregar (re-chaveia o grupo pelo
  nome canônico; `override` vence `pickCanonical`). `ArtistAgg`/`AlbumAgg` expõem `key` (chave
  final) e `sourceKeys` (chaves originais) para os diálogos persistirem as fusões — assim as
  grafias/variações originais colapsam também no futuro (aprendizado). UI: **lápis** no artista →
  `ArtistEditDialog` (renomear + multiseleção de outros artistas p/ fundir + "Desfazer
  curadoria"); **clicar no NOME do álbum** → `AlbumEditDialog` (renomear + fundir outros álbuns do
  mesmo artista, mantendo este nome). Escrita **otimista** na query `["analytics-aliases"]`.
- **Refinos de UI (v0.42.0):** (a) removido o "Preço médio" global do topo (fica Vendas +
  Artistas); (b) **ordenação** da lista de artistas (A→Z / nº de álbuns) e, dentro do artista, dos
  álbuns (A→Z / nº na base), via `SortToggle`; (c) mini card horizontal (`SaleMarker`) com
  **valor em cima e a nota (score) embaixo** (invertidos); (d) chips de **médias por Faixa
  invertidos para pior→melhor** (`[...faixas].reverse()`), casando com o eixo dos cards; (e)
  **colunas ordenáveis** na tabela de Detalhes (clique no cabeçalho; nulos ao fim; grau ordenado
  por `GRADE_ORDER`); (f) **preview no hover** do mini card via `Popover` portalizado (não é
  cortado pelo scroll) — card compacto com estado (`ConditionBadges` reconstruído por
  `scoreCondition`), valor/inicial/custo, demanda e link; **sem imagem por ora** (o histórico não
  guarda a URL — o preview já lê um campo `image` opcional para quando existir).
- **Resolver não identificados por venda + texto original (v0.43.0):** muitas vendas caem no
  balaio **"(álbum não identificado)"** (`deriveAlbum` devolve o placeholder quando o derivado é o
  próprio artista, ex.: "Rita Lee - Rita Lee"). Duas mudanças:
  - **`orig_text` em `lot_sales`** (nova coluna, migração `20260909150000_lot_sales_orig_text.sql`
    + `setup.sql`): guarda o **descritivo COMPLETO do card do catálogo** (o mesmo `data.text` que
    alimenta o estado), preservado mesmo depois que a reidentificação por IA reescreve `title`.
    `lot-sales.server.ts` grava em `salesRowsFromCatalog` e tolera a coluna ausente
    (`isMissingColumn`, igual ao `lot_market`) — o app funciona ANTES de aplicar a migração; só
    vendas novas/re-capturadas ganham o texto (o catálogo antigo sai do ar). ⚠️ **aplicar a
    migração à mão** (SQL Editor / `setup.sql`).
  - **Correção POR VENDA (aprendizado por `lot_id`):** chave `app_state.analytics_sale_overrides`
    (`Record<lotId, {artist?, album?}>`), devolvida junto pelos apelidos (`getAnalyticsAliases`
    ganhou `sales`) e aplicada em **`buildAnalytics` ANTES de derivar/agrupar** (precede a
    derivação; os apelidos por nome ainda aplicam por cima). Server `setAnalyticsSaleOverride`
    (`app-state.server.ts` + server fn). UI: **clicar no mini card** abre `SaleDetailDialog`
    (texto original completo + todos os campos + link) com campos **Artista/Álbum só desta venda**
    (Inputs com `<datalist>` dos nomes existentes), **Salvar** / **"Voltar ao automático"**. Assim
    dá para **separar** os discos distintos de um mesmo balaio (o override isenta a venda do filtro
    `looksNonVinylSale`). O `SaleMarker` passou a usar **`PopoverAnchor`** (hover = preview; clique
    = detalhe) e o preview mostra o **texto original** (`orig_text || title`, com rolagem).
- **Rodar a IA por artista e por álbum (v0.44.0):** além do botão global "Reidentificar (IA)", há
  um botão **`IaButton`** (ícone `Sparkles`) em cada **artista** e cada **álbum** que roda a IA
  **só nas vendas daquele grupo**. `reidentifyAllSales(max, { lotIds })` (`lot-sales.server.ts`)
  ganhou o parâmetro de **escopo**: filtra as vendas por `lotIds`, **retenta as ainda NÃO
  identificadas** do grupo (álbum nulo/sem linha — ao contrário do global, que pula tudo que já
  tem linha em `lot_ident`) e usa o **texto original** (`orig_text || title`) como entrada da IA.
  Por grupo, só grava os SUCESSOS em `lot_ident` (não rebaixa uma identificação a nulo). Server fn
  `reidentifySales` aceita `lotIds` (cap maior, chamada única — a UI não roda em laço no modo por
  grupo, evitando reprocessar eternamente os sem solução); ao terminar, invalida `["vinyl-sales"]`.
- **Lotes ocultos + balaio de coletâneas/novelas (v0.45.0):** limpeza dos balaios-lixo do
  Analytics ("Lote", códigos de casa tipo "Discos5"/"Discos 6", "Proposta de Lote Para Leilão").
  Aplicado na **leitura** (`buildAnalytics`, sobre o histórico já gravado, sem re-capturar nem
  deletar):
  - **Lotes confirmados somem:** venda cujo TÍTULO é um conjunto de discos (`isDiscBundle`) é
    **ocultada** (preço de conjunto não é preço por álbum). A **correção manual por venda**
    (`analytics_sale_overrides`) ISENTA. Nada é apagado do banco — a captura **continua gravando**
    os lotes (com `orig_text`), que é o que permite a IA garimpar artista/coletânea de dentro do
    lote; quando a IA reescreve o título para "Artista - Álbum", ele deixa de ser lote e a venda
    **reaparece** no lugar certo.
  - **Coletâneas e novelas → balaio `ANALYTICS_COMPILATION_LABEL` = "Coletâneas, Novela e etc"**
    (`vinyl-parse.ts`): quando o TÍTULO indica coletânea/sucessos/trilha/novela (`isCompilation`)
    ou o "artista" é de vários intérpretes (`isVariousArtists`). O nome casa (por
    `normalizeForMatch`) com o balaio que o usuário já criou na curadoria → funde no MESMO grupo.
    Ordena junto dos especiais (`artistRank`: reais → coletâneas → Lote → não classificados).
  - **`isGenericArtist` reconhece os balaios-lixo** (`Discos\d+`, "proposta de lote"/"lote para
    leilao") além de "lote": assim a IA de identificação (captura + botões por grupo) passa a
    **mirá-los** para desvendar o artista/coletânea real. Os balaios continuam **visíveis** até a
    IA rodar (o usuário clica "IA" em cada um); confirmando-se lote, o filtro de `isDiscBundle`
    oculta.

### Excluir venda ou artista do Analytics (v0.46.0)

Curadoria de **exclusão** (ocultar, NÃO deletar do banco) — reversível, aplicada na leitura em
`buildAnalytics`, mesmo modelo durável dos apelidos (`app_state`).

- **Duas chaves novas em `app_state`:** `analytics_excluded_sales` (`Record<lotId, rótulo>`) e
  `analytics_excluded_artists` (`Record<artistKey, nome>`). O rótulo/nome é só para a lista de
  "Ocultos" exibir e reincluir — o agrupamento usa apenas as CHAVES. Server em `app-state.server.ts`
  (`setAnalyticsExcludedSale`/`setAnalyticsExcludedArtist`, lidos junto em `getAnalyticsAliases`,
  que agora devolve `excludedSales`/`excludedArtists`) + server fns homônimas em
  `leiloesbr.functions.ts`.
- **`buildAnalytics`** pula a venda cujo `lot_id` está em `excludedSales` (logo no topo do loop) e o
  grupo cujo artista casa `excludedArtists` — pela **chave final** (grupo exibido) OU pela **chave
  original** (robusto a fusão/apelido). Ao excluir um artista, gravamos a `key` final + as
  `sourceKeys`.
- **UI (`vinil-analytics.tsx`):** botão **"Excluir do Analytics"** (ícone `EyeOff`) no
  `SaleDetailDialog` (por venda) e **"Excluir artista"** no `ArtistEditDialog` (grupo inteiro).
  Escrita **otimista** na query `["analytics-aliases"]`. Como o excluído some da lista, há um painel
  **"Ocultos do Analytics"** (`HiddenPanel`, colapsável no rodapé) que lista artistas/vendas
  ocultos com **"Reincluir"** (`RotateCcw`). Reincluir um artista remove todas as chaves gravadas
  com o mesmo rótulo (desfaz também as `sourceKeys`).

## Valores do lote: atual / próximo / meu lance

Três valores de **fontes diferentes** — não confundir:

- **Valor atual** = `price` (`.venda-price` na listagem; `<b class="pb-1">` nas páginas de conta).
- **Meu lance** = `myBid` (só na página "Meus lances", `l=4`).
- **Próximo lance** = **NÃO** existe na listagem nem nas páginas de conta. Só no **detalhe do
  lote** (`peca.asp`, JSON `loadData`): **`data[0].NOVO_VALOR`** (já calculado pelo site). **Só
  o lote ABERTO traz `NOVO_VALOR`** → **1 requisição por lote** → buscado só para
  **vigiados + lances** (conjunto pequeno), nunca a listagem inteira. Implementação:
  `leiloesbr-lot-details.server.ts` (`fetchNextBids`, concorrência 8, teto 100, regex
  `"NOVO_VALOR":"(\d+)"`) → `getNextBids` → query `["next-bids"]` (`staleTime` 3min). Não
  persiste (busca ao vivo, cache curto).
- **NÃO inferir o incremento** — o `NOVO_VALOR` real diverge dos "termos" da casa; ele é
  autoritativo. **`base`** (do `data-watch`) NÃO é o incremento (é a base/plataforma).
- **Regra de UI (card):** sempre "Atual"; "Próximo" quando há `nextBid`; "Meu lance" quando há
  `myBid` (linha abaixo). **Correção do "Atual" quando VENCENDO:** a listagem pública traz
  valor defasado → o `LotCard` usa `myBid` como "Atual" quando `bidIsWinning(status)`; por isso
  `myBid` é passado a **todos** os cards (`myBidById`). "Meus lances" (`l=4`) não traz o atual →
  casar por `id` com a varredura geral (`priceById`).

### Referência: JSON `loadData` do `peca.asp`

`<domínio>/peca.asp?id=<idPeca>` (público, vem mesmo deslogado) embute
`var loadData = { "data":[…], "listalotes":[…], "navinfo":[…] };`:

- **`data[0]`** (lote ABERTO): `ID`, `NUMLEILAO`/`ID_LEILAO`, **`LOTENUM`**, `PECA`/`DESCRICAO`;
  **`VALOR_VALUE`** (atual) · **`NOVO_VALOR`** (próximo) · `VALOR_LABEL` · `VENCENDO` ·
  `MOSTRABTN_STATUS` · `QTDLANCE` · `VALMAX` · `ULTIDCLI` · `VPASTA` (imagem).
- **`data[0].listalotes[]`** = catálogo INTEIRO do leilão (`ID`, `LOTENUM`, `VALOR_VALUE`, … —
  mas **sem** `NOVO_VALOR`) → **fonte alternativa em massa** de nº de lote + valor (1 req pega
  o leilão todo), útil para casas cujo catálogo HTML é JS-rendered.
- **`data[0].navinfo[]`** = `{PREVID, NEXTID}`.

## Painel de mudanças — DESCONTINUADO (v0.25.0)

A página **`/dashboard`** foi removida (home/Análise/Ao vivo cobrem o uso). Chave órfã
`dashboard_baseline` em `app_state` pode ser apagada à mão. O `enrichLotes` (nº de lote)
segue existindo, usado pela home ("Atualizar tudo").

## Casas verificadas

- "Marcar casa como verificada" (chave `${dia}|${casa}`) **PERSISTE no servidor**: `app_state`
  chave `verified_houses` (array global). `getVerifiedHouses`/`setVerifiedHouses`. **Marcar
  também FECHA a casa** (`toggleVerified` remove de `openHouses`) e migra para "Já verificadas".
- **localStorage vira só cache** (pinta a tela na hora); fonte da verdade é o servidor. No 1º
  load há **migração única** localStorage → servidor. (Antes ficava só no localStorage → sumia
  ao trocar de navegador/dispositivo ou usar a URL de preview, de origem diferente.)

## Atualização em background (cron 4×/dia)

- **Endpoint** `/api/cron` (tratado direto em `src/server.ts`, FORA das server functions → sem
  Supabase/CSRF), protegido pelo segredo **`CRON_TOKEN`** (header `x-cron-token`; o fallback
  `?token=` foi removido — vazava em logs; comparação em tempo constante, `tokensMatch`).
- **Steps:** `chunk` (varre bloco), `enrich` (nº de lote por `offset`), `aiident`
  (identificação IA), `aieval` (avaliação IA), `market` (Discogs), `condition` (estado
  pré-leilão), `sales` (captura de vendas), `reident` (reidentifica/padroniza o histórico de
  vendas pela IA), `salesdebug`/`catdebug` (diagnósticos).
- **GitHub Actions** `.github/workflows/refresh.yml`: `cron: "0 3,9,15,21 * * *"` (UTC = BRT
  00/06/12/18h) + `workflow_dispatch`. Varre em blocos até `nextPage:null`, enriquece por
  `offset` até `done:true`, depois laços curtos de `aiident` → `aieval` → `market`.
- O **"Atualizar tudo"** manual na UI continua (chunk + enrich por cursor).

## IA (avaliação, identificação, modo)

**Multi-provedor (v0.27.0):** o app usa **Claude (Anthropic)** OU **Gemini (Google)** — camada
plugável em **`ai-provider.server.ts`** (+ metadados client-safe em `ai-provider.ts`). Modelos
baratos por padrão: **`claude-haiku-4-5`** (`ANTHROPIC_API_KEY`, override `ANTHROPIC_MODEL`) e
**`gemini-flash-latest`** (`GEMINI_API_KEY`, override `GEMINI_MODEL`). **Opcional:** sem NENHUMA
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
- **Provedor PADRÃO** persistido em `app_state.ai_provider` (`getAiProvider`/`setAiProvider`;
  precedência: `app_state` → env `AI_PROVIDER` → `anthropic`). **Seletor único no header**
  (`AiProviderSelect`, na home, Coleção e Vinil Analytics) — é a **ÚNICA** forma de escolher a
  IA. Todo recurso do site usa esse provedor: os síncronos sob demanda leem o `aiProvider` do
  seletor no cliente; os assíncronos (cron) e as rotinas de servidor leem `resolveAiProvider()`
  (o padrão em `app_state`). **NÃO existe mais o diálogo "qual IA usar?"** por ação
  (`AiProviderDialog`/`useAiProviderPicker` foram removidos no v0.41.0 — a seleção por ação se
  confundia; agora só o topo decide).
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
- **Modo automático — chave `ai_mode`** (`getAiMode`/`setAiMode`): `"off" | "all" | "watched"`,
  **padrão `"watched"`** (econômico). No `step=aieval`: `off` não coleta/submete; `all` = todos
  os lotes; `watched` = só lotes vigiados ∪ com lance (ids de `listWatchedFromSite` +
  `listMyBidsFromSite`).
- **Análise sob demanda** (síncrona): `evalLotsSync(lots, provider)` usa `runText`
  (concorrência 4, com failover) — não a Batches. Server fn
  `analyzeOnDemand({day, house?, max, provider?})` avalia só os não avaliados (até `max`=25) e
  devolve `{evaluated, remaining, served, switched}` para o cliente repetir em laço. Roda **em
  qualquer modo**, inclusive com a IA desligada. UI: botões "Analisar dia" / "Analisar" (casa)
  perguntam o provedor antes; `Select` de modo + `Select` de provedor no header.
- **`matchesInterests` é da UI, NÃO da IA:** `buildInterestMatcher` (`ai-score-utils.ts`) casa
  a lista `app_state.user_interests` com o título via `normalizeForMatch` (determinístico,
  não gasta tokens); destaca com ⭐.

## Discogs / preço de mercado (`lot_market`)

- **API Discogs** (`api.discogs.com`, grátis; 60 req/min **com token** `DISCOGS_TOKEN`,
  opcional → no-op sem ele). `discogs.server.ts` sem SDK, `fetch` + **throttle ~1.1s**, parsing
  defensivo.
- **Casamento estruturado:** `parseAlbum` quebra o `album` da IA em `{artista, título, ano}`;
  `fetchMarket(album, title)` busca `artist=…&release_title=…&format=Vinyl&per_page=25` (cai
  para texto livre só se não achar); `pickBestRelease` pontua cobertura do álbum + artista +
  ano + vinil, **penaliza coletâneas** ("1967-1970"/"greatest hits") e **rejeita (null)** sem
  cobertura mínima (melhor não casar que casar errado).
- **Faixa BR (preço + frete):** a API oficial não dá faixa nem país/frete → **scraping da
  página de venda** `www.discogs.com/sell/release/<id>?ships_from=Brazil&currency=BRL&sort=price,asc`
  (`fetchBrListings` + `parseSellPage`, soma preço + frete por anúncio; `summarizeListings` →
  menor/maior total + contagem). Best-effort: se o HTML mudar, a faixa some (fallback no
  `stats`).
- **Persistência** `lot-market.server.ts`, tabela `lot_market`, cache por `basis`
  (hash `album||título`; `matched=false` não reconsulta). Colunas BR
  `price_low_br`/`price_high_br`/`num_for_sale_br`; `getAllLotMarket`/`upsertLotMarket`
  **toleram coluna ausente** (`isMissingColumn`, código `42703`/`PGRST204`) e caem para as
  colunas base. Cron `step=market`.
- **Reprocessar:** o `basis` não muda, então matches errados já gravados **não** são
  reconsultados sozinhos → `DELETE FROM lot_market` (ou só os suspeitos) e rodar o `refresh.yml`.

## Sondagem — obras caçadas (`wantlist_items`)

- Rascunho de obras que o usuário procura, usado como sinal extra e filtro. Tabela
  `wantlist_items` (`raw`, `work`, `year`, `note`, `norm`, `acquired`, `position`). Parser puro
  `parseWantlistText` (`wantlist-parse.ts`, uma obra/linha, tolerante a numeração/ano/nota;
  client-safe). CRUD `wantlist.server.ts` (`importWantlistText` **acrescenta**, ignora
  duplicatas). Diálogo "Sondagem" no header da Análise (colar/pesquisar/editar/marcar
  adquirido/remover).
- **Casamento probabilístico** `wantlist-match.ts` (puro, sem IA): `scoreWant → 0..1` compara
  **tokens** da obra contra `lotIdentity` (título + artista + `album` da IA/`lot_ident` +
  `release_title` do Discogs). **Porta do artista** (nome ausente ×0.4), **ano** (+0.15 casa /
  −0.25 diferente), fuzzy leve (`withinOneEdit`). Limiar **`WANT_MATCH_THRESHOLD = 0.8`**
  (`bestWantForLot`) → marca **🎯** no título (tooltip "Sondagem: obra (ano) · NN%") e alimenta
  o filtro "Só sondagem".
- **Não pesa na nota da IA** — é só destaque + filtro (como os interesses ⭐). Dar peso real
  segue em aberto.

## Coleção do usuário (`collection_items`)

- **Catálogo dos vinis que o usuário possui**, agrupado por artista. Página
  `_authenticated/colecao.tsx` (menu **Coleção** no header do `index.tsx`), duas visões
  (`Tabs`): **Cards** (`CollectionCard`, mesmo visual dos cards de leilão) e **Títulos**
  (lista simplificada). **Filtro por artista** (`ArtistFilter` reusado) + **busca** por
  artista/álbum/título (`normalizeForMatch`).
- **Agrupamento normalizado (garante juntar o artista):** grupos e filtro usam a CHAVE
  `normalizeForMatch(artist)` (sem acento/caixa/pontuação), então variações do mesmo nome caem
  juntas ("Alceu Valença" = "Alceu Valenca" = "ALCEU VALENÇA"); o cabeçalho exibe a melhor
  grafia (`pickCanonical` — mais acentuada, depois mais longa). Ordem dos grupos: artistas reais
  → **"Coletâneas"** (`COMPILATION_LABEL`) → **"Lote"** (`LOTE_LABEL`) → não classificados
  (`UNCLASSIFIED_LABEL`).
- **Coletâneas → grupo "Coletâneas"** (`vinyl-parse.ts`): `isCompilation(title)` (sucessos,
  vários artistas, trilha sonora/novela, coletânea) e `isVariousArtists(name)` (artista tipo
  "Vários Artistas"/"Various Artists"). `canonicalArtist(artist, title)` (em `collection.server.ts`)
  reduz à categoria: conjuntos → "Lote"; coletâneas → "Coletâneas"; senão o artista real. Aplicado
  tanto na varredura (`deriveCandidate`) quanto na re-identificação por IA.
- **Editável:** cada disco tem `artist`, `album`, `title`, `year`, `image`, `house`, `uf`,
  `won_price` (**valor pago**), `won_date`, `condition_media`/`condition_sleeve` (grading),
  `notes`, **`description`** (descritivo do disco, buscado pela IA), `tags[]`,
  `market_low`/`market_high` (snapshot Discogs). CRUD em `collection.server.ts` (padrão do
  `wantlist.server.ts`) exposto por `collection.functions.ts`
  (`getCollection`/`scanCollection`/`addCollectionItem`/`updateCollectionItem`/
  `deleteCollectionItem`/`uploadCollectionImage`). Diálogo de edição/adição reusa `ui/dialog`.
  - **Combo de artista:** o campo Artista é um `<input list>` (datalist) com os artistas já
    existentes — dá para **escolher um existente ou digitar um novo**.
  - **Foto:** upload por arquivo → server fn `uploadCollectionImage` (data URL → `service_role`
    → **Storage bucket público `collection`**, criado no `setup.sql`) grava a URL pública em
    `image`; dá para trocar/remover na edição e na inserção. Validação de tipo/tamanho (8 MB).
  - **Grading selecionável:** `condition_media`/`condition_sleeve` são um `Select` (`GradeSelect`
    em `colecao.tsx`) com a escala **NM · EX · VG+ · VG- · G+ · G-** (+ "Não definido", sentinela
    `__none__` porque o Radix não aceita `value=""`). Aparecem também no card.
  - **Título do lote fora do formulário:** o campo `title` continua existindo (pista para a IA e
    parser de compras), mas **não** é mais editável no diálogo (era ruído).
- **Card (`CollectionCard`):** 1ª linha **artista**, 2ª linha **álbum + ano**; mantém **valor
  pago** e o grading; exibe o **descritivo** da IA num bloco **rolável** (`max-h-40 overflow-y-auto`,
  pré-formatado) para ler o texto todo. **Tags editáveis no card** reusando `LotTags` (mesmo × / + tag
  dos lotes) → `updateCollectionItem({id, tags})` otimista (`tagsMut`, rollback em erro). **Não**
  mostra faixa de mercado nem casa de leilão. A visão **Títulos** (`collectionLabel`) segue como estava.
- **Descritivo da IA (`buildCollectionIdentPrompt`, `ai-eval.server.ts`):** prompt pede um texto
  RICO/LONGO baseado **principalmente no nome do álbum** (+ artista): momento histórico do álbum,
  panorama do artista e **faixa a faixa** quando souber; `max_tokens=2000`, slice do descritivo até
  6000 chars. Passa a gerar **`tags`** — **apenas de estilo/gênero musical** (o prompt proíbe
  época/artista/país/formato) — mescladas às do usuário (`mergeTags`, só acrescenta, nunca remove)
  tanto na passada em massa quanto no reprocesso por card.
- **Importação em massa por texto (v0.26.0):** botão **"Adicionar em massa"** no header abre um
  diálogo (`BulkImportDialog` em `colecao.tsx`) para colar texto e cadastrar vários discos de uma
  vez. Formato principal **JSON** gerado por IA — o diálogo traz um **prompt pronto para copiar**
  (`GEMINI_IMPORT_PROMPT`) que instrui o Gemini a devolver só um array JSON `{artista, album, ano,
midia, capa, valor, tags, notas}`. Parser puro/**client-safe** `parseCollectionBulkText`
  (`collection-bulk.ts`, reusa `normalizeForMatch`): tolerante a cercas ` ```json ` e prosa
  (1º `[`…último `]`), aceita **array JSON ou JSONL**, chaves com aliases PT (sem acento/caixa),
  graus normalizados p/ a escala NM/EX/VG+/VG-/G+/G-, `data` dd/mm/aaaa→ISO; **fallback humano**
  `Artista - Álbum (Ano)` uma linha por disco. Server `importCollectionText` (`collection.server.ts`
  → server fn homônima em `collection.functions.ts`) ACRESCENTA como `manual`, **pula** os que já
  existem por **artista+álbum** (`albumKey`, mesmo critério da varredura) e de-dup no próprio lote;
  retorna `{recognized, added, skipped}`. **Sem IA/rede** e **sem schema novo** (colunas de
  `collection_items` já cobrem). O preview mostra a contagem/erro e a lista antes de importar.
- **Foto por disco compatível com celular (v0.26.0):** o diálogo de edição (`EditDialog`) ganhou um
  botão **"Tirar foto"** (`<input capture="environment">` oculto disparado por `ref`) ao lado de
  "Escolher arquivo" — no celular abre a câmera direto; no desktop o `capture` é ignorado e cai no
  seletor. Mesmo fluxo `handleFile`/`uploadCollectionImage`. **Upload de foto EM MASSA segue
  pendente** (o import em massa cria discos sem foto; a foto é adicionada depois por disco).
- **Botão "Atualizar coleção"** → `importWonLots()`: varre **"Minhas compras"**
  (`conta_site.asp?l=6&t=1&...&pag=N`, **`t=1`** confirmado com o site; lê página a página até
  uma sem lotes novos) via `leiloesbr-purchases.server.ts` (`listVinylPurchases`; filtra
  não-vinil por `looksNonVinyl`), e **ACRESCENTA** os lotes ainda ausentes (**de-dup por
  `lot_id` = `${idLeilao}-${idPeca}`**) — nunca sobrescreve edição do usuário. Semeia
  artista/álbum/ano e a faixa Discogs **reaproveitando a identificação já gravada**
  (`lot_ai`/`lot_ident` via `parseAiAlbum`) e o mercado (`lot_market` via `toLotMarket`); **não**
  dispara IA/Discogs novos.
- **Prioridade da identificação (tudo GRÁTIS antes da IA — poupar créditos), em `deriveCandidate`:**
  (1) **identificação já gravada** (`lot_ai`/`lot_ident` casada por `id`; estes lotes já rodaram
  na página de leilão); (2) **título rotulado** — `parsePurchaseTitle` lê os campos do próprio
  título das casas: `Álbum: X | Código: Y | Artista(s): [`Z`] | Ano: N | Estilo(s): [..] | Label(s):`
  (o `//` vira `notes`; `Estilo(s)` vira `tags`; artista de `Artista(s):`, álbum de `Álbum:` ou do
  1º segmento sem rótulo), além de "Artista: X / Album: Y" e "ARTISTA - ÁLBUM"; (3) heurístico
  `extractArtist`; (4) `canonicalArtist` reduz coletânea/lote à categoria. A varredura retorna
  `sources = {stored, title, none}` (diagnóstico de onde veio cada artista — some no toast).
- **IA por TEXTO (opt-in, gasta créditos):** dois caminhos, ambos via **`identCollectionSync`**.
  - **Em massa — botão "Identificar novos (IA)"** no header → `identifyCollection({offset, max,
onlyUnidentified})` → `reidentifyCollection`. Gasta IA **só nos discos ainda sem
    identificação** (`needsIdentification`: artista vazio ou `UNCLASSIFIED_LABEL`), pulando os já
    identificados **sem custo** — uso ROTINEIRO e barato (a varredura de compras acrescenta poucos
    discos por vez). O `onlyUnidentified` é sempre `true` a partir da UI; o modo completo
    (`false`, re-normaliza TODA a base) segue existindo na server fn mas **não é exposto** — o
    reprocesso forçado é POR CARD (abaixo). O **cursor `nextOffset` anda sobre a lista COMPLETA e
    estável** (ordenada por `id`), coletando até `max` discos que precisam de IA e pulando os já
    identificados; assim itens que saem do filtro ao serem identificados **não deslocam o cursor**
    (nada é pulado entre rodadas). Só **preenche/melhora** (nunca apaga com resultado vazio; o
    descritivo só quando vazio).
  - **Por disco — ícone "reprocessar" (`RotateCw`) no card** → `reprocessCollectionItem({id})` →
    `reidentifyCollectionItem`. Refaz UM disco pela IA e **SOBRESCREVE** artista/álbum/ano e o
    descritivo com o que a IA devolver (nunca zera com vazio). É o "refazer" manual para corrigir
    um disco específico sem reprocessar a base toda. Estado de "girando" por-id no card.
  - Em ambos, conjuntos/coletâneas seguem classificados pelo título SEM gastar IA. A IA em si
    (`identCollectionSync`, `ai-eval.server.ts`, SÓ TEXTO), além de artista/álbum/ano, gera o
    **descritivo** (`description`) do disco. **Nunca usa a capa** — a imagem do leilão engana o
    modelo (mistura artistas parecidos); o prompt (`buildCollectionIdentPrompt`) recebe título +
    artista/álbum/ano atuais como pista e instrui a usar "Vários Artistas" em coletâneas. Devolve
    `{identified, processed, nextOffset, total, done}` (massa; o cliente repete em laço até `done`)
    ou `{updated}` (por card). O resto vai à IA e passa por `canonicalArtist` (coletâneas viram
    "Coletâneas"). **Diferença de sobrescrita:** a passada em massa só preenche/melhora (descritivo
    só quando vazio, não sobrescreve edição do usuário); o reprocesso por card **sobrescreve** cada
    campo que a IA devolver. Nenhum dos dois zera com resultado vazio. Sem `ANTHROPIC_API_KEY`, erro
    claro. (`identLotsSync` segue existindo para o fluxo antigo de leilões.)
- **Uso pretendido:** a base de `lots` já acompanha o que o usuário arremata, então a varredura
  de `l=6` é **carga inicial / emergência**, não o fluxo contínuo.
- **Duplicados questionados:** mesmo `lot_id` (mesma peça) é ignorado no re-scan; um vinil com
  **mesmo artista+álbum** de um já existente NÃO entra sozinho — volta em `duplicates`
  (`PendingWonLot`) para a UI confirmar (diálogo "Possíveis duplicados": _Adicionar_ →
  `addWonLot`/`addPendingWonLot`, ou _Ignorar_). Pode haver 2 cópias propositais. Chave de
  duplicidade só quando há álbum (`normalizeForMatch(artista+álbum)`).
- **Parser (`parsePurchaseChunk`):** o HTML CRU do ASP mistura aspas simples/duplas (o "Copy
  outerHTML" do navegador normaliza p/ duplas), então os regexes aceitam `['"]`. O **título**
  vem SÓ do texto do `<a>` de `.product-title` (removendo o "Lote: N" e tags) — o regex frouxo
  antigo atravessava até o link "Histórico de lances" (tooltip) e virava o título de todos os
  lotes. Preço em `<b class="pb-1 …">` (classe composta), data = data do leilão, casa do
  `.ellipsis-overflow` (l=6 não traz `pesq-uf`). Testado com card real via `bun -e`.

## Páginas / UI

- **Header persistente (v0.41.0):** o `<header>` de todas as páginas autenticadas (index,
  Análise, Coleção, Ao vivo, Vinil Analytics) é **`sticky top-0 z-30`** com fundo translúcido +
  `backdrop-blur` (mesmo padrão do rodapé fixo), então o topo (com o **seletor de IA**) fica
  sempre acessível. **Mobile compacto:** no `sm-` o padding vertical cai, o título encolhe, a
  descrição/tagline some (`hidden sm:block`) e a barra de ações rola na **horizontal** numa única
  linha (`overflow-x-auto`, volta a `flex-wrap` no `sm+`) — para o header baixo não atrapalhar. O
  rodapé fixo é `z-40`; header `z-30` (diálogos/toasts do Radix ficam acima, `z-50`).
- **`index.tsx` (site principal):** cards por **dia → casa → artista**. `LotCard` mostra nota
  da IA no canto **direito** (`ScoreCorner`), nº do lote no canto **esquerdo**, e o `album` da
  IA ("Artista — Álbum (Ano)", `formatAiAlbum`) **acima** do título. Álbum resolvido por lote =
  `lot_ai.album ?? lot_ident.album` (mapas `albumById` memoizados por assinatura estável para
  não disparar o casamento pesado da sondagem ao editar tag). `effectiveArtist` usa
  `isDiscBundle` → grupo **"Lote"** para conjuntos ("lote com N discos"), senão o artista da IA
  (`parseAiAlbum`), senão o heurístico do título. Header com links **Análise** / **Ao vivo**.
- **`_authenticated/analise.tsx` (Análise):** **Top 100 por nota** (recolhível) + **por dia →
  casa** ordenado por nota. Nota à esquerda com `HoverDetails` (painel via `createPortal`,
  `position:fixed`, abre à esquerda/no toque, Discogs clicável); título com
  raridade/oportunidade/motivo/tags + faixa Discogs; botão de vigiar + borda colorida por
  status. **Filtros** (valem p/ Top 100 e por dia): busca, dia, casa, faixa de nota, raridade,
  "Só sondagem", "Vigiando", "Com lance". **Tags editáveis** (×/＋ no hover, `setLotTags` →
  `updateLotTags`, otimista, com toast; só em lotes com linha em `lot_ai`).
- **`_authenticated/ao-vivo.tsx` (Ao vivo):** pregão presencial das casas com vinil **do dia**
  (`America/Sao_Paulo`), **um card por casa**, badge de status derivado do horário
  (`upcoming`/`live`/`ended`, `refetchInterval` 60s). URL do pregão montada de `seen_auctions`:
  `<domínio>/presencial/presencial.asp?Num=<idLeilao>` via `parseAuctionRef` (`null` p/ casas
  fora da plataforma → cai para o link da casa). Server: `listTodayAuctions`/`getTodayAuctions`
  (`leiloesbr-auctions.server.ts`). Sem tabela/secret novos. A seção "Acontecendo agora" da
  home (`live-auctions.tsx`, janela ~3h) segue intacta.
  - **Abrir JÁ LOGADO (proxy autenticado):** o iframe/nova aba não aponta mais direto para a casa
    (o navegador não teria o cookie do domínio dela → deslogado). Agora passa pelo **proxy reverso**
    `/api/live/<b64-origem>/<caminho>` (`leiloesbr-live.server.ts`, tratado no `server.ts` fora das
    server functions, como o `/api/cron`). O servidor injeta a sessão da casa e **reescreve** as
    URLs (absolutas/protocolo-relativo/raiz + `url()` do CSS) para tudo — assets, polling
    `LePregao`, `POST lote_fazerlance.asp` — continuar passando pelo proxy. Botões: **"Entrar ao
    vivo"** (nova aba, abre `about:blank` no clique p/ driblar pop-up e depois aponta pro proxy) e
    **"Abrir aqui"** (iframe). Proteção: token **HMAC**
    de 8h (segredo `LIVE_PROXY_SECRET` → fallback `SUPABASE_SERVICE_ROLE_KEY`) emitido pela server
    function `openLiveAuction` (atrás do login do app) e guardado em cookie httpOnly `lp_auth` com
    `Path` amarrado à origem. Guard anti-SSRF: só https em host público. **Trade-off de segurança:**
    o proxy serve o HTML da casa na NOSSA origem, então o JS da casa roda com acesso ao
    `localStorage` do app (onde fica a sessão Supabase). Aceito por ser app de usuário único e a casa
    ser a plataforma em que o próprio usuário já loga; `sandbox` no iframe reduz a superfície.
    Fallback deslogado (link "no site da casa") permanece.
  - **Auto-login é BEST-EFFORT (`getSessionCookieLenient`):** o `leiloesbr.com.br` é só o portal
    AGREGADOR; o pregão roda no **site próprio de cada casa**, que pode ter login diferente (ex.:
    `marcelinolivreiroleiloes.com.br` não tem o `login.asp` da plataforma → devolve HTML). Onde a
    casa é da plataforma, entra logado; onde não é, o proxy **NÃO falha** — serve a página deslogada
    (com uma sessão anônima semeada) e o usuário loga no **formulário nativo da casa dentro do
    proxy**; o `Set-Cookie` da casa é absorvido no jar do servidor (`absorbSetCookie`) e a sessão
    **persiste**. Por isso não se força re-login em 401/403 (destruiria uma sessão de login manual).
    Só erro de rede na casa vira 502 (com o motivo real, escapado no HTML).
- **Split do `index.tsx`:** lógica em `src/components/vinyl/` — `grouping.ts` (puros + tipos),
  `badges.tsx`, `filters.tsx`, `lot-card.tsx`, `bid-house-sections.tsx`, `live-auctions.tsx`,
  `ai-score.tsx` (UI) + `ai-score-utils.ts` (puros/client-safe — `parseAiAlbum`/`formatAiAlbum`,
  rarity legend, `LotMarket`/`toLotMarket`, `buildInterestMatcher`). Helpers puros/UI ficam em
  arquivos `.ts`/`.tsx` separados por causa do react-refresh (o especificador resolve `.ts`
  antes de `.tsx` — nomes não podem colidir).

## Ferramenta separada: `tools/missleiloes-sniper.user.js`

Userscript (Tampermonkey/bookmarklet) que roda **na página do pregão ao vivo** do missleiloes
(`@match */presencial/presencial.asp*`). **NÃO faz parte do app.** Pregão **soft-close** (cada
lance reinicia o cronômetro). Objeto global `novoPresencial`: polling (~1s) via `LePregao`,
estado em `statusatual` (P→X→1/2/3→4 FECHANDO→F), `valorpecaatual` (próximo lance),
`lancevencedor`; lance por `Fazerlance()` → `POST lote_fazerlance.asp`. v3: **um lance no
status 4 (FECHANDO)**, Turbo (polling ~250ms) + confirmação. Sniping clássico não existe no
soft-close; a vantagem é reagir mais rápido no último instante. (`tools/` é ignorado no
ESLint/Prettier.)

## Infra (migração Lovable → Supabase próprio + Vercel, 2026-08)

- **Deploy Vercel** (não mais Cloudflare). Nitro é plugin Vite (`import { nitro } from
'nitro/vite'`), **auto-detecta a Vercel** por `process.env.VERCEL`; build gera
  `.vercel/output` (Build Output API v3). `vercel.json`: `bun run build` / `bun install` /
  `framework: null`. `bunfig.toml` → npm público; `bun.lock` regenerado.
- **Auth Supabase nativo** (Google, **PKCE**). Fluxo em `src/routes/auth.tsx`:
  `signInWithOAuth({redirectTo: origin + '/auth'})` → `/auth?code=…` →
  `exchangeCodeForSession(code)`. Client com `flowType:'pkce'`, `detectSessionInUrl:false`.
  Acesso restrito ao e-mail `LEILOESBR_EMAIL` (`src/lib/access.server.ts`).
- **Supabase**: projeto `rjqzzxhgcelixlgnfcic`. RLS mantém tudo só para `service_role` (o front
  não lê o banco direto; server functions usam `supabaseAdmin`).
- **Produção**: `https://leilao-finder-buddy.vercel.app` (branch `main`). Previews de PR usam
  URL com hash que **muda a cada deploy** (o rodapé mostra a `APP_VERSION` no ar).
- **Auth URLs (Supabase → Authentication → URL Configuration):** Site URL de produção; Redirect
  URLs incluem `…vercel.app/**`, o padrão de preview `…-gilbertomaiarj1984s-projects.vercel.app/**`
  e `http://localhost:3000/**`. Google OAuth: redirect URI
  `https://rjqzzxhgcelixlgnfcic.supabase.co/auth/v1/callback`.
- **Env vars** (`.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEILOESBR_EMAIL`,
  `LEILOESBR_SENHA`, `CRON_TOKEN`, `ANTHROPIC_API_KEY`, `DISCOGS_TOKEN`. Na Vercel devem estar
  em **Production**; mudar env exige **Redeploy**. `.env` é gitignored. A `publishable`
  (`sb_publishable_`) é pública por design; senha do banco e `service_role` foram rotacionadas
  após a migração. Dados migrados via `pg_restore --data-only` (usuários do `auth` **não**
  migrados — login refeito com Google).

## Histórico de versões

Fonte única da versão em `src/lib/version.ts` (`APP_VERSION`) + `package.json`. Bump em todo PR.

| Versão         | Entrega                                                                                                                                                                                                                                                                                                                                                                                                          | PR      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| v0.1.0         | Rodapé global + versionamento (`Footer.tsx`, `version.ts`)                                                                                                                                                                                                                                                                                                                                                       | #35     |
| v0.2.0         | Regra de bump obrigatório + features acumuladas (valor atual, última atualização, casas verificadas)                                                                                                                                                                                                                                                                                                             | —       |
| v0.4.0         | IA de avaliação (`lot_ai`, Batches) + página **Análise**                                                                                                                                                                                                                                                                                                                                                         | #51     |
| v0.5.0         | Âncora de mercado Discogs (`lot_market`)                                                                                                                                                                                                                                                                                                                                                                         | —       |
| v0.6.0         | **Sondagem** (`wantlist_items`) + filtros da Análise                                                                                                                                                                                                                                                                                                                                                             | #52     |
| v0.6.1         | Casamento probabilístico da sondagem (`wantlist-match.ts`, ≥80%)                                                                                                                                                                                                                                                                                                                                                 | #53     |
| v0.7.0         | Refino Análise: `color-scheme:dark`, Top 100 + tabela por casa, hover via portal                                                                                                                                                                                                                                                                                                                                 | #54     |
| v0.8.0         | Faixa Discogs BR (scraping), "Lances do dia" por dia do leilão, tags editáveis                                                                                                                                                                                                                                                                                                                                   | —       |
| v0.8.1         | Raridade colorida pela escala (`RarityLabel`)                                                                                                                                                                                                                                                                                                                                                                    | —       |
| v0.9.0         | Filtro por raridade + feedback/validação na edição de tags                                                                                                                                                                                                                                                                                                                                                       | —       |
| v0.9.1         | Jank ao editar tag (`albumById` estável) + resiliência do `lot_market` + hover no toque                                                                                                                                                                                                                                                                                                                          | —       |
| v0.10.0        | Casamento Discogs por artista+álbum+ano (busca estruturada, `pickBestRelease`)                                                                                                                                                                                                                                                                                                                                   | —       |
| v0.10.1–0.10.2 | Endurecimento do cron (header-only, timing-safe), sem retry em 4xx, DRY em `grouping.ts`                                                                                                                                                                                                                                                                                                                         | #60     |
| v0.11.0        | Controle da IA: modo `ai_mode` (off/all/watched) + análise sob demanda                                                                                                                                                                                                                                                                                                                                           | #61     |
| v0.12.0        | Cards (casa verificada fecha, nº no canto esquerdo, álbum acima do título) + `lot_ident`                                                                                                                                                                                                                                                                                                                         | —       |
| v0.13.0        | Fix classificação IA (separador `/`) + categoria "Lote" + busca por relevância                                                                                                                                                                                                                                                                                                                                   | #63/#64 |
| v0.14.0        | Página **Ao vivo** (pregão presencial por casa)                                                                                                                                                                                                                                                                                                                                                                  | #66     |
| v0.15.0        | Pregão ao vivo **abre já logado** (proxy autenticado `/api/live`, sessão por origem, token HMAC)                                                                                                                                                                                                                                                                                                                 | #73     |
| v0.15.1        | Login da casa: GET de aquecimento (semeia `ASPSESSIONID`) + erro real no proxy p/ diagnóstico                                                                                                                                                                                                                                                                                                                    | #74     |
| v0.15.2        | Auto-login best-effort: casa fora da plataforma abre deslogada p/ login manual (persistido)                                                                                                                                                                                                                                                                                                                      | —       |
| v0.16.0        | Menu **Coleção** (`collection_items`): catálogo por artista, cards/títulos, edição, varredura de "Minhas compras" (`l=6`)                                                                                                                                                                                                                                                                                        | #76     |
| v0.16.1        | Fix da varredura da Coleção: data vazia "00/00/0000" do `l=6` virava `0000-00-00` e recusava o insert                                                                                                                                                                                                                                                                                                            | #77     |
| v0.17.0        | Coleção: parser real do `l=6` (`t=1`, aspas mistas, título do `.product-title`, preço/casa), revisão de duplicados (`PendingWonLot`)                                                                                                                                                                                                                                                                             | #78     |
| v0.17.1        | Coleção: varredura mescla abas `t=1`+`t=0` (servidor popula `t=0`) + botão **Diagnóstico** (`debugPurchases`)                                                                                                                                                                                                                                                                                                    | #79     |
| v0.17.2        | Coleção: `parsePurchaseTitle` — artista/álbum dos formatos "LP: X - Y" e "LP: Artista: X / Album: Y" (tira ":"/"Artista:")                                                                                                                                                                                                                                                                                       | #80     |
| v0.17.3        | Coleção: título rotulado (`Álbum: X \| Artista(s): [Z] \| Ano: N \| Estilo(s):`) → artista/álbum/ano/notas/tags; prioridade banco→título→IA; botão IA por capa opt-in (`identLotsSync`); diagnóstico de fontes                                                                                                                                                                                                   | —       |
| v0.18.0        | Coleção: IA **só por texto** (nunca a capa) re-identifica toda a base (`reidentifyCollection`, cursor); agrupamento normalizado por artista (`Alceu Valença`=`Alceu Valenca`); categoria **"Coletâneas"** (`isCompilation`/`canonicalArtist`)                                                                                                                                                                    | #82     |
| v0.19.0        | Coleção: card por artista/álbum+ano (remove mercado+casa) + **descritivo do disco pela IA** (`identCollectionSync`, coluna `description`); combo de artista (datalist); **upload de foto** (Storage bucket `collection`, `uploadCollectionImage`)                                                                                                                                                                | —       |
| v0.20.0        | Coleção: re-identificação da IA com alcance **`onlyUnidentified`** — botão "Identificar novos (IA)" (padrão, só os discos sem identificação, cursor sobre a lista completa) + "Re-normalizar tudo (IA)"; reduz o gasto de créditos no uso rotineiro                                                                                                                                                              | —       |
| v0.21.0        | Coleção: botão em massa passa a reprocessar **só os não-prontos** (remove "Re-normalizar tudo") + **ícone de reprocessar por card** (`RotateCw` → `reprocessCollectionItem`/`reidentifyCollectionItem`) que refaz um disco pela IA e **sobrescreve**                                                                                                                                                             | —       |
| v0.22.0        | Coleção: descritivo da IA rico/longo (momento histórico + faixa a faixa, baseado no nome do álbum) e **rolável** no card; grading (mídia/capa) como `Select` (NM/EX/VG+/VG-/G+/G-); **tags editáveis no card** + geradas pela IA (`mergeTags`); remove "Título original" do formulário                                                                                                                           | #86     |
| v0.22.1        | Coleção: tags da IA restritas a **estilo/gênero musical** (sem época/artista/país/formato)                                                                                                                                                                                                                                                                                                                       | —       |
| v0.23.0        | Home: **ícone roxo "já tenho na Coleção"** no card (abaixo da nota, à direita) quando o lote casa com `collection_items` — casamento por artista/álbum/ano (`ownedMatchForLot`) em **duas faixas**: ≥80% confiante, 50–80% com **"?"** (incerto); peça exata por `lot_id`                                                                                                                                        | #88     |
| v0.23.1        | Coleção: **precisão** do casamento "já tenho" — EXIGE o nome do álbum com tokens distintivos (desconta o nome do artista e genéricos "ao vivo"/"sucessos"), corrigindo falsos positivos (ex.: lote que só cita o artista como compositor casava "A Arte de Jorge Ben")                                                                                                                                           | #89     |
| v0.23.2        | Coleção: casamento "já tenho" mais **preciso** — tolera grafia do artista ("Ellis"≈"Elis", fuzzy 4+ só no artista); separa tokens **distintivos × genéricos** do álbum; **coletânea/ao vivo** (título genérico) casa pelo **nome + ano EXATO** ("Ao Vivo (1989)"/"Seus Sucessos (1978)"); título distintivo dirigido pela cobertura do álbum; **ícone tocável** mostra o disco casado + score                    | #90     |
| v0.24.0        | Coleção: **relação manual lote↔Coleção** — ícone em TODO card (cinza/roxo/roxo+?), painel com o card da Coleção (`OwnedPanel`), **vincular/trocar/"não tenho"/reativar** persistidos (`collection_links`), e **aprendizado** por assinatura (`collection_feedback`, `resolveOwned`) que **sugere "?"** em outros lotes (positivo) e rebaixa falsos casamentos (negativo) — modo "sugere, você confirma"          | #91     |
| v0.24.1        | Coleção: **blindagem** da home — queries `["collection-links"]`/`["collection-feedback"]` best-effort (try/catch + `retry:false`), casamento/resolução (`identityById`/`ownedAutoById`/`ownedResolutionFor`) em try/catch por lote, e `app-state.server` sem depender de módulo client-safe (tipo `OwnedFeedback` local). A relação/aprendizado nunca derruba a página (fica só sem o ícone)                     | #92     |
| v0.24.2        | Notas: relação lote↔Coleção + aprendizado **validada em produção**; registrada a lição do 404 (server não importa módulo client-safe)                                                                                                                                                                                                                                                                            | #93     |
| v0.25.0        | **Descontinuado o "Painel de mudanças"** (`/dashboard`): removida a rota, o link "Painel" no header, as server functions `getDashboardBaseline`/`markDashboardSeen` e os helpers `getBaseline`/`markSeen`/`Baseline` — limpeza de código                                                                                                                                                                         | —       |
| v0.26.0        | Coleção: **importação em massa por texto** (`BulkImportDialog`, `parseCollectionBulkText` em `collection-bulk.ts`, server `importCollectionText`) — JSON gerado por IA (prompt copiável `GEMINI_IMPORT_PROMPT`) ou `Artista - Álbum (Ano)` por linha; pula duplicados por artista+álbum; **câmera do celular** no upload de foto por disco (`capture="environment"`) — foto em massa segue pendente              | —       |
| v0.27.0        | **IA multi-provedor**: Gemini (Google) como alternativa ao Claude. Camada plugável `ai-provider(.server)` (adaptador Anthropic via SDK, Gemini via REST), **failover** automático por quota/sem créditos; provedor **padrão** persistido (`app_state.ai_provider`, seletor no header); **diálogo "qual IA usar?"** antes de cada análise/identificação; cron roda Gemini **síncrono** (Claude segue com Batches) | #96     |
| v0.27.1        | Docs: corrige onde cadastrar as chaves de IA — **só nas env da Vercel** (o `refresh.yml` usa apenas `APP_URL`+`CRON_TOKEN`, sem secrets de IA no GitHub); registra o custo do `gemini-flash-latest` (~US$0,75/US$3,75 por 1M tok, mais barato que o Haiku)                                                                                                                                                       | —       |
| v0.28.0        | **Rodapé fixo/persistente** (`Footer.tsx`): a versão fica sempre visível na base da janela (`position: fixed`, `z-40`, fundo translúcido com `backdrop-blur`), sem precisar rolar até o fim; `__root.tsx` reserva o espaço com `pb-12` e move o `<Footer/>` para fora do fluxo do conteúdo                                                                                                                        | —       |
| v0.28.1        | **Correção Gemini "não retorna nada"** na Coleção e na avaliação de leilão: `runGemini` ganha folga de `maxOutputTokens` (o `thinkingBudget:0` não era honrado → `MAX_TOKENS` com resposta vazia) e passa a **lançar erro** com `finishReason`/`blockReason` em vez de devolver `""` em silêncio; descritivo da coleção sobe p/ `maxTokens:4096`. `SyncOutcome` ganha `failed`/`error`, propagados até os toasts — "a IA falhou" deixa de virar o falso "já avaliado" / "nada a mudar"                                                    | #99     |
| v0.28.2        | **Resiliência a erro transitório do Gemini** (503 "high demand"): `isTransientError` (500/502/503/504 + "unavailable"/"overloaded"/…); `runGemini` faz **retry com backoff** (3×) e o `runText` passa a **fazer failover** também por indisponibilidade transitória (não só por quota). Toast de troca generalizado p/ "X indisponível — usei Y"                                                                                                                                                                                             | —       |
| v0.29.0        | **Grading de estado (Disco × Capa)** — módulo puro `src/lib/grading.ts`: escala canônica de 10 graus (M…F/P), matriz de **Score Final** (0–100) e **Faixas de Classificação**; `parseConditionFromText` (regex/dicionário) extrai Disco/Capa/encarte do texto do lote; **badge de estado** no `LotCard` (derivado do título nesta fase) e no `CollectionCard` (Faixa/Score via `scoreCondition`). Escala da Coleção alinhada aos 10 graus (`normalizeGrade`, dropdown `GRADE_ORDER`, prompt de import). Base para captura de venda + Vinil Analytics                                                                                        | —       |
| v0.30.0        | **Captura de vendas pós-leilão** (`lot_sales`) — varredura do **catálogo da casa** (`catalogo.asp`, 1 req/leilão, NÃO lote a lote): `parseCatalogData`/`fetchCatalogData` estendem o parser do nº do lote p/ ler **valor de venda** + texto (estado inline via `parseConditionFromText`). `captureFinishedSales` varre `seen_auctions` (durável) dos leilões terminados ainda não capturados (cursor `app_state.sales_captured`), com **backfill** do que já está na base; cron `step=sales` + `refresh.yml`. `sold_date` = **data do leilão**. Fail-closed (sem valor claro não grava). Server fns `getVinylSales`/`captureSales`                                                    | —       |
| v0.31.0        | **Página Vinil Analytics** (`/vinil-analytics`, link no header) — preços de venda por **artista → álbum** sobre `lot_sales` (casa irrelevante). Agregação pura `analytics.ts` (`buildAnalytics`/`deriveAlbum`): preço médio, min/max, **contagem na base**, **médias por Faixa** e vendas ordenadas **pior→melhor** conservação. UI: artistas/álbuns expansíveis (padrão manual), **eixo horizontal** de marcadores (score/estado/valor), chips de faixa e **Dialog de detalhe** (tabela data/estado/score/valor/lote)                                                                                                                                                | —       |
| v0.31.1        | **Calibração do catálogo (Discos Esquecidos)** — o descritivo completo vem no **tooltip** do card (atributo `title`/`alt`/`data-*`): `longestAttr` pega o texto mais longo → **estado rico** (`CAPA VG+ - DISCO VG+/NM`) direto do catálogo, sem `peca.asp`. Valor lido do rótulo **"Valor de venda: R$ …"** + marcador "vendido"/"arrematado" (fail-closed). `detectInsert` **conservador** (ignora o boilerplate "se o LP possuir encarte…"). `deriveAlbum` corta em "- CAPA/DISCO `<grau>`". Nº do lote ganha fallback "LOTE N"                                                                                                                            | —       |
| v0.44.1        | **Notas: limpeza de pendências** — os 4 itens de "Produto / código" (lance pelo app, foto em massa, peso da sondagem na nota, imagem pelo CDN do catálogo) foram **cancelados/descartados** e as **validações em produção** marcadas como **confirmadas**. Só documentação                                                                                                                                                                                                                                                                                                                       | —       |
| v0.44.0        | **Analytics: rodar a IA por artista e por álbum** — botão `IaButton` (Sparkles) em cada artista e álbum roda a reidentificação da IA **só nas vendas daquele grupo**. `reidentifyAllSales(max, {lotIds})` ganhou escopo: filtra por `lotIds`, **retenta os ainda não identificados** do grupo (ao contrário do global, que pula o que já tem linha em `lot_ident`), usa o **texto original** (`orig_text || title`) como entrada e só grava sucessos (não rebaixa a nulo). Server fn `reidentifySales` aceita `lotIds` (chamada única, cap maior); invalida `["vinyl-sales"]` ao fim. Typecheck/lint/build OK                                                                                                                                                                                                      | —       |
| v0.43.0        | **Analytics: resolver não identificados por venda + texto original** — (1) nova coluna **`lot_sales.orig_text`** (migração `20260909150000_lot_sales_orig_text.sql` + `setup.sql`; ⚠️ aplicar à mão) guarda o descritivo COMPLETO do card do catálogo, preservado após a reidentificação por IA; `lot-sales.server.ts` grava e tolera a coluna ausente (`isMissingColumn`). (2) **Correção POR VENDA** (`app_state.analytics_sale_overrides`, `Record<lotId,{artist?,album?}>`), aplicada em `buildAnalytics` ANTES de derivar (precede a derivação; apelidos por nome aplicam por cima), para SEPARAR os discos de um mesmo balaio "(álbum não identificado)". Server `setAnalyticsSaleOverride`; `getAnalyticsAliases` devolve também `sales`. UI: clique no mini card abre `SaleDetailDialog` (texto original + todos os campos + link + Artista/Álbum só desta venda com `<datalist>`); `SaleMarker` usa `PopoverAnchor` (hover=preview, clique=detalhe) e o preview mostra o texto original. Typecheck/lint/build OK                                                                                                                  | —       |
| v0.42.0        | **Analytics: curadoria com aprendizado + refinos** — (1) **renomear/fundir artistas e álbuns** manualmente, com **aprendizado durável**: apelidos em `app_state` (`analytics_artist_aliases` `Record<artistKey,nome>` e `analytics_album_aliases` `Record<"${artistKey}\|${albumKey}",nome>`), aplicados em `buildAnalytics(rows, aliases)` ANTES de agregar (re-chaveia pelo nome canônico; renomear e fundir são o mesmo mecanismo). `ArtistAgg`/`AlbumAgg` expõem `key`/`sourceKeys`; server `getAnalyticsAliases`/`setAnalyticsArtistAlias`/`setAnalyticsAlbumAlias`/`clearAnalyticsAlias` (`app-state.server.ts` + server fns). UI: lápis no artista (`ArtistEditDialog`) e clique no NOME do álbum (`AlbumEditDialog`), escrita otimista em `["analytics-aliases"]`. (2) Refinos: removido o "Preço médio" global; **ordenação** de artistas (A→Z / nº de álbuns) e de álbuns (A→Z / nº na base); mini card com **valor em cima e nota embaixo** (invertidos); chips de **médias por Faixa invertidos p/ pior→melhor**; **colunas ordenáveis** em Detalhes; **preview no hover** do mini card (`Popover` portalizado; sem imagem por ora). Typecheck/lint/build OK                                                                | —       |
| v0.41.0        | **Seletor único de IA + header persistente + IA/padronização em todo o histórico** — (1) **remove o diálogo "qual IA usar?"** por ação (`AiProviderDialog`/`useAiProviderPicker`): o **seletor do topo** (`AiProviderSelect`) é a única escolha e vale para tudo (síncrono via `aiProvider`, assíncrono/servidor via `resolveAiProvider`). (2) **Header sticky/persistente** em todas as páginas autenticadas (fundo translúcido + `backdrop-blur`), **compacto no mobile** (título menor, descrição escondida, ações em barra rolável horizontal). (3) **`reidentifyAllSales`** (`lot-sales.server.ts`) passa a IA (título+descrição → "Artista - Álbum") por TODO o histórico de vendas ainda não identificado (checkpoint durável em `lot_ident`) e **padroniza a grafia** dos nomes (`normalizeForMatch`+`pickCanonical`, helper compartilhado em `vinyl-parse.ts`); `buildAnalytics` passa a agrupar por **chave normalizada** de artista/álbum exibindo a grafia canônica (junta duplicatas por diferença mínima). Cron `step=reident` + `refresh.yml`, server fn `reidentifySales`, botão "Reidentificar (IA)" no Analytics. Prompt de identificação pede grafia **canônica/consistente** do artista (leilões futuros já saem padronizados). Typecheck/lint/build OK | —      |
| v0.40.0        | **Analytics: exclui não-vinil + reident por IA de artistas genéricos** — dois problemas de qualidade no Vinil Analytics: (1) grupos de OUTRO formato (DVD/HQ/revista/livro/K7/VHS) caindo no histórico; (2) "artistas" genéricos/lixo do `extractArtist` ("Colecionismo", "Duplo", "Various Artists", "Various", "Ao Vivo", "Ao vivo \| Código"). Novos helpers puros em `vinyl-parse.ts`: `looksNonVinylSale` (mais rígido que `looksNonVinyl` — "disco" sozinho não salva, pois DVD também é "disco"; só sinal FORTE de vinil isenta) e `isGenericArtist` (categoria/formato/coletânea/rótulo solto/pipe/vazio). **Exclusão:** `salesRowsFromCatalog` pula lotes não-vinil na captura, e `buildAnalytics` também filtra na LEITURA (limpa o que já estava gravado, sem re-capturar). **Reident:** `captureFinishedSales` manda as vendas de artista genérico (com texto) à IA de identificação (`identLotsSyncRows`, reaproveitada; teto 25/rodada), grava o "Artista - Álbum" em `lot_ident` (durável) e aplica à venda. Sem provedor de IA, só a exclusão roda. Validado (28/28 casos dos dois classificadores)                                                                                                                                          | —       |
| v0.39.0        | **Fallback de IA para o estado (quando o regex não acha NADA)** — novo em `ai-eval.server.ts`: `buildConditionRequest`/`parseConditionAiObject` (prompt só-texto pedindo `media`/`sleeve`/`insert` na escala canônica; `media`/`sleeve` passam por `normalizeGrade` — grau fora da escala vira `null`, nunca inventa) + `conditionAiSync` (worker-pool síncrono, mesmo padrão de `identLotsSync`, com failover de provedor) + `resolveAiProvider` (padrão do usuário com fallback ao 1º configurado). Ligado em `enrichConditions` (`lot_condition`, cards PRÉ-leilão) e `captureFinishedSales` (`lot_sales`, Analytics): dos lotes/vendas que ficaram **indefinidos** pelo regex mas TÊM texto, até 25/rodada passam pela IA (`source: 'ia'` em `lot_condition`); sem provedor configurado, comportamento e custo continuam inalterados (best-effort, nunca falha a rodada). Validado (10/10 casos: prompt, parse limpo/com cercas de código, grau inválido rejeitado, tudo-null, JSON quebrado)                                                                                                                                          | —       |
| v0.38.0        | **Grading tolerante a PROSA + regra de score = MÉDIA (padrão em todos os cards)** — muitas descrições reais têm o estado em prosa ("capa em bom estado", "disco apresenta-se em estado excelente"), não só siglas coladas ao rótulo (`Capa: VG+`); `gradeAfterLabel` passa a aceitar **conectores** entre rótulo e grau (até ~40 caracteres, sem cruzar fim de frase nem o rótulo do OUTRO lado — evita atribuir "disco muito bom" à capa em "Capa com riscos, disco muito bom"), rótulo **combinado** ("Capa e Disco: VG+"), mais sinônimos (`quase novo`→NM, `ótimo`→EX, `boa`/`muito boa`, `péssimo`, `danificado`) e parênteses (`Capa (VG+)`); texto é dobrado (maiúsculas/sem acento) uma vez, com guarda simples contra negação adjacente ("não bom"). **`scoreCondition` substitui a matriz fixa por uma regra simétrica**: só um lado conhecido → **ESPELHA** o mesmo grau pro outro (nunca fica "só Disco"/"só Capa"); ambos conhecidos → Score Final = **MÉDIA** dos scores-base (arredondada). O retorno inclui `media`/`sleeve` já espelhados — `index.tsx` (`conditionById`) e `CollectionCard` passam a exibir os badges a partir desse retorno, padronizando Disco/Capa/Faixa/encarte em **todos** os cards do sistema (lote e Coleção). Fluxo do catálogo (`lot_condition`/`lot_sales`) herda automaticamente por já passar por `parseConditionFromText`. Validado (21/21 casos, incl. regressão dos formatos antigos)                                                                                                                                          | —       |
| v0.37.0        | **Reparo de mojibake do catálogo (vermelho #10)** — casas como santavelharia servem o `DESCRICAO`/`PECA` com dupla-codificação (texto UTF-8 re-codificado como Latin-1: "descriçÃ£o" → "descriÃ§Ã£o"). `fixMojibake` (em `leiloesbr-catalog.server.ts`) reverte UMA camada (`Buffer.from(s,'latin1').toString('utf8')`) **só** quando a assinatura UTF-8-lido-como-Latin-1 (líder C2/C3/E2 + continuação 0x80–0xBF) está presente e o reparo não introduz `�` — texto já correto passa intacto. Aplicado aos campos de texto do JSON (`text`/`peca`) no `fetchCatalogJson`. Corrige artista/álbum nas casas afetadas. Validado (6/6 round-trip)                                                                                                                                          | —       |
| v0.36.0        | **Identidade via `PECA` p/ casas em prosa (amarelo #8; destrava #6/#7)** — casas cujo `DESCRICAO` é prosa (Catavento/santavelharia: "Disco de vinil: Título. Gravadora…") geravam artista/álbum ruins. `CatalogLot.peca` (campo `PECA`, título curado "Disco X - Novo") + `bestCatalogTitle`: se o `DESCRICAO` tem **grau** (CAPA/DISCO `<sigla>` → formato estruturado, Discos Esquecidos) usa o descritivo; senão usa o `PECA` limpo (sem prefixo de formato/sufixo de estado). Isso realiza o ganho de **#7** (o `Tipo=129` do v0.34.0 já traz vinil de casas gerais) e **#6** (a captura já varre todos os terminados; `reset=1` re-captura). **#9 (imagem CDN) adiada**: o JSON não traz o nome do arquivo da imagem (só a base do CDN)                                                                                                    | —       |
| v0.35.0        | **Campos ricos do catálogo numa varredura (verde #1–5)** — o endpoint JSON traz, por lote, muito além de valor/estado: `VISITAS`/`QTDLANCE` (demanda), `TAXA_LEILOEIRO` (%), `VALOR_CONTRATADO`/`VALOR_VALUE` (inicial) e `MOSTRABTN_CLASS` (status inequívoco). `CatalogLot` ganhou `views/bids/feePct/initialPrice` (opcionais; fallback HTML não os traz). `lot_condition` guarda `views/bids` → **badge de demanda (👁·🔨) no card pré-leilão**; `lot_sales` guarda `views/bids/fee_pct/initial_price` → Analytics detalha **Inicial** (com ágio/desconto no tooltip), **Custo c/ taxa** e **Demanda**. Migration idempotente + `setup.sql` + types. ⚠️ Re-rodar `setup.sql` (novas colunas)                                                                                                                                                    | —       |
| v0.34.0        | **Filtro de vinil na ORIGEM (`Tipo=129`)** — o catálogo da plataforma LeilõesBR tem um filtro "Disco de Vinil" na tela que dispara `catalogocontentload.asp?...&Tipo=129&...`. `fetchCatalogData` passa a pedir **`Tipo=129` primeiro** (só discos) → casas GERAIS (ex.: `santavelharia.com.br`) devolvem apenas o vinil, cortando itens aleatórios (livros/DVD/medalha) na origem; se vier vazio (casa não etiqueta esse Tipo) cai no catálogo completo por JSON e, por fim, no HTML. Confirmado na santavelharia 65017: com filtro = 1 disco; sem filtro = lixo. `looksVinyl` segue como última barreira. Pré-filtro seguro: no pior caso degrada pro comportamento atual                                                                                                                | —       |
| v0.33.1        | **Embrulho `Catalogo` + identidade durável + backfill fundo** — o JSON varia por casa: `[{PECAS}]` (Discos Esquecidos) vs `{Catalogo:[{PECAS}]}` (Catavento); `extractPecas` trata ambos (antes zerava o Catavento). `VALOR_VENDA` vem preenchido mesmo nos leilões antigos (com `VALOR_VALUE:"--"`/`MOSTRAVALOR:false`) → **backfill histórico viável**. Identidade da venda passa a usar `lot_ident` (álbum) como fonte durável, p/ leilões fora da janela e descritivos sem "Artista - Álbum"                                                                                                                                    | —       |
| v0.33.0        | **Catálogo via endpoint JSON** (`catalogocontentload.asp`) — as casas de vinil renderizam o `catalogo.asp` por JavaScript (fetch server pegava só a casca), mas o JS busca os lotes de `/templates/catalogo/asp/catalogocontentload.asp?leilao=<id>&pag=<n>&limit=30` (JSON). `fetchCatalogData` agora tenta esse JSON primeiro (campos `ID`/`LOTE`/`VALOR_VENDA`/`DESCRICAO`/`MOSTRABTN_CLASS`=`is-vendido`), com fallback ao HTML antigo. Valor de venda e status **inequívocos**; DESCRICAO limpa ("ARTISTA - ÁLBUM - CAPA `<grau>` - DISCO `<grau>`"). `debugSales` usa o mesmo caminho                                                                                                                            | —       |
| v0.32.3        | **Filtro de vinil híbrido** — o filtro só-por-snapshot (v0.32.2) derrubava TUDO, pois os leilões com catálogo vivo já saíram da janela. Agora: lote conhecido (`vinylById`) → identidade limpa nossa; lote desconhecido que **parece vinil** (grau Disco/Capa ou LP/vinil/compacto — `looksVinyl`) → identidade do descritivo (`catalogTitle`); resto (jornal/medalha/fósforo/CD/DVD) descartado                                                                                                                                                                                     | —       |
| v0.32.2        | **Captura de vendas só de VINIL + identidade limpa** — o `catalogo.asp` da casa lista TODAS as categorias (livros, DVDs, medalhas…); `captureFinishedSales` agora só grava lotes cujo id está no nosso vinil (`scrapeVinylLots`), e usa o **nosso** título/artista (não o texto ruidoso do catálogo). Descritivo do card limpo de fragmentos de href (`&ctd=…`). Ordem **mais recente primeiro** (catálogo vivo). `debugSales(num)` sonda um leilão específico                                                                                                                                                                             | —       |
| v0.32.1        | **Fix da segmentação do catálogo** — cada lote repete o link `peca.asp?ID=` no card (imagem + título), então o "pedaço" do lote passou a ir até o 1º link de um id **diferente** (o próximo card), não até o próximo link. Antes ficava truncado ANTES do "Valor de venda"/"Lote vendido"/descritivo → capturava 0 vendas e estado vazio. `?step=sales&reset=1` (`clearSalesCaptured`) re-captura após o ajuste                                                                                                                                                             | —       |
| v0.32.0        | **Estado (Disco/Capa) nos cards PRÉ-leilão** (`lot_condition`) — `enrichConditions` busca o catálogo (1 req/leilão) e parseia o descritivo do tooltip, cacheando por lote (`source` catalog/title/indefinido; re-avalia por `title_hash`); cron `step=condition` + `refresh.yml`; `getLotCondition` e o resolver `conditionFor` no `index.tsx` passam a **priorizar o cache** (fallback ao título). Nova tabela `lot_condition` (migration+setup+types). **Diagnóstico** `step=salesdebug` (`debugSales`) para sinais crus do catálogo quando `sales` volta 0                                                                                          | —       |
| v0.44.2        | **Roadmap de novos provedores de IA** (só doc): avaliação do proxy local `freellmapi` (descartado) + lista ranqueada de provedores a acrescentar à camada plugável (OpenRouter/Groq/Mistral + menções) e a alavanca do adaptador OpenAI-compatible genérico                                                                                                                                                                                                                                                          | #127    |
| v0.46.0        | **Analytics: excluir venda ou artista** — curadoria de exclusão (ocultar, sem deletar do banco; reversível), na leitura (`buildAnalytics`). Duas chaves em `app_state` (`analytics_excluded_sales` por `lot_id`, `analytics_excluded_artists` por chave de artista); botões "Excluir do Analytics" (venda, no `SaleDetailDialog`) e "Excluir artista" (grupo, no `ArtistEditDialog`), escrita otimista; painel "Ocultos do Analytics" (`HiddenPanel`) lista os ocultos e reinclui. Exclui o artista pela chave final + `sourceKeys` (robusto a fusão) | #128    |
| v0.45.1        | **`extractArtist` aceita nomes curtos com dígito** ("U2", "U4", "B52") — a trava `length < 3` descartava "U2" (virava `""`/ficava em "Lote"), então a IA nunca movia a venda para o artista certo. Agora 1 caractere nunca passa e 2 caracteres só com dígito (ruído "cd"/"lp" segue descartado). Corrige o caso "Lp U2, capa gatefold…" que ficava preso no balaio "Lote"                                                                                                                                                                                                | #128    |
| v0.45.0        | **Analytics: oculta lotes + balaio de coletâneas/novelas** — na leitura (`buildAnalytics`, sobre o histórico já gravado, sem re-capturar/deletar): venda cujo título é conjunto de discos (`isDiscBundle`) é **ocultada** (correção manual por venda ISENTA; captura continua gravando p/ a IA garimpar dentro do lote); coletâneas/novelas (`isCompilation`/`isVariousArtists`) vão para o balaio **"Coletâneas, Novela e etc"** (`ANALYTICS_COMPILATION_LABEL`, funde por `normalizeForMatch` com o balaio criado na curadoria); `isGenericArtist` passa a reconhecer `Discos\d+`/"proposta de lote" → a IA de identificação mira esses balaios | —       |
| v0.46.1        | **Fix: lotes de discos voltavam a aparecer no Analytics** — o "oculta lotes" do v0.45.0 checava só `isDiscBundle(row.title)`, mas o **próprio reident por IA** (`captureFinishedSales`, artista genérico inclui `"lote"` em `GENERIC_ARTISTS`) e o botão/cron **"Reidentificar (IA)"** (`reidentifyAllSales`) mandavam lotes CONFIRMADOS para a IA "garimpar" um artista dentro do texto — quando achava, reescrevia `title`/`artist` com o preço do **CONJUNTO inteiro** atribuído a um único álbum (poluindo a média) e o título deixava de bater com `isDiscBundle`, furando o filtro. Correção: (1) `buildAnalytics` agora também checa `isDiscBundle(row.orig_text)` (descritivo bruto, preservado mesmo após a IA reescrever o título) — re-oculta imediatamente na LEITURA o que já estava poluído em produção, sem precisar re-capturar; (2) `captureFinishedSales` e `reidentifyAllSales` passam a EXCLUIR lotes confirmados (`isDiscBundle`) dos candidatos enviados à IA, prevenindo nova poluição | —       |
| v0.46.2        | **Fix: `isDiscBundle` não pegava lote descrito em prosa** — título real "Lote composto por cinco LP's do cantor Roberto Carlos" não batia em nenhum padrão: só reconhecia "lote com/de" (não "composto por"/"formado por"/"contendo") e a quantidade só aceitava DÍGITO ("3 LPs"), não por extenso ("cinco LPs"). Adicionado: conectores composto/formado (de/por) + contendo; mapa de números por extenso (`NUM_WORDS`, dois…vinte) reaproveitando o mesmo limiar (≥3); e uma checagem genérica de "lote" + palavra de disco em qualquer lugar do título (cobre frases não previstas). ⚠️ Cuidado tratado: o **rótulo de numeração** do lote ("Lote 45 - Artista - Álbum", "Lote 09 vinil único...") usa a mesma palavra "lote" mas é sempre **1 disco** — `LOTE_NUMBER_PREFIX` remove esse rótulo (exige número OU separador logo após "lote") ANTES de qualquer checagem, senão o próprio nº do lote colado no formato ("09 vinil") disparava falso-positivo na regra de quantidade. Validado com 20 casos (bundle real, numeração pura, prosa sem dígito, coincidência nº+formato) | —       |
| v0.46.3        | **Fix: colecionismo geral e rótulo de casa poluindo o Analytics** — (1) itens **sem NADA a ver com disco** (ex-libris, pin de lapela, perfume, porta-moedas de couro…) apareciam como "álbuns" próprios: a casa lista tudo na mesma categoria "Disco de vinil" (ou não honra o filtro `Tipo=129`) e o texto não batia em nenhum formato bloqueado (CD/DVD/K7); `looksNonVinyl`/`looksNonVinylSale` ganham `NON_MEDIA_COLLECTIBLE_RE` (colecionismo geral: ex-libris/numismática/filatelia/perfumaria/couro…) e `PAPER_DIMENSION_RE` (callout "TAM: 12,4CM X 9CM", típico de gravura/print — disco não é descrito por dimensão item a item). (2) **código interno da casa virando "artista"** — "Discos5"/"Discos 6"/"Proposta de Lote Para Leilão" (já reconhecidos como lixo por `isGenericArtist`, mas só usado para mirar a IA) apareciam como balaio próprio no Analytics; `buildAnalytics` agora reroteia artista genérico/placeholder (exceto o balaio "Lote") para "Não classificados" | —       |
| v0.46.4        | **Fix: "Grandes Sucessos" de artista IDENTIFICADO preso em "Coletâneas"** — `isComp` mandava pro balaio "Coletâneas, Novela e etc" sempre que o TÍTULO batia num gatilho (`isCompilation`: "sucessos"/"grandes sucessos"/"trilha sonora"…), mesmo com o artista JÁ identificado (ex.: venda com `artist: "João Bosco"`, título "João Bosco - Os Grandes Sucessos" — um "best of" de UM artista, não uma coletânea de vários intérpretes). Agora a dica do título só conta quando o artista TAMBÉM é genérico/desconhecido (`isGenericArtist(rawArtist) && isCompilation(row.title)`); `isVariousArtists(rawArtist)` sozinho continua mandando pro balaio incondicionalmente (esse é sempre "vários artistas" de verdade) | —       |
| v0.46.5        | **Fix na raiz: `extractArtist` desistia cedo demais em título com "sucessos"/"melhores"** — o v0.46.4 só ajudava quando `row.artist` JÁ estava correto; a causa raiz é mais funda: `extractArtist` (que calcula o `artist` GRAVADO na captura) tinha um bail-out no TÍTULO INTEIRO por `UNCLASSIFIED_HINTS` ANTES de tentar separar "Artista - Álbum" — "Jorge Ben Jor - Grandes Sucessos"/"Grandes Sucessos de Ray Charles" nunca chegavam a extrair o nome, ficando com artista vazio desde a captura. Corrigido: (1) o bail-out agora roda só no CANDIDATO final (não no título inteiro), então um nome à esquerda do "-" sobrevive mesmo com "sucessos" no resto; (2) novo padrão `COMPILATION_TAIL_RE` pega "Sucessos/Grandes Sucessos/As Melhores/O Melhor **de/do** X" (sem traço) e usa X como candidato, com trava `COMPILATION_SERIES_QUALIFIERS` pra não promover nome de SÉRIE ("Sucessos de Ouro") a "artista Ouro"; (3) candidato final também é checado contra `COMPILATION_HINTS` (não só `UNCLASSIFIED_HINTS`) — sem isso, "As Melhores da MPB" (sem "-", sem "de X") virava "artista" ao rederivar. `buildAnalytics` ganha **rederivação ao vivo**: quando `row.artist` gravado está genérico/vazio, tenta `extractArtist(row.title)` de novo na LEITURA — corrige a base JÁ GRAVADA sem re-capturar nem rodar IA; `isVariousArtists(rawArtist)` NUNCA é rederivado (sinal forte, preserva "Various Artists" já correto) | —       |
| v0.46.6        | **Fix: "AC/DC" espalhado em 3 grupos (2 bugs)** — (1) a limpeza do candidato em `extractArtist` cortava em `/` (pensado pra parênteses/aspas), truncando "AC/DC" pra "AC", que morria no filtro de tamanho mínimo → artista SEMPRE vazio para essa grafia; removido `/` do corte (bandas usam a barra no próprio nome). (2) mesmo corrigido, "ACDC" (casa digita colado, sem separador) normaliza pra chave `acdc` — diferente de "AC DC"/"AC-DC"/"AC/DC" (todas viram `ac dc`, separador vira espaço) — ficando em grupo à parte. Novo `canonicalizeCollapsedArtist` (índice preguiçoso sobre `KNOWN_ARTISTS_SEED`: forma colada → grafia canônica do bundle, casamento EXATO) une as 4 grafias em "AC/DC"; aplicado no fim de `extractArtist` (novas capturas) E em `buildAnalytics` sobre o `rawArtist` já gravado (corrige a base JÁ GRAVADA na LEITURA, sem re-capturar) | —       |

> Observação: PRs #63/#64/#66 foram mesclados via API **sem** bump; a versão foi consolidada
> depois. O `version-bump.yml` só barra merge pela UI — reforça a convenção de sempre bumpar.

## Pendências

**Produto / código (em aberto)**

- _Nenhuma pendência em aberto._ (Os itens anteriores — lance pelo app, upload de foto em massa,
  peso da sondagem na nota e imagem pelo CDN do catálogo — foram **cancelados/descartados**.)

**Roadmap — novos provedores de IA (avaliado, não iniciado)**

Avaliamos o repo `tashfeenahmed/freellmapi` (proxy **local** `localhost:3001`, OpenAI-compatible,
declaradamente *"not production"*) e **descartamos integrá-lo**: o app roda server-side em
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

**Validar em produção**

- ✅ **Validações confirmadas** — `setup.sql` aplicado (tabelas/colunas mais recentes), env da
  Vercel (`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`DISCOGS_TOKEN`) e cron `refresh.yml` (incl.
  `condition`, `sales`, `reident`, `market`) conferidos em produção; v0.41.0 (seletor de IA,
  "Reidentificar (IA)", header sticky, failover do Gemini e visão/capa) verificada.
- **Custo Gemini (referência):** `gemini-flash-latest` ≈ US$0,75/US$3,75 por 1M tok in/out (mais
  barato que o Haiku 4.5); o alias `-latest` acompanha o Flash mais novo — para fixar, usar
  `GEMINI_MODEL`.

> ⚠️ **Lição (evitar regressão):** módulo **`*.server.ts` NÃO deve importar de módulo
> client-safe** (nem `import type`). No v0.24.0, `app-state.server.ts` importava um tipo de
> `wantlist-match` → o _code-splitting_ deixou o chunk `wantlist-match-*.js` fora do `/assets/`
> do cliente → **404** ("Failed to fetch dynamically imported module") só na home logada em
> produção. Corrigido no v0.24.1 definindo o tipo localmente. Tipos compartilhados entre client e
> server: manter no lado **client-safe**.

# Histórico de vendas (`lot_sales`) e Vinil Analytics

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

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
  `getVinylSales` (ler) em `analytics.functions.ts` (a captura roda pelo cron `step=sales`).

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
  `setAnalyticsAlbumAlias`/`clearAnalyticsAlias`; server fns homônimas em `analytics.functions.ts`.
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
  `scoreCondition`), valor/inicial/custo, demanda e link; ~~sem imagem por ora~~ resolvido em
  v0.77.0 — ver essa versão no Histórico e a seção do cron/`salesthumbs`.
- **Resolver não identificados por venda + texto original (v0.43.0):** muitas vendas caem no
  balaio **"(álbum não identificado)"** (`deriveAlbum` devolve o placeholder quando o derivado é o
  próprio artista, ex.: "Rita Lee - Rita Lee"). Duas mudanças:
  - **`orig_text` em `lot_sales`** (nova coluna, migração `20260909150000_lot_sales_orig_text.sql`
    - `setup.sql`): guarda o **descritivo COMPLETO do card do catálogo** (o mesmo `data.text` que
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
- **Rodar a IA em TODOS os álbuns do artista, de uma vez (v0.82.0):** pedido do usuário — antes,
  cobrir todos os álbuns de um artista exigia abrir cada álbum e clicar no `IaButton` dele, um a
  um. Novo botão **`IaAllAlbumsButton`** (ícone `Layers`, ao lado do `IaButton` do artista) chama
  o handler de página `reidentifyAllAlbums`, que dispara **uma chamada de `reidentifySales` por
  álbum** (a MESMA rotina que o botão de um álbum já faz, só que em sequência automática, sem
  loop até `done` — mesmo cuidado de não reprocessar eternamente os sem solução) e agrega os
  resultados (`identified`/`remaining`) num único toast + uma única invalidação de
  `["vinyl-sales"]` ao final. Sem mudança no servidor — só orquestra `reidentifySales` (já
  existente) por álbum em vez de depender do clique manual em cada um.
- **IA agrega ao álbum já existente do artista (v0.81.0):** pedido do usuário — a reidentificação
  por IA (global e por artista/álbum, `reidentifyAllSales`) tratava cada álbum identificado pela
  IA como grafia nova, então uma pequena variação ("Construção" vs "A Construção") virava um
  balaio **quase-duplicado** em vez de cair no álbum que já existe. Ordem agora é **artista
  primeiro (chave principal), álbum depois, dentro do universo daquele artista**: depois de
  canonizar o artista (como já fazia), monta `albumsByArtist` (chave = artista canônico
  normalizado → álbuns já vistos naquele artista, via `deriveAlbum` sobre os títulos atuais) e,
  pro álbum que a IA identificou (lado direito de "Artista - Álbum", novo `extractAlbumPart` em
  `vinyl-parse.ts` — mais confiável que `deriveAlbum` porque o formato da IA já é limpo), procura
  o **mais provável já existente NAQUELE artista** com o novo `matchExistingAlbum` (exato por
  `normalizeForMatch` vence; senão, maior similaridade por token — Jaccard — acima de `0.6`) e
  usa a grafia existente em vez da nova, agregando a venda ao bucket que já existe. Só entra em
  jogo quando a IA identifica algo NESTA rodada (`albumById`); vendas já resolvidas antes não são
  tocadas. Também corrigido o diálogo de **correção manual por venda** (`SaleDetailDialog`): a
  sugestão (`<datalist>`) de álbum agora só oferece os álbuns **daquele artista** digitado/
  selecionado (novo `Suggestions.albumsByArtist`, montado junto dos apelidos na página) — cai de
  volta na lista completa só quando o artista ainda não tem nenhum álbum conhecido.
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
  `analytics.functions.ts`.
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

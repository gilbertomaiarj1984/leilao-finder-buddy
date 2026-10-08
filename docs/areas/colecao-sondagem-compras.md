# Coleção, Sondagem (obras caçadas) e Compras

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

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
  (`Tabs`): **Títulos** (padrão desde a v0.114.0; lista simplificada — `CollectionTitleRow`: hover/toque
  na linha abre o **card completo flutuante** (`Popover`; **só um card aberto por vez** — `activeCardId` no módulo; **clicar na linha trava o card** — fecha ao clicar fora/Esc/na linha de novo) com Editar/reprocessar/remover/tags/tracklist)
  e **Cards** (`CollectionCard`, mesmo visual dos cards de leilão). **Filtro por artista** (`ArtistFilter` reusado) + **busca** por
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
  - **Compressão automática (v0.57.0):** o Storage é a maior fonte de **egress** do plano free do
    Supabase (fotos servidas em resolução cheia toda vez que a galeria abre), não as leituras de
    banco (essas já são column-scoped/paginadas). `compressCollectionImage` (`collection.server.ts`)
    redimensiona (lado maior ≤ 1600px, `withoutEnlargement`) e recodifica em **WEBP q82** via
    `sharp` antes de gravar no bucket; `uploadCollectionImage` chama isso sempre, e o upload leva
    `cacheControl: 604800` (7 dias).
  - **Backfill das fotos já existentes (v0.58.0):** lógica compartilhada em
    `listUncompressedCollectionImages`/`backfillCompressCollectionImage` (`collection.server.ts`) —
    acha as que ainda não são `.webp`, baixa, comprime, sobe em novo path, atualiza `image` e
    remove o blob antigo. Dois jeitos de rodar: **(1)** `scripts/compress-collection-images.ts`
    (`bun run compress-images`), local, roda tudo de uma vez — precisa de rede direta ao Supabase
    (não funciona em sandbox com allowlist restrita) e `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
    no `.env`; **(2)** step `compressimages` do `/api/cron` (`cron.server.ts`), chunked
    (`max`, default 10) como `enrich`/`condition` — roda na Vercel (já tem rede pro Supabase),
    dispara com `curl -H "x-cron-token: $CRON_TOKEN" "$APP_URL/api/cron?step=compressimages&max=10"`
    em loop até `done=true`. Nenhum dos dois faz parte do laço 4x/dia do `refresh.yml` (é
    backfill único, não recorrente). Sem estado entre chamadas do cron: uma foto que falha
    (ex.: URL morta) volta a aparecer na próxima chamada — se `failed` não zerar, resolver a
    linha manualmente em `collection_items` em vez de repetir.
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
- **Tracklist (v0.114.0):** o ícone do card mostra `collection_items.tracklist` (jsonb, formato de
  `lot_ai.tracklist`) ou, na falta, a do lote de origem. Sem nenhuma, o botão fica **clicável** →
  `fetchCollectionTracklistFn` → `fetchCollectionTracklist` (`collection.server.ts`): pede à IA SÓ a
  tracklist (`buildTracklistPrompt`, texto, sem tocar em artista/álbum/ano) e grava; se a IA não soube,
  não grava (dá para tentar de novo).
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
- **Sem varredura própria (v0.70.0):** a Coleção não lê mais "Minhas compras" diretamente — os
  botões "Atualizar coleção"/"Varredura completa" (que chamavam `importWonLotsIncremental`/
  `importWonLots` em `collection.server.ts`, com o parser `parsePurchaseTitle` e a fila de
  duplicados para revisar) foram **removidos**. Quem varre "Minhas compras" agora é só a página
  **Compras** (`/compras`, ver seção própria); a Coleção passa a ser povoada por **"Enviar para a
  coleção"** a partir de lá (abaixo), por importação em massa (`importCollectionText`, mantida) ou
  manualmente. `canonicalArtist`/`albumKey` (reduzir coletânea/lote à categoria; de-dup por
  artista+álbum) continuam em `collection.server.ts`, reusados pela importação em massa.
- **"Enviar para a coleção" (a partir de `/compras`):** cada `PurchaseCard` sem relação
  confirmada mostra um botão que abre um diálogo de edição (`SendToCollectionDialog`, em
  `compras.tsx`) pré-preenchido com um palpite de artista (`extractArtist`/`titleCase` sobre o
  título, client-safe) — álbum, ano, grading e tags ficam em branco para o usuário completar antes
  de confirmar. Ao enviar, chama `addCollectionItem` (`collection.functions.ts` →
  `collection.server.ts`) com `lotId` = o `lot_id` da compra: grava `source: "auction"` e
  `lot_id` preenchido (igual à antiga varredura direta), herdando valor pago/data/casa/UF/imagem
  da própria compra. Recusa reenviar a mesma peça duas vezes (`existing.some(i => i.lotId ===
input.lotId)`).
  - **Lote com vários LPs (v0.102.0):** o diálogo tem **"Adicionar disco"** (abaixo de "Identificar
    pela IA"), que abre o `EditDialog` da Coleção pré-preenchido com o que está na tela
    (artista/álbum/ano/grading/tags/descritivo/notas, capa e data da compra; **valor pago em
    branco** — o usuário digita). O extra é gravado por `addCollectionItem` com `originLotId` (coluna
    `collection_items.origin_lot_id`, só **rastro** da compra; `lot_id` segue `UNIQUE` e fica com o
    disco principal). Pode repetir N vezes. Rodapé: **"Enviar para coleção"** (cria o disco principal,
    vinculando `lot_id`) e **"Item já enviado"** (habilitado após ≥1 extra; vincula a compra ao
    último extra via `applyCollectionDecision`, sem criar outro disco).
- **IA por TEXTO (opt-in, gasta créditos):** dois caminhos, ambos via **`identCollectionSync`**.
  - **Em massa — botão "Identificar novos (IA)"** (v0.115.0: abre um menu com 2 ações — **Identificar faixas**: laço no cliente chamando `fetchCollectionTracklistFn` para cada disco sem tracklist própria nem do lote (fora "Lote"/"Coletâneas"/sem artista), com progresso no botão; e **Avaliar nome do disco/artista**: o fluxo abaixo) → `identifyCollection({offset, max,
onlyUnidentified})` → `reidentifyCollection`. Gasta IA **só nos discos ainda sem
    identificação** (`collectionNeedsIdentification` em `vinyl-parse.ts`, client-safe: artista vazio/`UNCLASSIFIED_LABEL` OU álbum vazio — exceto os baldes "Lote"/"Coletâneas", que nunca têm álbum único), pulando os já
    identificados **sem custo** — uso ROTINEIRO e barato (a varredura de compras acrescenta poucos
    discos por vez). O `onlyUnidentified` é sempre `true` a partir da UI; o modo completo
    (`false`, re-normaliza TODA a base) segue existindo na server fn mas **não é exposto** — o
    reprocesso forçado é POR CARD (abaixo). O **cursor `nextOffset` anda sobre a lista COMPLETA e
    estável** (ordenada por `id`), coletando até `max` discos que precisam de IA e pulando os já
    identificados; assim itens que saem do filtro ao serem identificados **não deslocam o cursor**
    (nada é pulado entre rodadas). Só **preenche/melhora** (nunca apaga com resultado vazio; o
    descritivo só quando vazio).
  - **Por disco — ícone "reprocessar" (`RotateCw`) no card** (v0.115.0: abre um menu **1 · Na imagem da capa** / **2 · No nome do artista e do álbum** / **3 · Com uma dica minha** (texto livre `hint` ≤600 chars, + checkbox "usar também a capa"; a dica tem prioridade máxima no prompt e dispensa o atalho "Lote"; abrir o menu trava o card flutuante); `mode: "image"|"text"`. O modo imagem manda a capa (URL http(s)) à IA SEM as pistas de texto atuais e exige capa acessível; o texto é o fluxo de sempre) → `reprocessCollectionItem({id, mode})` →
    `reidentifyCollectionItem`. Refaz UM disco pela IA e **SOBRESCREVE** artista/álbum/ano e o
    descritivo com o que a IA devolver (nunca zera com vazio). É o "refazer" manual para corrigir
    um disco específico sem reprocessar a base toda. Estado de "girando" por-id no card.
  - Em ambos, conjuntos/coletâneas seguem classificados pelo título SEM gastar IA. A IA em si
    (`identCollectionSync`, `ai-collection.server.ts`, SÓ TEXTO), além de artista/álbum/ano, gera o
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
  de `l=6` não precisa ser exaustiva a cada clique — daí a incremental (por leilão vencido) ser
  o padrão; a **completa** (`id=0`, irrestrita) fica para carga inicial / emergência.
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

## De olho — "ficar de olho" (`lookout_items`, v0.107.0)

- **O que é:** o usuário marca um lote (ícone de binóculos na linha de ações do `LotCard`, ao lado
  de Vigiar/abrir/excluir) como **compra muito em vista**. Quando o MESMO disco reaparecer em
  outro lote futuro, o card é destacado e a página **De olho** (`/olho`, botão no header da home
  com contador de novos) lista os matches. **Não usa a vigia**: ela vive na conta do LeilõesBR e
  não persiste nada local — por isso tabela própria.
- **Tabela `lookout_items`** (`setup.sql` + `migrations/20261005120000_lookout.sql`): `lot_id`
  (UNIQUE, lote de origem), snapshot (`artist`, `album`, `year`, `title`, `house`, `image`, `url`,
  `day_key`), `max_price` (teto, opcional), `note`, `status` (`active`/`acquired`/`dismissed`).
  **Sem FK para `lots`** — `pruneOutOfWindow` apaga lotes antigos e o marcador sobrevive pelo
  snapshot. CRUD em `lookout.server.ts` (`addLookoutFromLot` idempotente por `lot_id`: reativa sem
  sobrescrever teto/nota) exposto por `lookout.functions.ts` (`toggleLookout`, `updateLookout`,
  `deleteLookout`, `setLookoutLink`, `markLookoutSeen`, `getLookoutOverview`, …).
- **Estado em `app_state`:** `lookout_links` (`lotId → itemId | false`: ✓ confirma / ✕ descarta UM
  lote), `lookout_seen` (chaves `lotId|itemId` já vistas na página → "novo"/contador) e
  `lookout_notified` (dedupe do aviso externo). Listas limitadas às 2000 mais recentes.
- **Casamento** (`lookout-match.ts`, puro/client-safe): reusa o motor da Coleção
  (`ownedCandidate`/`ownedScore` de `wantlist-match.ts`) — artista×artista e álbum×álbum, não
  palavras soltas; apelidos de artista do Analytics (`resolveArtistAlias`). O item faz o papel do
  "disco da coleção". `matchLookoutForLot` ignora o lote de origem, respeita `lookout_links` e
  aceita score ≥ 0,6 (`LOOKOUT_MATCH_MIN`); ≥ 0,8 (`LOOKOUT_CONFIDENT_MIN`) ou confirmado = selo
  cheio e elegível a aviso, abaixo = "?" com ✓/✕. Só itens `active` com artista real e álbum
  viram candidatos (buckets "Lote"/"Coletâneas" e item sem álbum não casam — a UI avisa e a
  página tem lápis para corrigir artista/álbum/ano). `buildLotIdentity` replica a identidade da
  home (artista efetivo + álbum IA + release Discogs).
- **Destaque no card:** prop `lookout` do `LotCard` (`{on, hit, maxPrice}`; fiação em
  `use-dashboard-data.tsx` → `lookoutProps(lot)` espalhado nos cards de `day-tab.tsx` e
  `watched-tab.tsx`; a seção de lances não recebe). Borda **fúcsia**; precedência
  **lance > vigia > de olho**. Selo "De olho · NN%" (+ "abaixo/acima do teto" vs. valor atual).
  O lote marcado também fica fúcsia, com o botão preenchido.
- **Página `/olho`:** `getLookoutOverview` → `computeLookout` (`lookout-matches.server.ts`, fonte
  única da página, do contador e do aviso): lotes de hoje até +14 dias (retenção de `lots`) que
  ainda não terminaram, com IA/Discogs; por item mostra teto/nota editáveis, matches **por vir**
  (Vigiar via `toggleWatch`, abrir, ✓/✕, "novo") e **aparições anteriores** = vendas arquivadas
  em `lot_sales` (≥ 80%, sem kits) com faixa de preço vendido. **Desde a v0.109.0 soma também o
  Analytics** (`lookout-analytics.ts`, puro): `buildAnalytics` agrega as vendas (IA, correção por
  venda, apelidos, exclusões, kits fora, singular/plural) e cada álbum agregado que casa (≥ 80%)
  com o item contribui com suas vendas; união por `lot_id` (em duplicata vale a linha do
  Analytics), vendas ocultadas no Analytics (`excludedSales`) não contam, o lote de origem e os
  lotes descartados (✕) ficam de fora; mostra Disco/Capa, link e média. Chave-mestra
  `LOOKOUT_HISTORY_FROM_ANALYTICS` em `lookout-matches.server.ts` (`false` = comportamento
  anterior). Limite: títulos ruidosos ("Profana (RCA)") viram álbum separado no Analytics e não
  casam (precisão antes de cobertura) — a correção por venda no Analytics resolve. Abrir a página marca os matches
  como vistos (zera o contador do menu; o selo "novo" daquela visita permanece). O contador do
  menu usa a versão leve (`history: false`, staleTime 15 min).
- **Disco de nome genérico → validação por ANO (v0.111.0):** quando o nome do álbum é o do próprio
  artista (homônimo — `selfTitled`) ou só tem termos genéricos ("Ao Vivo"), o nome não distingue
  (o artista tem vários discos assim), então só o ano distingue (`yearVerdict`,
  `lookout-match.ts`): o lote/venda cita o ano do item → ok; cita só outro(s) ano(s) → rejeita; não
  informa ano (ou o item não tem ano) → **"a validar"** (score limitado a 0,7: nunca confiante, nunca
  avisa por ntfy). Anos considerados: texto do título/álbum/release, `lot_ident.year`
  (`knownYear`) e Discogs. No histórico, as pendentes ficam numa lista própria (✓ confirma =
  `lookout_links[lotId]=itemId`, ✕ descarta = `false`, "Descartar todas" via
  `setLookoutLinksBatch`) e **não entram na contagem nem na média**; para as pendentes o servidor
  ainda olha o descritivo completo (`lot_sales.orig_text`, só dos pendentes, até 300) e confirma
  se ele cita o ano do item (nunca rejeita por aí). No Analytics o ano é conferido venda a venda
  (o álbum agregado junta vários anos). Vale também para lotes futuros ("?" + dica no tooltip).
- **Sem repetição e "Juntar" (v0.117.0):** `addLookoutFromLot` reaproveita o item existente quando o lote
  (de origem de um item/álbum juntado) ou o artista+álbum normalizado já está cadastrado
  (`lookoutIdentityKey`; reativa se estava arquivado). **Juntar** (`mergeLookout` →
  `mergeLookoutItems`): o item absorvido vira snapshot em `lookout_items.merged` (jsonb) do destino
  e é apagado; `lookoutCandidates` expande cada álbum juntado em candidato extra com o MESMO id do
  item (casa com qualquer um dos nomes). UI: arrastar o cartão sobre outro ou botão "Juntar"
  (seletor); ✕ no chip "Juntado com" separa (`unmergeLookout`). **Binóculos na home:** `lookout.on` =
  lote de origem (inclui os dos álbuns juntados) OU casamento confiante; desmarcar um lote que só
  casa = "não é este disco" (`lookout_links`). **Por vir inclui o lote de origem**
  (`includeOrigin` → `isOrigin`: score 1, selo "origem", nunca "novo" nem aviso ntfy). **Página:**
  grupos por artista (A→Z, "sem artista" por último), busca por artista (botão/Enter) e combo com
  nº de álbuns por artista. **Adquirido** = `status acquired` no item (leva todos os álbuns
  juntados) + remove a vigia real de todos os lotes dele (`acquireItem` em `olho.tsx`).
- **Identificar por IA (v0.110.0):** botão ✨ sob o lápis no card do item de `/olho` →
  `identifyLookout` → `identifyLookoutItem` (`lookout-ident.server.ts`, isolado): usa
  `identLotsSyncRows(…, withImage=true)` (mesmo prompt/parser da identificação dos lotes, **texto
  do lote de origem + foto**), provedor padrão do usuário com failover; se a chamada com imagem
  falhar (casa bloqueando a foto), repete só com o texto. Só preenche/melhora artista/álbum/ano
  (nunca apaga com resultado vazio); depois os matches são recalculados. Gasta créditos de IA —
  só sob demanda. O toast mostra o resultado, a confiança e se houve troca de provedor.
- **Aviso externo (ntfy.sh):** `step=lookoutnotify` do cron (`refresh.yml`, depois de
  aiident/market, antes da faxina, via `call_soft` — falha não reprova a run) →
  `notifyLookoutMatches`: para cada match confiante ainda não avisado (`pickNotifiable`, dedupe
  `lotId|itemId` gravado SÓ após o envio) faz um POST JSON (UTF-8) em `NTFY_SERVER`
  (padrão `https://ntfy.sh`) no tópico `NTFY_TOPIC`; prioridade alta quando o valor atual está
  dentro do teto; `Click` = `PUBLIC_BASE_URL/olho`. Máx. 8 pushes por rodada, o resto vira um
  resumo. **Sem `NTFY_TOPIC` é no-op.** Ao marcar o primeiro disco, lotes já casando disparam
  (limitado pelo teto acima).
- **Limites conhecidos:** o histórico só vê o que `lot_sales` guarda (e artista/título gravados);
  `lots.price` é o valor da listagem (pode estar defasado); o estado "vigiando" da página vem da vigia
  real (`useWatchedQuery`: mesmo cache/acumulador da home e da Análise, casando por `idPeca`;
  vigiar/desvigiar atualiza o acumulador na hora, sem invalidar a query); scraping/ntfy não são testáveis no ambiente de desenvolvimento (validado com banco
  local + servidor HTTP falso no lugar do ntfy).

## Compras do usuário (`purchases`, v0.61.1–2)

- **Histórico de "Minhas compras" (vinil), PERSISTIDO** — diferente de Vigia/Lances (sempre lidos
  ao vivo, sem tabela). Página `_authenticated/compras.tsx` (menu **Compras** no header do
  `index.tsx`), mais recente primeiro por padrão, com 3 visões por botão toggle (`aria-pressed`,
  mesmo idioma de "Vigiados/Lances do dia" em `index.tsx`): **mais recentes** (lista simples),
  **por dia** (agrupado por `won_date`) e **por casa** (`groupWatchedByHouse`, reaproveitado de
  `grouping.ts` sem alteração — `Purchase` já tem `house`/`lote`, `houseUrl` recebe a URL do lote
  por conveniência de tipo, mas não é usada como "site da casa" na UI).
- **Agrupamento aninhado, sem misturar dia/casa (v0.61.2):** cada visão traz a outra dimensão
  como sub-agrupamento — "por dia" separa as compras de cada dia por sub-cabeçalho de casa; "por
  casa" separa as de cada casa por sub-seção de dia (`groupPurchasesByHouse`/`groupByDay`
  reaproveitados nos dois sentidos). "Dia" é a unidade **colapsável** recorrente nas duas visões
  (`DaySection`, `ChevronDown`/`ChevronUp`) — top-level em "por dia", aninhada dentro de cada casa
  em "por casa" — sempre com o dia mais recente ABERTO por padrão e os demais FECHADOS
  (`useState(defaultOpen)` por instância de `DaySection`, chave estável = string do dia; sem
  `useEffect` de resync — o toggle manual do usuário sobrevive a um refetch enquanto o dia
  continuar existindo). "Casa" nunca é colapsável, só um cabeçalho de agrupamento.
- **Tabela própria `purchases`** (`supabase/setup.sql` + `supabase/migrations/…_purchases.sql`):
  `lot_id` (UNIQUE, `"${idLeilao}-${idPeca}"`), `id_peca`, `id_leilao`, `base`, `lote`, `title`,
  `won_price`, `won_date`, `url`, `image`, `house`, `uf`, `domain`. **Independente de
  `collection_items`** — mesma descoberta de leilões vencidos (`wonAuctionIdsFromBids`, `l=4`),
  mas gravação separada: um lote arrematado pode aparecer nas duas tabelas (Compras é o
  histórico bruto; Coleção é o catálogo editável agrupado por artista/álbum).
- **Sync incremental (`purchases.server.ts`):** `syncPurchasesIncremental()` — `listMyBidsFromSite()`
  (`l=4`) → `wonAuctionIdsFromBids` → `listVinylPurchasesForAuctions(auctionIds)`
  (`leiloesbr-purchases.server.ts`, `l=6&id=<idLeilao>`) → `upsert` por `lot_id` (idempotente,
  não duplica ao reprocessar um leilão já visto). **Sem fallback de backfill automático** (a
  tabela é nova — o histórico inicial entra pela **varredura completa manual**,
  `syncPurchasesFull()`, botão "Varredura completa" na página, que usa `listVinylPurchases()`
  sem restrição de leilão, igual ao equivalente da Coleção).
- **Cron:** novo `step=purchases` (`cron.server.ts`) chama `syncPurchasesIncremental()` — 1
  chamada por rodada do `refresh.yml` (barato, sem paginação cega), rodando junto com os demais
  steps 3x/dia.
- **Server functions (`purchases.functions.ts`):** `getPurchases` (leitura, best-effort `[]` em
  erro), `scanPurchases` (botão "Atualizar" → incremental), `scanPurchasesFull` (botão
  "Varredura completa" → escape hatch caro).
- **Card (`PurchaseCard`, `components/vinyl/purchase-card.tsx`):** enxuto (sem edição/tags/grading
  próprios, ao contrário de `CollectionCard`) — imagem, título, casa/UF, valor pago, data e nº do
  lote, link "Ver no leiloeiro". Ganhou (v0.70.0) o selo de relação com a Coleção e o botão
  "Enviar para a coleção" — ver abaixo.
- **Relação com a Coleção + "Enviar para a coleção" (v0.70.0):** a Coleção deixou de ter
  varredura própria (ver seção "Coleção do usuário" acima) — `/compras` passa a ser o ponto de
  entrada para povoá-la a partir de uma compra:
  - **Selo de relação** (ícone `Disc3` no canto do card, `compras.tsx`): reaproveita a MESMA
    infraestrutura da home (`collection_links`/`collection_feedback` em `app_state.server.ts`,
    `resolveOwned`/`OwnedPanel` de `wantlist-match.ts`/`owned-panel.tsx`), casando pelo `lot_id`
    EXATO da compra (`ownedByLotId`, análogo ao `ownedByLotId` de `index.tsx`) — sem o casamento
    fuzzy por tokens (`ownedMatchForLot`), que a home usa para lotes "candidatos" ainda não
    comprados; aqui a compra já é a peça exata, então só o `lot_id` interessa. Roxo = já
    relacionado (enviado por este fluxo, ou vinculado manualmente a um disco pré-existente);
    cinza = sem relação. Clicar abre o `OwnedPanel` (mesmo componente da home) para confirmar,
    vincular a outro disco da Coleção, marcar "não tenho" ou reativar — a decisão grava em
    `collection_links`/`collection_feedback` via `applyCollectionDecision`, **compartilhado**
    com a home (útil quando o disco já estava na Coleção antes deste recurso existir, cadastrado
    manualmente sem `lot_id`).
  - **Botão "Enviar para a coleção"** (só aparece sem relação confirmada): abre
    `SendToCollectionDialog` (`compras.tsx`) pré-preenchido com um palpite de artista
    (`extractArtist`/`titleCase`, client-safe, sobre o título da compra) — álbum, ano, grading e
    tags ficam em branco para completar antes de confirmar. Ao enviar, chama `addCollectionItem`
    com `lotId` = o `lot_id` da compra, herdando valor pago/data/casa/UF/imagem dela; grava
    `source: "auction"` e recusa reenviar a mesma peça duas vezes.
  - **`GradeSelect`** (escala de 10 graus M…F/P) extraído de `colecao.tsx` para
    `components/vinyl/grade-select.tsx` — reusado por `SendToCollectionDialog` e pelo diálogo de
    edição da Coleção.
  - **Botão "Identificar pela IA" no diálogo de envio (v0.71.0):** antes de confirmar, chama
    `identifyPurchaseDraft` (`collection.functions.ts` → nova `identifyDraftFromTitle` em
    `collection.server.ts`) — mesmo prompt/modelo do reprocessar por card da Coleção
    (`identCollectionSync`, `ai-collection.server.ts`, SÓ TEXTO, nunca a capa), rodando com um `id`
    avulso ("draft") já que o disco ainda não existe em `collection_items`; **não persiste
    nada**. Preenche artista/álbum/ano/descritivo/tags no formulário (tags são ACRESCENTADAS às
    já digitadas, via `mergeTagsText`, sem duplicar) para o usuário revisar/ajustar antes de
    "Enviar" — mesmo aviso de failover de provedor (`formatFailoverTrail`) das outras telas de IA.
    Usa sempre o provedor padrão do `app_state` (sem seletor próprio no diálogo).

# Coleção do usuário e edição do disco

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Coleção do usuário (`collection_items`)

**Exportar (v0.190.0):** botão "Exportar" no topo da tela abre o `ListDialog` (o mesmo da lista de leilões, `house-lot-list.tsx`) com `formatCollectionList` (`lib/collection-export.ts`): uma linha por disco, "Artista — Álbum (ano)" + "Disco/Capa" só se houver estado; ordem artista/álbum; respeita filtro de artista e busca.

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
  o antigo CRUD da Sondagem) exposto por `collection.functions.ts`
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
  `fetchCollectionTracklistFn` → `fetchCollectionTracklist` (`collection.server.ts`): busca as faixas no
  **Discogs** (v0.124.0, `buildTracklist`, sem tocar em artista/álbum/ano) e, se houver IA, aplica a fama
  (`rateFame`; opcional — sem IA as faixas ficam sem fama); se o Discogs não achou, não grava (dá para
  tentar de novo). As tracklists antigas (da IA) foram zeradas na migração única (ver `ia.md`).
- **Código de barras / nº do disco (v0.136.0):** coluna `collection_items.barcode` (texto; EAN/UPC
  ou nº de catálogo). `EditDialog` ganhou o campo + botão **Ler** → `DiscCodeScannerDialog`
  (`disc-code-scanner-dialog.tsx`): câmera traseira via `getUserMedia`; leitura **ao vivo** das
  barras no navegador (`BarcodeDetector` nativo ou `@zxing/browser` como fallback, carregado sob
  demanda) e botão **"Ler texto/número (foto)"** que manda um quadro (≤1280px) a
  `readDiscCodePhoto` → `readDiscCodeFromPhoto` (`disc-code.server.ts`, IA de visão via `runText`;
  `AiRequest.image` aceita `data:` URL) → `extractDiscCodes`. Campo manual como último recurso. O
  código é conferido por `lookupDiscCode` → `findReleaseByCode` (`discogs.server.ts`: busca
  `barcode=`/`catno=`, vinil primeiro) e o diálogo mostra o disco achado; no formulário só
  preenche o que estiver **vazio** (artista/álbum/ano/capa). Parsing/validação puros em
  `disc-code.ts` (`parseDiscCode`, `extractDiscCodes`, checksum GTIN; testes em
  `tests/disc-code.test.ts`). **"Atualizar faixas"** (card): sem código salvo, abre o leitor
  (com "Buscar só pelo nome"); ao confirmar grava o `barcode` e busca. `fetchCollectionTracklist`
  usa o release achado pelo código (cai na busca por nome se falhar).
  A câmera exige HTTPS (produção ok).
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
- **Série escrita de outro jeito (v0.185.0):** `ownedScore` (`wantlist-match.ts`) exige todas as palavras distintivas do álbum em sequência no título; "Historia da Musica Popular - Tom Jobim" × "MUSICA POPULAR BRASILEIRA TOM JOBIM" dava 0. Agora, com o artista CONFIRMADO (campo estruturado) e nome distintivo de 3+ palavras, faltar UMA delas ainda marca como candidato incerto (`OWNED_PARTIAL_ALBUM_SCORE` = 0,65, "?", nunca confiante) se as demais (2+) vêm em sequência a ≤ 3 palavras do nome do artista (`almostInTitle`); ano conflitante zera. Testes: `tests/wantlist-match.test.ts`.

## Edição do disco: original × reedição (v0.182.0)

Problema: o mesmo artista tem álbuns **homônimos** de anos diferentes (Caetano Veloso 1968 × 1986) e
os lotes às vezes são **relançamentos modernos** do mesmo álbum — para o colecionador, o original e
o relançamento moderno são discos diferentes (valor e interesse), enquanto reedições **de época**
continuam sendo "o disco". Núcleo puro/client-safe em `src/lib/album-edition.ts`:

- **Duas marcas** (`Edition`): `modern` (reedição moderna = OUTRO disco) e `period` (reedição de
  época = MESMO disco do original, relevante só p/ homônimos); `null` = disco normal. Gravadas em
  `lookout_items.edition` e `collection_items.edition` (caixas de seleção — `EditionCheckboxes` —
  no editar do item do De olho e no editar da Coleção). Para o **lote** há ainda `original`
  ("este lote NÃO é reedição"), só como sobrescrita (`LotEdition`).
- **Lote:** edição efetiva = sobrescrita manual (`app_state.lot_edition`, por id do lote, 30 dias,
  `getLotEditions`/`setLotEdition`, hook `useLotEditionsQuery`) > pré-marcação por palavras do
  título (`detectModernReissue`: reedição, relançamento, reissue, remasterizado, 180/200g,
  heavyweight, vinil colorido/transparente, picture disc, "edição de 20xx") > desconhecida. O botão
  `LotEditionButton` (ícone Layers; autônomo como o `ReevaluateIconButton`) fica no card desktop, na
  folha do celular e na linha da Análise.
- **Identidade** (`sameAlbum`): moderna × não-moderna → outro disco; duas modernas → o mesmo
  relançamento; homônimo com master conhecido nos dois lados → igual ⇔ mesmo master; marca "época"
  → mesmo disco; senão a regra do ano (`sameAlbumYear`: só o homônimo de anos diferentes separa).
  Usada na deduplicação do De olho (`addLookoutFromLot`/`addLookoutManual`, `similarLookoutItems`
  — por isso um lote moderno do mesmo disco pergunta "criar novo ou inserir em existente?") e na
  importação em massa da Coleção (`albumKey`).
- **Casamento lote × item** (`matchLookoutForLot` → `lotEditionAllows`): lote moderno não casa com item
  normal; item moderno rejeita lote explicitamente original/de época (edição desconhecida não rejeita);
  homônimo com masters diferentes rejeita. Vínculo manual (✓) vale sempre. **Já tenho**
  (`lookoutOwnedInCollection`): ter o moderno não é ter o original (e vice-versa).
- **Master do Discogs** (`master_id`): `lot_market.master_id` vem do release casado (`SearchHit.master_id`);
  itens do De olho/Coleção são preenchidos por `lookupMaster` (busca `type=master`, pontuada por
  `pickBestRelease` com o ano; homônimo SEM ano não é adivinhado → 0) no passo **`masters`** do cron
  (`album-master.server.ts`, `refresh.yml`) e na hora ao adicionar por texto. NULL = não consultado;
  0 = consultado sem master; mudar artista/álbum/ano devolve o item a NULL. **Homônimo (v0.182.1):** o master só vale se o
  ano dele estiver a ≤1 ano do pedido (`masterMatchesTarget`) — sem isso o Discogs devolvia o master "mais parecido" (outro
  ano) e a regra "mesmo master = mesmo disco" fundia Caetano Veloso 1968 com o de 1986; o passo `masters` zera uma vez os
  masters antigos (`app_state.masters_version`). O master do LOTE não rejeita casamento (só a edição e o ano do lote). O Discogs só entra
  como evidência: sem master vale a marca/o ano.

## Casamento: nome curto e homônimo (v0.187.3)

- `artistTokenEq` só tolera 1 letra de erro em palavras de artista com 6+ letras (`ARTIST_FUZZY_MIN_LEN`); "Nara", "Elis", "Rita" casam só exatos (antes casavam PARA/NADA/CARA, gerando "? 70%" em lotes de outros artistas).
- Disco homônimo (`selfTitled`, ex. "Nara — Nara") só pontua com artista CONFIRMADO no lote; artista só citado no título + ano coincidente não basta.

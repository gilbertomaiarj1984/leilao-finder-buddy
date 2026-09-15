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

## Convenções de trabalho

Ver `AGENTS.md` (fonte única). Resumo: responder em PT, branch a partir de `origin/main`,
atualizar ESTE documento antes de mesclar QUALQUER PR (ver aviso no topo), bump de versão
obrigatório em todo PR (`src/lib/version.ts` + `package.json`), rodapé de atribuição no GitHub.

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

## Endpoints de catálogo/peça — fonte de verdade (PRIORIDADE nas consultas)

⚠️ **Toda consulta de dados de um lote (nº, estado da venda, próximo lance, demanda, taxa…)
deve preferir estes dois endpoints** — são os que a própria LeilõesBR usa para renderizar as
telas, então os campos batem exatamente com o que o site mostra. Chutar marcador de TEXTO
LIVRE no HTML (ex.: procurar a palavra "vendido" solta) já causou bug real nesta base (tarja
"Vendido" não batendo com o site — ver "Histórico de versões" v0.51.0-3) — **não repetir**.

- **Catálogo do leilão inteiro** (`leiloesbr-catalog.server.ts`, `fetchCatalogData`):
  1. **Template novo (JSON, preferido)** — `fetchCatalogJson`:
     `<domínio>/templates/catalogo/asp/catalogocontentload.asp?leilao=<idLeilao>&pesquisa=&irpara=&Dia=&Tipo=<tipo>&artista=&Srt=0&Temtotal=1&pag=<n>&remote=1&limit=30&_=<timestamp>`
     — paginado (`pag`, `limit=30`, até 80 páginas), array `PECAS` (ou embrulhado, ver
     `extractPecas`) com um objeto por lote: `ID`, `LOTE`, `VALOR_VENDA` (valor REAL de venda,
     mesmo quando `VALOR_VALUE` vem escondido/"--"), `DESCRICAO`/`MINI_DESCRICAO`, `PECA`
     (título curado), `MOSTRABTN_CLASS` (`'is-vendido'` | `'is-naovendido'` — **o campo que diz
     se vendeu**), `VISITAS`, `QTDLANCE`, `TAXA_LEILOEIRO`, `VALOR_CONTRATADO`. `Tipo=129`
     filtra só "Disco de Vinil" quando a casa etiqueta (pré-filtro; vazio → tenta `Tipo=""`,
     catálogo completo).
  2. **Fallback: template antigo (HTML)** — `fetchCatalogHtml`/`parseCatalogData`:
     `<domínio>/catalogo.asp?Num=<idLeilao>[&pag=<n>]`, paginado, parser por regex no HTML
     (`SALE_VALUE_RE`/`SOLD_MARKER_RE`/`UNSOLD_RE`, calibrados no catálogo real do **Discos
     Esquecidos** — outras casas podem exigir ajuste). Só usar quando o JSON não vier (`JSON.parse`
     falha → casa não usa o template novo).
  - **1 requisição por LEILÃO** (paginada) — nunca por lote. Usado por: `fetchLoteMap` (nº do
    lote), `lot-sales.server.ts` (histórico de vendas/Vinil Analytics).
- **Peça individual** (`leiloesbr-lot-details.server.ts`, `fetchLotDetails`/`fetchOne`):
  `<domínio>/peca.asp?id=<idPeca>` (ou `?ID=`, mesma página) — HTML com um JSON `loadData`
  embutido que traz os **MESMOS campos do catálogo, só que para ESSE lote**: `NOVO_VALOR`
  (próximo lance mínimo, só em lote ABERTO), `MOSTRABTN_CLASS`, `VALOR_VENDA` (status/valor da
  venda, quando o leilão já terminou). Extração por **regex pontual no campo**
  (`"CAMPO":"valor"`), não por texto livre — mesma técnica pros três campos. **1 requisição por
  LOTE** — só para conjuntos pequenos (vigiados + lances, nunca a listagem inteira).

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
- **Tarja diagonal "Vendido" (v0.50.0):** lote **vigiado ou com lance** cujo leilão já
  terminou com venda confirmada em `lot_sales` (mesma tabela do Vinil Analytics, preenchida pelo
  cron `step=sales`/`captureFinishedSales` após cada leilão terminar — cobre TODO lote de vinil
  visto, sem mecânica nova de scraping). `LotCard` ganhou a prop `sold?: string | null`
  (`sold_price_raw` quando capturado, senão `"Vendido"`) e renderiza a tarja (`absolute inset-0
z-20`, `-rotate-[32deg]`, `pointer-events-none`) por cima de tudo, sem bloquear os botões.
  Casamento por `lot_id` (`${idLeilao}-${idPeca}`), **escopado** aos ids de vigiados + lances
  visíveis (nunca lê `lot_sales` inteira): `getSoldLots` (`leiloesbr.functions.ts`, POST, até
  500 ids) → `getAllLotSales({ids, withOrig:false})`. Query `["sold-lots", <ids ordenados>]` no
  `index.tsx` (mesmo padrão de `nextBidTargets`/`getNextBids`), mapa `soldById` passado a todo
  `LotCard` direto e a `BidHouseSections` (prop `soldById`).
  - **Sinal mais rápido para quem tem LANCE (v0.50.1):** `lot_sales` só chega depois que o cron
    `step=sales` varre o catálogo da casa (atraso) — então `LotCard` TAMBÉM olha o `bidStatus`
    (já vem em tempo real de "Meus lances", `l=4`): `bidIsSold(status)` (`vinyl-parse.ts`) casa
    `vendid|arremat|arrebat|vencedor` e EXCLUI "Não vendido" (fail-closed, mesmo espírito de
    `bidIsWinning`). Cobre "Coberto e Vendido" (perdi) e "Vencedor"/"Arrematado" (ganhei) assim
    que o leilão encerra, sem esperar o cron. `lot_sales` (com preço) tem prioridade quando as
    duas fontes concordam; sem ela, cai no rótulo genérico "Vendido".
  - **Sinal para quem só VIGIA, sem lance (v0.51.0, corrigido em v0.51.3):** a página de vigia
    (`l=8`) não traz status — então o sinal rápido é o `peca.asp?ID=<idPeca>` do próprio lote
    (mesma lógica em toda casa, só o domínio muda). `leiloesbr-lot-details.server.ts`
    (`fetchLotDetails`/`getLotDetails`, era `fetchNextBids`/`getNextBids`): a MESMA requisição
    que já buscava o próximo lance (`NOVO_VALOR`, no JSON `loadData` embutido na página) agora
    TAMBÉM lê `MOSTRABTN_CLASS` ('is-vendido'/'is-naovendido') e `VALOR_VENDA` do MESMO
    `loadData` — os MESMOS campos que `leiloesbr-catalog.server.ts` já lê com sucesso do
    catálogo para o Vinil Analytics, só que aqui vêm da página do PRÓPRIO lote em vez do
    catálogo do leilão inteiro. **Custo zero adicional** (mesmo request que já existia,
    escopado a vigiados+lances, nunca mais que 100, concorrência 8). ⚠️ **v0.51.3**: a extração
    original (v0.51.0-v0.51.2) tentava marcadores de TEXTO LIVRE no HTML ("vendido"/"lote
    vendido"/"não vendido") — um chute sem confirmação contra o site real (sem rede a partir
    deste ambiente) — trocado pela extração por CAMPO do JSON acima, a mesma técnica (regex
    pontual no campo) já usada e funcionando para `NOVO_VALOR`. Retorna
    `Record<id, {nextBid?, sold?}>`, **indexado por `id` (`${idLeilao}-${idPeca}`)**, NUNCA por
    `idPeca` sozinho — mescla no `soldById` só quando `lot_sales` ainda não tem aquele lote —
    prioridade: `lot_sales` (preço, quando o cron já capturou) > `peca.asp` (preço quando
    achável, senão "Vendido") > `bidStatus` (só lotes com lance, ver acima).
    ⚠️ **Fix v0.51.6 — tarja "Vendido" errada em vigiados de leilão FUTURO**: `getLotDetails`/
    `fetchLotDetails`, `nextBidById` e o merge do `soldById` indexavam por `idPeca` sozinho
    (dedup por `idPeca` em `lotDetailTargets`, `lotIdByPeca: idPeca → id`). `idPeca` só é único
    **DENTRO de uma casa** — cada casa parceira é uma instalação independente da mesma
    plataforma (LeilõesBR white-label), com sua própria numeração — então duas casas diferentes
    reaproveitam os mesmos números. Um usuário vigiando lotes em mais de uma casa podia ter o
    resultado de venda de um lote (de uma casa) atribuído a outro lote (de outra casa/leilão,
    inclusive **futuro**, ainda não pregoado) só porque coincidiam no `idPeca`. Fix: todo esse
    caminho (targets, retorno de `fetchLotDetails`, `nextBidById`, merge do `soldById`) passa a
    indexar/dedupar por `id` (`${idLeilao}-${idPeca}`, a mesma chave já usada por `lot_sales` e
    pelo próprio vigiado/lance) — colisão nesse composto exigiria as DUAS casas coincidirem em
    `idLeilao` E `idPeca` ao mesmo tempo, praticamente impossível. `lotIdByPeca` foi removido
    (não é mais necessário).
    ⚠️ **Fix v0.52.1 — tarja ainda errada mesmo com o `id` composto correto**: mesmo indexado
    certinho, `sold`/`bidStatus` podem estar errados na ORIGEM (ex.: a própria casa reaproveita
    `idLeilao` ao longo do tempo para uma "sala"/categoria recorrente, ou um card de "lotes
    relacionados" embutido na página cola o resultado de outro lote) — casos difíceis de
    descartar por análise estática sem acesso ao site real. Em vez de perseguir a origem exata,
    `LotCard` (`lot-card.tsx`) ganhou uma guarda de INVARIANTE: um leilão que **ainda não
    começou** (`auctionStarted(dayKey, time)` de `vinyl-parse.ts`, false) não pode ter lote
    vendido, ponto — a tarja nunca aparece nesse caso, seja qual for a fonte do `sold`/
    `bidStatus`. Só aplica quando o card tem `dayKey` (formato `yyyy-mm-dd`) **e** `time`; sem
    os dois (ex.: cards de lance, que não trazem `time`), não bloqueia — mantém o comportamento
    anterior, já que dar um lance pressupõe leilão aberto. Os vigiados (`index.tsx`, dd/mm/yyyy
    em `WatchedLot.date`) passaram a normalizar para `yyyy-mm-dd` (`watchedDateToKey`) ao montar
    o `dayKey` do card, senão a guarda nunca teria dado match nesse caminho.
  - **Fix v0.58.1/v0.58.2 — tarja não aparecia em casas do template ANTIGO**: a troca da v0.51.3
    (texto livre → campo `MOSTRABTN_CLASS` do JSON `loadData`) fez `leiloesbr-lot-details.server.ts`
    (`parseSold`) confiar SÓ nesse campo — mas ele só existe em casas do template NOVO (o mesmo
    JS que `catalogocontentload.asp`). Casas do template ANTIGO (catálogo HTML server-side, ex.:
    Robson Gini/Trem das 7) não embutem esse `loadData` na `peca.asp`, então `parseSold` nunca
    achava `MOSTRABTN_CLASS` e devolvia `undefined` sempre — mesmo com o lote já vendido e o
    leilão ainda "ao vivo" (`lot_sales` só chega depois que o cron varre o catálogo do leilão
    INTEIRO já encerrado). Resultado: vigiados dessas casas nunca ganhavam a tarja "Vendido",
    nem sozinho nem com "Forçar atualização" (que só rechama essa mesma função).
    **v0.58.1** tentou reaproveitar `parseSoldMarkers` (heurística de `parseCatalogData`,
    calibrada no CATÁLOGO — texto contínuo "Valor de venda: R$ 70,00") como fallback, mas
    não resolveu: confirmado contra o HTML real da `peca.asp` (Robson Gini) que **(1)** essa
    página tem uma estrutura DIFERENTE do card do catálogo — "R$" e o valor vêm em `<span>`s
    SEPARADOS (`<span class="is-rs">R$</span> <span class="is-valor">15,00</span>`), então o
    `BRL_RE`/`SALE_VALUE_RE` (que exigem texto contínuo) nunca casavam o valor; e **(2)** o
    texto "Lote vendido" (minúsculo) aparece nos TERMOS E CONDIÇÕES, fixos em TODA `peca.asp`
    (vendida ou não) — usar esse texto solto como marcador teria dado falso positivo sempre
    (por sorte o `SOLD_MARKER_RE` da v0.58.1 até "achava" o marcador, mas como o valor nunca
    casava, `soldPrice` ficava `null` e `sold` saía `false` de qualquer jeito — mascarou o bug
    sem criar falso positivo, mas também sem resolver o real). **v0.58.2** troca por um parser
    dedicado à `peca.asp` (`parseSoldOldTemplate`), calibrado no HTML real: o sinal confiável é
    a CLASSE CSS do botão de lance, que só existe nesse estado — `<li id="fazerlance"
    class="is-CoolBtn lotevendido"><span>Lote Vendido</span></li>` (token `lotevendido`, sem
    espaço — não colide com o texto livre dos Termos) — e o preço sai de uma janela maior até
    o span `is-valor` (`valor de venda[\s\S]{0,300}?is-valor"[^>]*>\s*(\d+,\d{2})`), cobrindo o
    espaçamento entre label e spans. Casas do template novo continuam pelo campo JSON (mais
    confiável); as do antigo ganham o sinal rápido de verdade, validado contra o HTML real.
  - **Refresh — automático ao abrir a tela + manual (v0.51.0-3):** as duas queries de status
    (`["lot-details", …]`/`["sold-lots", …]`) têm `refetchOnMount: "always"` — sempre rechecam
    ao montar a tela, sem esperar o `staleTime` (3min); como o alvo já é só vigiados+lances
    (nunca mais que 100), isso não pesa mais que o request que já existia. O ícone `RefreshCw`
    ao lado de "Vigiados do dia"/"Lances do dia" (`refreshWatched`/`refreshBids`, `index.tsx`)
    faz o mesmo papel, só disparado por clique: `watched.refetch()`/`bids.refetch()` (com
    `throwOnError:true` — `queryClient.invalidateQueries` resolve quando o refetch TERMINA,
    sucesso OU erro, então antes uma falha real de rede virava toast de sucesso; corrigido em
    v0.51.1) + invalida `lot-details`/`sold-lots`. NÃO reroda a varredura geral (isso já é o
    botão "Forçar atualização deste dia"/`refreshDay`) e **NUNCA** relê o catálogo do leilão
    nem escreve em `lot_sales` — ver v0.51.2 abaixo.
  - **v0.51.2, revertido em v0.51.3 — recaptura do catálogo pelo refresh manual:** chegamos a
    ter `checkSoldNow`/`captureSalesForAuctions` (`lot-sales.server.ts`), que o refresh manual
    chamava pra RELER o catálogo inteiro do leilão e regravar `lot_sales`, contornando o
    checkpoint `sales_captured` (que `captureFinishedSales` marca assim que lê o catálogo com
    sucesso, MESMO com 0 vendas reconhecidas naquele momento, e nunca mais revisita). **Revertido
    a pedido**: (1) não rodava o fallback de IA (`conditionAiSync`) que `captureFinishedSales`
    roda — uma venda com grau Disco/Capa já preenchido por IA podia voltar em branco; (2) podia
    reverter a padronização de grafia do artista (`reidentifyAllSales`) pra aquele lote; (3)
    custo alto — até 30 catálogos inteiros (paginados) por clique, mesma pipeline pesada do
    cron de Analytics. O fix acima (extração por campo JSON do `peca.asp`) resolve o caso
    original sem nenhum desses riscos, porque NUNCA escreve em `lot_sales`.
  - **Vigiados/lances "sumindo" ao terminar o leilão (v0.51.4):** a conta do LeilõesBR (`l=8`/
    `l=4`) pode parar de trazer um lote assim que o leilão termina — igual à listagem pública,
    que já "some" um leilão que ficou ao vivo (ver "Scraping do LeilõesBR"). Como `watched`/
    `bids` (`index.tsx`) antes SUBSTITUÍAM a lista a cada fetch pelo que a conta retornava
    naquele instante, o card do vigiado/lance (e a tarja "Vendido" que ele carrega) desaparecia
    da tela assim que o leilão acabava — mesmo ainda sendo "hoje", e mesmo com o `refetchOnMount:
"always"` acima batendo a conta de novo a cada abertura de tela. Fix: os `queryFn` de
    `watched`/`bids` agora MESCLAM (nunca substituem) num acumulador local (`watchedAccumRef`/
    `bidsAccumRef`, `Map` por `id`) — cada fetch novo entra no mapa, e um item só sai quando
    (a) o usuário desvigia explicitamente (`toggle.onSuccess` remove na hora, direto no
    `Map` + `queryClient.setQueryData`, sem esperar o refetch) ou (b) o dia dele já saiu da
    janela de `WATCH_WINDOW_DAYS` (=5, espelha o `WINDOW_DAYS` do servidor) — poda que evita
    crescimento sem limite numa sessão longa. Não muda nada do lado do servidor (`listWatched`/
    `listMyBids` continuam devolvendo só o que a conta tem AGORA — o acumulador é só no
    cliente). O "mostrar/esconder leilões finalizados" da listagem geral já existia
    (`showFinishedDays`/`toggleShowFinished`, esconde por padrão os leilões encerrados há mais
    de 3h, com botão "Mostrar finalizados (N)").
    ⚠️ **Fix v0.52.2 — vigiado ainda sumia da grade GERAL do dia**: os fixes acima garantem que
    o vigiado não some das visões DEDICADAS ("Vigiados do dia"/aba "Vigiados"), mas o card dele
    também vive espalhado na grade geral de cada dia (borda amarela) — e essa grade some
    lotes de leilão encerrado há +3h por padrão (`showFinishedDays`, decisão deliberada pra não
    poluir a tela com o que já era irrelevante). Um vigiado/lote com lance é o OPOSTO de
    irrelevante — o usuário está de olho justamente pra ver se vendeu e por quanto —, então não
    devia cair nesse filtro. Fix: `dayLots`/`finishedCount` (`index.tsx`) ganham um predicado
    `isTracked` (`lot.watched || bidStatusById.has(lot.idPeca)`) que EXCLUI vigiados/lances do
    corte por "finalizado" — eles continuam na grade geral mesmo sem abrir "Mostrar
    finalizados"; `finishedCount`/o botão contam só o resto (sem relação com o usuário).
    ⚠️ **Fix v0.51.6 — acumulador ainda sumia depois de um tempo**: o `Map` da v0.51.4 vivia só
    num `useRef` em memória — sobrevivia a troca de aba/dia DENTRO da mesma sessão do app, mas se
    perdia a cada reload de página ou fechar/reabrir a aba (comum num app mobile/PWA), fazendo o
    vigiado "sumir" de novo mesmo sem o usuário ter desvigiado nada. Fix: `watchedAccumRef`/
    `bidsAccumRef` agora persistem em `localStorage` (`loadAccum`/`saveAccum`,
    `leilao-finder:watched-accum:v1`/`leilao-finder:bids-accum:v1`) — gravado a cada merge do
    `queryFn` e a cada remoção explícita (desvigiar). Best-effort (SSR, aba anônima ou
    `localStorage` indisponível/cheio caem para `Map` vazio/silencioso, nunca quebram a tela).
    ⚠️ **Fix v0.52.1 — sumia de novo ao navegar entre `/` e `/analise`**: a rota `/analise`
    (`analise.tsx`) tem sua PRÓPRIA `useQuery` para vigiados/lances, mas lendo a MESMA chave de
    query (`["vinyl-watched"]`/`["vinyl-my-bids"]`) — o `QueryClient` é único para o app inteiro,
    então as duas rotas compartilham o mesmo cache por chave. A versão de `analise.tsx` só
    fazia `fetchWatched()`/`fetchBids()` puro (sem mesclar no acumulador), então visitar
    `/analise` SUBSTITUÍA o cache pelo retorno cru da conta (sem os lotes de leilões já
    encerrados que a conta já não lista mais) — ao voltar para `/`, com o `staleTime` de 5min
    ainda válido, a tela mostrava esse conjunto reduzido até o próximo refetch, mesmo com o
    `localStorage` intacto. Fix: a lógica de merge/poda/persistência saiu de `index.tsx` para
    `src/lib/watched-accum.ts` (`mergeWatchedAccum`, `loadAccum`, `saveAccum`, constantes de
    janela/chave) e as DUAS rotas passaram a usá-la — cada uma com seu próprio `useRef` do
    acumulador (recarregado do MESMO `localStorage`), mas a mesma função de merge, então
    nenhuma das duas mais substitui o que a outra acumulou. `analise.tsx#toggle.onSuccess`
    também ganhou a remoção explícita do acumulador ao desvigiar (espelhando `index.tsx`), que
    antes faltava ali.
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
  - **Busca só roda ao confirmar (v0.48.0):** o `Input` de busca escreve num estado de rascunho
    (`searchDraft`, tecla a tecla) separado do estado usado para filtrar (`search`/`searchNorm`);
    `search` só é atualizado no **Enter** ou no botão **Pesquisar**, evitando refiltrar a
    listagem a cada tecla digitada. "Limpar busca" zera os dois.

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
- **Botão "Atualizar coleção"** → `importWonLotsIncremental()` (v0.52.0): em vez de sempre
  repaginar `l=6` do zero (`id=0`, `t=1`+`t=0`, até 50 páginas cada — caro e com teto), lê
  `listMyBidsFromSite()` (`l=4`) e filtra os lances com `status` "Vencedor"
  (`wonAuctionIdsFromBids`), obtendo só os `idLeilao` candidatos; para esses, varre
  `conta_site.asp?l=6&id=<idLeilao>&t=<0|1>&...&pag=N` (**`listPurchasesForAuctions`**, em
  `leiloesbr-purchases.server.ts`) — 1 leilão por vez, poucas páginas cada, bem mais barato.
  **Cai sozinho para a varredura completa** (`importWonLots`, abaixo) quando a coleção ainda
  não tem NENHUM item vindo de leilão (`lotId` — 1ª varredura: `l=4` não garante cobrir todo o
  histórico). Resultado inclui `auctionsChecked` (`-1` = caiu para a completa; `0` = nenhum
  leilão vencido nos lances atuais).
- **Botão "Varredura completa"** (ghost, ao lado) → `importWonLots()`: a varredura ANTIGA,
  irrestrita (`conta_site.asp?l=6&t=1&...&pag=N`, **`t=1`** confirmado com o site, e depois
  `t=0`; lê página a página até uma sem lotes novos) via `listVinylPurchases`. Cara —
  contingência manual para quando um leilão vencido escapa da incremental (ex.: some de `l=4`
  antes do usuário atualizar).
  Ambas usam `leiloesbr-purchases.server.ts` (`listVinylPurchases`/`listVinylPurchasesForAuctions`;
  filtram não-vinil por `looksNonVinyl`) e a mesma lógica de importação (`importFromWonLots`
  em `collection.server.ts`), que **ACRESCENTA** os lotes ainda ausentes (**de-dup por
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

## Páginas / UI

- **Header persistente (v0.41.0):** o `<header>` de todas as páginas autenticadas (index,
  Análise, Coleção, Ao vivo, Vinil Analytics) é **`sticky top-0 z-30`** com fundo translúcido +
  `backdrop-blur` (mesmo padrão do rodapé fixo), então o topo (com o **seletor de IA**) fica
  sempre acessível. **Mobile compacto:** no `sm-` o padding vertical cai, o título encolhe, a
  descrição/tagline some (`hidden sm:block`) e a barra de ações rola na **horizontal** numa única
  linha (`overflow-x-auto`, volta a `flex-wrap` no `sm+`) — para o header baixo não atrapalhar. O
  rodapé fixo é `z-40`; header `z-30` (diálogos/toasts do Radix ficam acima, `z-50`).
  - **Barra menor + e-mail/Sair no topo esquerdo (v0.48.0, `index.tsx`):** o padding vertical do
    header encolheu (`py-3 sm:py-6` → `py-2 sm:py-3`) e o título perdeu um degrau de tamanho
    (`sm:text-4xl` → `sm:text-2xl`); e-mail + botão **Sair** saíram do fim da barra de ações
    (direita) e viraram uma linha compacta **acima do título**, no canto superior esquerdo.
  - **Menos altura no mobile (v0.51.5):** o header sticky ainda cabia demais da tela pequena —
    cortado mais padding vertical (`py-*` → `py-* sm:py-*` maior só a partir do `sm`) em todas as
    5 páginas (`index.tsx`, `colecao.tsx`, `analise.tsx`, `vinil-analytics.tsx`, `ao-vivo.tsx`).
    Em `index.tsx`, a `TabsList` dos dias (que podia quebrar em 2+ linhas com muitos dias)
    passou a rolar na **horizontal** no mobile (`overflow-x-auto flex-nowrap`, `TabsTrigger`
    `shrink-0`), mesmo padrão já usado na barra de ações — volta a `flex-wrap` no `sm+`; as
    barras `sticky` internas (dia/Vigiados/Lances) também perderam padding no mobile. Em
    `colecao.tsx`, a linha de filtro/busca/abas perdeu padding e gap no mobile. **Fix** em
    `analise.tsx`: o `nav` sticky "ir para casa" (por dia) usava `top-0` fixo, então ficava
    **escondido atrás** do header (mesmo `top:0`, header com `z-30` > nav `z-10`) — passou a usar
    o mesmo padrão `headerRef`/`ResizeObserver`/`stickyBelowHeader` que `index.tsx` já usava para
    as barras sticky aninhadas, colando corretamente abaixo do header.
  - **Esconder/mostrar o topo no mobile — histórico:** tentativas v0.53.0-2 auto-escondiam as
    barras `sticky` ao detectar direção do scroll (`useHideOnScroll`), mas o próprio recálculo
    de altura de um elemento `sticky` durante a transição gerava ruído de scroll que
    realimentava a lógica de direção — mesmo com `overflow-anchor:none` e um cooldown para
    descartar esse ruído (v0.53.2), continuava piscando/abrindo e fechando sem parar ao começar
    a rolar. **v0.54.0 abandonou o auto-hide por scroll**: agora é um **botão manual**
    (`MobileTopToggle`, `src/components/vinyl/mobile-top-toggle.tsx` — canto superior direito,
    `sm:hidden`, só aparece no mobile) que alterna um `useState` por página; o controle fica com
    o usuário, sem depender de heurística de scroll nenhuma. `HideableBar`
    (`src/components/vinyl/hideable-bar.tsx`) continua fazendo o colapso em si — anima a altura
    via `grid-template-rows` (1fr↔0fr) em vez de um `transform: translateY` (que deixaria um vão
    em branco, já que um elemento `sticky` continua reservando seu espaço no fluxo) — mas agora
    o `hidden` vem do clique no botão, não de um listener de scroll; o `sm:grid-rows-[1fr]`
    sempre vence no desktop, então o recolhimento só tem efeito visual abaixo do breakpoint
    `sm` mesmo que o estado fique marcado como escondido.
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
  - **Mesma info ao lado da casa em Vigiados (v0.47.0):** "Vigiados do dia" e a aba **Vigiados**
    (global) do `index.tsx` mostram, no cabeçalho de cada casa, horário + status (em
    breve/ao vivo/encerrado) + link do pregão presencial, **sem depender de `seen_auctions`** —
    calculado ao vivo no cliente a partir do 1º lote do grupo (`houseAuctionInfo`, `grouping.ts`;
    UI em `AuctionStatusInline`, `badges.tsx`), já que cada `WatchedLot` traz `date`/`time`/`url`.
    `parseAuctionRef`/`presencialUrlFrom` viraram puros em `vinyl-parse.ts` (fonte única,
    client-safe) — `leiloesbr-catalog.server.ts` reexporta `parseAuctionRef` e
    `leiloesbr-auctions.server.ts` importa `presencialUrlFrom` de lá, sem duplicar a regex.
    ⚠️ **Fix (v0.47.1):** o link não aparecia para NENHUMA casa — `presencialUrlFrom` só casa o
    link da LISTAGEM GERAL (`abre_catalogo.asp?t=1|<domínio>|<idLeilao>|<idPeca>`), mas o
    `url` de `WatchedLot`/lances vem das **páginas de conta** (`conta_site.asp?l=8`/`l=4`), cujo
    `stretched-link` já é `<domínio>/peca.asp?ID=<idPeca>` — SEM o idLeilao embutido (só o
    domínio), e sem casar `parseAuctionRef`. Novo `auctionHouseDomain` (`vinyl-parse.ts`) extrai
    o domínio dos DOIS formatos (mesma lógica que `leiloesbr-lot-details.server.ts` já usava
    para achar o `peca.asp` do "próximo lance" — `pecaUrl` passou a reusá-la) e
    `presencialUrlFromLot({idLeilao, url})` combina esse domínio com o `idLeilao` que o
    `WatchedLot` já traz à parte (do `data-watch`). `houseAuctionInfo` passa a exigir `idLeilao`
    no lote.
  - **Cards abertos sobem para o topo (v0.49.3):** ao clicar "Abrir aqui" (iframe), o card sobe
    para o início da grade — `openOrder` (estado no `AoVivoPage`, lista de `idLeilao` na ordem em
    que foram abertos, mais recente primeiro) reordena `orderedAuctions` via `useMemo`; o `key`
    (`idLeilao`) não muda, então o estado local do card (`frameUrl`/`showFrame`) sobrevive à
    reordenação. Fechar o iframe não tira o card do topo (mantém agrupado, só sai se outro for
    aberto por cima). "Entrar ao vivo" (nova aba) não reordena.
  - **Extensão à lista principal do dia + "Acontecendo agora" (v0.48.0):** o mesmo
    `AuctionStatusInline`/`houseAuctionInfo` (antes só em Vigiados) passa a aparecer também no
    cabeçalho de casa da **lista principal por dia** (`index.tsx`, seção não-Vigiados/Lances),
    usando `group.lots[0]` (`VinylLot`, já tem `idLeilao`/`url`) — substitui o antigo `às
{group.time}` solto; link **"pregão presencial"** ao lado de "site da casa". A seção
    **"Acontecendo agora"** (`live-auctions.tsx`) vira **cartão de 2 linhas** (casa+ícone /
    horário+UF+lotes, sem título de amostra nem CTA separado) e o cartão INTEIRO linka pro
    **presencial** (`auction.presencialUrl ?? entryUrl ?? houseUrl`); `listLiveAuctions`
    (`leiloesbr-auctions.server.ts`) passa a devolver `PresencialAuction[]` (antes só
    `LiveAuction[]`, sem `presencialUrl`) — novo helper interno `toPresencialAuction` (status +
    presencial) compartilhado com `listTodayAuctions`, elimina a duplicação do cálculo de status.
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

## Infra — economia / saída dos free tiers (v0.48.2, NÃO iniciado)

Planos e telemetria em **`docs/economia-migracao.md`** (índice), fases em
`docs/economia-fase-1-egress-e-cpu.md` e `docs/economia-fase-2-vps-unico.md`. Resumo: banco
folgado (49/500 MB), mas **egress do Supabase já estourado** e **Active CPU da Vercel em 79%**
— o padrão de leitura, não o tamanho do banco, é o problema.

- **Causa raiz:** `reidentifyAllSales()` (`lot-sales.server.ts:511`) carrega `lot_sales` INTEIRA
  (com `orig_text`) + `lot_ident` INTEIRA a cada chamada, para processar 25 linhas — e o workflow
  chama isso em laço de até **60×** por execução, 4×/dia (`refresh.yml:120`). Leitura
  O(tabela) para O(25) de trabalho. Mesmo sem venda nova, a 1ª chamada baixa tudo só para
  descobrir que não há o que fazer. Isso é o egress do Supabase E o Active CPU da Vercel.
- **Secundário:** `getVinylSales` (`leiloesbr.functions.ts:542`) devolve o histórico inteiro ao
  browser a cada abertura do Vinil Analytics.
- **Correção (Fase 1, custo zero):** filtrar no banco (anti-join via RPC, `limit(max)`) em vez de
  baixar tudo e filtrar em memória; não pedir `orig_text` em quem não usa (o flag `withOrig` já
  existe); short-circuit quando não há trabalho; encolher os laços do workflow.
- **Netlify e Neon descartados.** Netlify: timeout de 10 s mata os steps do cron e o `/api/live`
  (confirmado — o projeto conectado ao repo falha o deploy em todo PR). Neon: o gargalo é egress,
  não storage, e o Neon cobra CU-horas que o mesmo padrão queima igual.
- **Fase 2 (~US$4/mês, VPS único) só se a Fase 1 não bastar.** Migrar antes leva o desperdício
  junto. `vite.config.ts:9` já honra `SERVER_PRESET`, então trocar de host é env var, não código.
- **Órfãos (rebaixado a item secundário):** o schema não tem FK nem `CASCADE`, então
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` acumulam órfãos quando `lots` é podada. Com
  49/500 MB não é urgente, mas órfã em `lot_ident` é linha lida à toa pelo anti-join.
  ⚠️ **Nunca** cascatear `lot_sales` → `lots`.
- **Lição:** a v0.48.1 planejou a partir do schema e mirou o tamanho do banco — alvo errado.
  Schema mostra o que _pode_ crescer; só telemetria mostra o que _está_ doendo.

## Histórico de versões

Fonte única da versão em `src/lib/version.ts` (`APP_VERSION`) + `package.json`. Bump em todo PR.
Entradas resumidas (1 linha/versão) — a mecânica atual e detalhada de cada área já está nas
seções acima; esta tabela é só "o que mudou e quando" para navegação/`grep`.

| Versão       | Entrega                                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0       | Rodapé + versionamento (`Footer.tsx`, `version.ts`) — #35                                                                                                                                                                                                                                                                               |
| v0.2.0       | Bump obrigatório + valor atual/última atualização/casas verificadas                                                                                                                                                                                                                                                                     |
| v0.4.0       | IA de avaliação (`lot_ai`, Batches) + página Análise — #51                                                                                                                                                                                                                                                                              |
| v0.5.0       | Âncora Discogs (`lot_market`)                                                                                                                                                                                                                                                                                                           |
| v0.6.0       | Sondagem (`wantlist_items`) + filtros da Análise — #52                                                                                                                                                                                                                                                                                  |
| v0.6.1       | Casamento probabilístico da sondagem (≥80%) — #53                                                                                                                                                                                                                                                                                       |
| v0.7.0       | Análise: Top 100 + tabela por casa, hover via portal — #54                                                                                                                                                                                                                                                                              |
| v0.8.0       | Faixa Discogs BR, "Lances do dia", tags editáveis                                                                                                                                                                                                                                                                                       |
| v0.8.1       | Raridade colorida (`RarityLabel`)                                                                                                                                                                                                                                                                                                       |
| v0.9.0       | Filtro por raridade + validação na edição de tags                                                                                                                                                                                                                                                                                       |
| v0.9.1       | Fix jank de tag + resiliência `lot_market` + hover no toque                                                                                                                                                                                                                                                                             |
| v0.10.0      | Casamento Discogs estruturado artista+álbum+ano (`pickBestRelease`)                                                                                                                                                                                                                                                                     |
| v0.10.1–2    | Cron endurecido (header-only, timing-safe, sem retry 4xx) — #60                                                                                                                                                                                                                                                                         |
| v0.11.0      | Modo de IA `ai_mode` (off/all/watched) + análise sob demanda — #61                                                                                                                                                                                                                                                                      |
| v0.12.0      | Cards refinados + `lot_ident` (identificação simples)                                                                                                                                                                                                                                                                                   |
| v0.13.0      | Fix classificação IA + categoria "Lote" + busca por relevância — #63/#64                                                                                                                                                                                                                                                                |
| v0.14.0      | Página Ao vivo (pregão presencial por casa) — #66                                                                                                                                                                                                                                                                                       |
| v0.15.0      | Pregão abre já logado (proxy `/api/live`, sessão por origem, HMAC) — #73                                                                                                                                                                                                                                                                |
| v0.15.1      | Login da casa: GET de aquecimento + erro real no proxy — #74                                                                                                                                                                                                                                                                            |
| v0.15.2      | Auto-login best-effort para casa fora da plataforma                                                                                                                                                                                                                                                                                     |
| v0.16.0      | Menu Coleção (`collection_items`) + varredura "Minhas compras" (`l=6`) — #76                                                                                                                                                                                                                                                            |
| v0.16.1      | Fix data vazia do `l=6` quebrando o insert — #77                                                                                                                                                                                                                                                                                        |
| v0.17.0–3    | Coleção: parser real do `l=6`, `parsePurchaseTitle`, título rotulado, prioridade banco→título→IA — #78–80                                                                                                                                                                                                                               |
| v0.18.0      | Coleção: IA só-texto reidentifica a base + agrupamento normalizado + "Coletâneas" — #82                                                                                                                                                                                                                                                 |
| v0.19.0      | Coleção: card por artista/álbum, descritivo IA (`description`), upload de foto                                                                                                                                                                                                                                                          |
| v0.20.0–21.0 | Coleção: reidentificação `onlyUnidentified` + reprocessar por card (`RotateCw`)                                                                                                                                                                                                                                                         |
| v0.22.0–1    | Coleção: descritivo rico rolável, grading `Select`, tags editáveis/IA (só gênero) — #86                                                                                                                                                                                                                                                 |
| v0.23.0–2    | Home: ícone "já tenho na Coleção" (`ownedMatchForLot`), precisão por tokens distintivos — #88–90                                                                                                                                                                                                                                        |
| v0.24.0–2    | Coleção: relação manual lote↔Coleção + aprendizado (`collection_links`/`collection_feedback`, `resolveOwned`) — #91–93                                                                                                                                                                                                                  |
| v0.25.0      | Removido "Painel de mudanças" (`/dashboard`)                                                                                                                                                                                                                                                                                            |
| v0.26.0      | Coleção: importação em massa por texto (`BulkImportDialog`) + câmera no upload                                                                                                                                                                                                                                                          |
| v0.27.0–1    | IA multi-provedor (Gemini via REST, failover por quota) — #96                                                                                                                                                                                                                                                                           |
| v0.28.0      | Rodapé fixo/persistente                                                                                                                                                                                                                                                                                                                 |
| v0.28.1–2    | Fix Gemini "não retorna nada" (folga de tokens, erro explícito) + retry/failover em erro transitório — #99                                                                                                                                                                                                                              |
| v0.29.0      | Grading Disco×Capa (`grading.ts`, 10 graus, Score Final, Faixas)                                                                                                                                                                                                                                                                        |
| v0.30.0      | Captura de vendas pós-leilão (`lot_sales`, 1 req/leilão, fail-closed)                                                                                                                                                                                                                                                                   |
| v0.31.0–1    | Página Vinil Analytics (`buildAnalytics`) + calibração do catálogo (tooltip, valor de venda)                                                                                                                                                                                                                                            |
| v0.32.0–3    | `lot_condition` (estado pré-leilão) + fixes de segmentação/filtro de vinil na captura de vendas                                                                                                                                                                                                                                         |
| v0.33.0–1    | Catálogo via endpoint JSON (`catalogocontentload.asp`), embrulho `Catalogo`, backfill                                                                                                                                                                                                                                                   |
| v0.34.0      | Filtro de vinil na origem (`Tipo=129`)                                                                                                                                                                                                                                                                                                  |
| v0.35.0      | Campos ricos do catálogo (demanda, taxa, valor inicial) — badge de demanda + Analytics                                                                                                                                                                                                                                                  |
| v0.36.0      | Identidade via campo `PECA` para casas com `DESCRICAO` em prosa                                                                                                                                                                                                                                                                         |
| v0.37.0      | Reparo de mojibake (dupla-codificação UTF-8/Latin-1) no catálogo (`fixMojibake`)                                                                                                                                                                                                                                                        |
| v0.38.0      | Grading tolerante a prosa + regra de score = MÉDIA (padrão em todos os cards)                                                                                                                                                                                                                                                           |
| v0.39.0      | Fallback de IA para estado quando o regex não acha nada (`conditionAiSync`)                                                                                                                                                                                                                                                             |
| v0.40.0      | Analytics: exclui não-vinil + reidentifica artistas genéricos por IA                                                                                                                                                                                                                                                                    |
| v0.41.0      | Seletor único de IA + header sticky + reidentificação/padronização de todo o histórico                                                                                                                                                                                                                                                  |
| v0.42.0      | Analytics: curadoria com aprendizado (apelidos/fusão de artista/álbum) + refinos de UI                                                                                                                                                                                                                                                  |
| v0.43.0      | Analytics: `lot_sales.orig_text` + correção por venda (`analytics_sale_overrides`)                                                                                                                                                                                                                                                      |
| v0.44.0–2    | Analytics: IA por artista/álbum (escopo `lotIds`) + roadmap de provedores de IA — #127                                                                                                                                                                                                                                                  |
| v0.45.0–1    | Analytics: oculta lotes/coletâneas + `extractArtist` aceita nomes curtos c/ dígito ("U2") — #128                                                                                                                                                                                                                                        |
| v0.46.0–6    | Analytics: excluir venda/artista (#128); fixes sucessivos de qualidade — lote confirmado reaparecendo, `isDiscBundle` em prosa, colecionismo geral poluindo balaios, "Grandes Sucessos" preso em Coletâneas, `extractArtist` bail-out cedo demais, grafias de "AC/DC" divergentes                                                       |
| v0.47.0–1    | Horário/status/link do pregão presencial ao lado da casa em Vigiados (`houseAuctionInfo`)                                                                                                                                                                                                                                               |
| v0.48.0      | Alerta "ao vivo" + link do presencial na lista principal; busca só ao confirmar; header menor                                                                                                                                                                                                                                           |
| v0.48.1–2    | Plano de economia (doc): v0.48.1 mirou o tamanho do banco (errado); v0.48.2 corrige com telemetria real — ver "Infra — economia"                                                                                                                                                                                                        |
| v0.48.3      | Header/barra de filtros fixos (home e Coleção)                                                                                                                                                                                                                                                                                          |
| v0.48.4      | Fase 1 do plano de economia: RPC de anti-join, laço do cron encolhido, `lot_sales.bundle` — ver `docs/economia-fase-1-egress-e-cpu.md`                                                                                                                                                                                                  |
| v0.49.1      | Otimização dos `.md` do repo (só documentação): remove duplicação de convenções entre `AGENTS.md`/`CLAUDE.md`/notas (fonte única em `AGENTS.md`), remove telemetria repetida (fonte única em `economia-migracao.md`) e comprime o Histórico de versões para 1 linha/versão — a mecânica detalhada de cada área já vive nas seções acima |
| v0.49.3      | Ao vivo: card sobe para o topo da grade ao abrir "Abrir aqui" (agrupa os pregões abertos)                                                                                                                                                                                                                                               |
| v0.50.0      | Tarja diagonal "Vendido" em vigiados/lances já vendidos (`lot_sales` escopado por `getSoldLots`) — ver "Cores, badges e busca"                                                                                                                                                                                                          |
| v0.50.1      | Tarja "Vendido" também pelo `bidStatus` (`bidIsSold`) — sinal em tempo real, sem esperar o cron `step=sales` varrer o catálogo                                                                                                                                                                                                          |
| v0.51.0      | Tarja "Vendido" via `peca.asp` p/ vigiados sem lance (`getLotDetails`, sem custo extra) + refresh manual de Vigiados/Lances do dia                                                                                                                                                                                                      |
| v0.51.1      | Fix: refresh manual usava `invalidateQueries` (resolve mesmo se o refetch falhar) — troca por `refetch({throwOnError:true})` das próprias queries, toast agora reflete falha real                                                                                                                                                       |
| v0.51.2      | Fix: `lot_sales` ficava "presa" sem a venda (leilão capturado com 0 vendas nunca revisitado) — `checkSoldNow`/`captureSalesForAuctions` força releitura no refresh manual de Vigiados/Lances                                                                                                                                            |
| v0.51.3      | Reverte `checkSoldNow`/`captureSalesForAuctions` (v0.51.2 — pesado e arriscava o grau Disco/Capa da IA no Analytics); tarja "Vendido" via `peca.asp` passa a ler `MOSTRABTN_CLASS`/`VALOR_VENDA` do JSON embutido (mesmos campos do Analytics) em vez de marcadores de texto livre; `refetchOnMount: "always"` nas queries de status    |
| v0.51.4      | Fix: vigiados/lances somem da tela ao leilão terminar (conta para de trazê-los) — `watched`/`bids` passam a MESCLAR (nunca substituir) num acumulador local, poda só pela janela de dias/desvigia explícita; docs: endpoints de catálogo/peça documentados como fonte de verdade prioritária                                            |
| v0.51.5      | Mobile: header sticky mais compacto (padding menor, lista de dias/abas sem quebrar linha) nas 5 páginas autenticadas; fix do nav "ir para casa" da Análise, que ficava escondido atrás do header                                                                                                                                        |
| v0.51.6      | Fix: tarja "Vendido" errada em vigiados de leilão futuro — `getLotDetails`/`soldById`/`nextBidById` indexavam por `idPeca` sozinho (só único DENTRO de uma casa; casas parceiras são instalações independentes e reaproveitam os mesmos números), misturando o resultado de venda de um lote de uma casa com outro só coincidente no número; passam a indexar por `id` (`${idLeilao}-${idPeca}`). Fix: vigiados/lances do dia sumiam depois de um tempo mesmo sem desvigiar — o acumulador local (v0.51.4) vivia só num `useRef` em memória e se perdia a cada reload/fechar aba; agora persiste em `localStorage` (`loadAccum`/`saveAccum`)                                                                                                                                        |
| v0.52.0      | "Atualizar coleção" passa a ser INCREMENTAL por padrão (`importWonLotsIncremental` — lê os leilões vencidos em `l=4`/`status="Vencedor"` e varre só esses via `l=6&id=<idLeilao>`, `listPurchasesForAuctions`), em vez de sempre repaginar `l=6` do zero; cai sozinho para a varredura completa (`importWonLots`) na 1ª vez (coleção ainda sem item de leilão). Novo botão "Varredura completa" (`scanCollectionFull`) para forçar o backfill irrestrito manualmente |
| v0.52.1      | Fix: tarja "Vendido" ainda aparecia em vigiados de leilão FUTURO mesmo após v0.51.6 — `LotCard` agora bloqueia a tarja quando o leilão ainda não começou (`auctionStarted`), fail-closed contra qualquer fonte de `sold`/`bidStatus` errada (ex.: `idLeilao`/`idPeca` reaproveitados ao longo do tempo pela mesma casa). Fix: vigiados/lances somem ao navegar entre `/` e `/analise` — as duas rotas liam a MESMA chave de query (`["vinyl-watched"]`/`["vinyl-my-bids"]`) mas só `index.tsx` mesclava no acumulador (v0.51.4/6); a versão de `analise.tsx` SUBSTITUÍA, apagando o acumulado ao navegar; acumulador extraído para `@/lib/watched-accum` (`mergeWatchedAccum`), usado pelas duas rotas                                                                            |
| v0.52.2      | Fix: vigiado/lance ainda sumia da grade GERAL do dia (fora das visões dedicadas já corrigidas em v0.51.4-7) — o filtro "esconde finalizados por padrão" (`showFinishedDays`) não distinguia lote irrelevante de vigiado/com lance; `dayLots`/`finishedCount` ganham o predicado `isTracked` que exclui vigiados/lances desse corte                                                                                                                                                                                     |
| v0.53.0      | Mobile: os headers/barras `sticky` (das 5 páginas autenticadas) somem ao rolar pra baixo e voltam ao rolar pra cima, ganhando espaço de tela — `useHideOnScroll` (direção do scroll da janela) + `HideableBar` (recolhe a altura via `grid-template-rows`, sem deixar vão em branco)                                                                                                                                                                                    |
| v0.53.1      | Fix: barras piscando/pulando de posição ao rolar (v0.53.0) — `ResizeObserver` media o próprio wrapper que anima (vaivém de re-renders a cada frame, brigando com o scroll anchoring do navegador); `ref` passa para o conteúdo interno do header (altura estável), `stickyBelowHeader.top` vira `barsHidden ? 0 : headerHeight`, `HideableBar` ganha `overflow-anchor: none`, e `useHideOnScroll` trava novas trocas de estado por 350ms (`minFlipMs`)                |
| v0.53.2      | Fix: ainda piscava sem parar ao começar a rolar (v0.53.1) — o cadeado de tempo travava um NOVO flip mas não descartava o ruído de scroll "fantasma" gerado pela própria transição, que se acumulava em `lastY` e disparava outro flip assim que o cadeado destravava (vaivém sem fim); `minFlipMs` virou `cooldownMs`, que durante o cooldown só realinha `lastY` a cada scroll (sem nunca contar pra decisão de direção) em vez de travar e deixar o ruído se acumular; transição caiu de 300ms para 200ms (mais folga abaixo do cooldown de 400ms) |
| v0.54.0      | Abandona o auto-hide por scroll do topo no mobile (v0.53.0-2, continuava piscando mesmo após dois fixes) por um **botão manual** (`MobileTopToggle`, canto superior direito, só no mobile) — o usuário decide quando esconder/mostrar o header + barras sticky aninhadas; `useHideOnScroll` removido, `HideableBar` mantém o colapso via `grid-template-rows` mas agora `sm:grid-rows-[1fr]` sempre vence no desktop |
| v0.55.0      | Reorganização do topo da tela inicial (`_authenticated/index.tsx`): (1) o modo da IA, o seletor de provedor e o botão "Atualizar tudo"/"Atualizado: …" saem do header; (2) a busca (antes numa linha própria abaixo do header) ocupa o lugar deles na barra de navegação; (3) a barra de controles do dia (Vigiados/Lances do dia, Analisar dia, contagem de lotes, chips de casa) deixa de ser `sticky` abaixo do header e passa a renderizar **dentro** do header, acima da lista de dias — via `createPortal` para um `<div ref={setDayBarHost}>` no header, mantendo toda a lógica de derivação (por dia) onde já estava dentro do `.map` de `days` (sem duplicar), só trocando o destino do DOM |
| v0.55.1      | Os controles de IA/"Atualizar tudo" (movidos em v0.55.0) não ganham um `<footer>` próprio — entram na MESMA barra do rodapé global (`Footer.tsx`, fixo, montado uma vez em `__root.tsx`, mostra "Garimpo de Vinil" + versão): `Footer` ganha um `<div id="footer-extra">` na própria linha (entre o nome e a versão, `ml-auto` empurra a versão pro canto), e a tela inicial faz `document.getElementById("footer-extra")` (`useEffect`) + `createPortal` pra injetar os controles ali — sem acoplar `Footer.tsx` (compartilhado por todas as rotas) ao estado da tela inicial. `__root.tsx` sobe o `pb-12`→`pb-14` reservado pro rodapé fixo, já que a linha fica um pouco mais alta com os controles |
| v0.56.0      | `MobileTopToggle` (botão de esconder/mostrar o topo, v0.54.0) passa a aparecer também no desktop (`alwaysVisible`, novo prop — remove o `sm:hidden` quando true), só na tela inicial. No desktop, esconder recolhe TUDO menos a lista de dias/abas (`TabsList` — dias + Vigiados + Lances): o header da tela inicial (`_authenticated/index.tsx`) é reestruturado em um wrapper `sticky top-0` sempre visível, contendo (1) um `HideableBar` colapsável (novo prop `collapseOnDesktop`, que troca o `sm:grid-rows-[1fr]` fixo por recolher em qualquer tamanho de tela) com a linha de navegação/busca + a barra de controles do dia (portal do dayBarHost, v0.55.0), e (2) a `TabsList`, DE FORA do `HideableBar`, sempre visível. `headerHeight`/`stickyBelowHeader` (usado pelas barras sticky de Vigiados/Lances) precisam agora somar duas medições independentes (`useMeasuredHeight`, novo hook local com `ResizeObserver` que reanexa sozinho quando o nó muda — cobre a `TabsList`, que só monta depois que `lots` carrega): a altura da parte colapsável (`headerHeight`, zerada quando escondida) + a altura da `TabsList` sempre visível (`tabsBarHeight`, nunca zerada) |
| v0.57.0      | Egress do Supabase free (207% da cota) rastreado até o Storage das fotos da Coleção, não leituras de banco. `compressCollectionImage` (`collection.server.ts`) redimensiona (≤1600px) e recodifica em WEBP q82 via `sharp` antes de todo upload novo (`uploadCollectionImage`), com `cacheControl` de 7 dias. Backfill das fotos já existentes em `scripts/compress-collection-images.ts` (`bun run compress-images`, idempotente, roda manual fora do cron) |
| v0.58.0      | Segunda via pro backfill de fotos da coleção (v0.57.0): o script standalone precisa de rede direta ao Supabase, que nem todo ambiente tem (ex.: sandboxes com allowlist restrita). Lógica extraída pra `listUncompressedCollectionImages`/`backfillCompressCollectionImage` (`collection.server.ts`), compartilhada pelo script E por um novo step `compressimages` do `/api/cron` (chunked, `max`, roda na Vercel — que já tem rede pro Supabase) |
| v0.58.1      | Fix (INCOMPLETO — ver v0.58.2): tarja "Vendido" nunca aparecia em vigiados **sem lance** de casas do template ANTIGO (catálogo HTML server-side, ex.: Robson Gini) enquanto o leilão ainda estava "ao vivo" (v0.51.3 trocou o sinal do `peca.asp` de texto livre pro campo `MOSTRABTN_CLASS`, que só existe em casas do template NOVO). Tentativa: `parseSold` cai num fallback reaproveitando `parseSoldMarkers` (heurística de `parseCatalogData`, calibrada no CATÁLOGO) — não resolveu, ver v0.58.2 |
| v0.58.2      | Fix de verdade pro v0.58.1: confirmado contra o HTML real da `peca.asp` (Robson Gini/Trem das 7) que `parseSoldMarkers` não servia ali — o valor vem em `<span>`s separados ("R$" e "15,00" não são texto contínuo) e o texto "Lote vendido" aparece nos Termos e Condições de TODA peça (daria falso positivo se usado como marcador). Novo `parseSoldOldTemplate` (`leiloesbr-lot-details.server.ts`) usa a classe CSS do botão de lance (`id="fazerlance" class="is-CoolBtn lotevendido"`, token que só existe nesse estado) + uma janela maior até o span `is-valor` pro preço |

## Pendências

**Produto / código (em aberto)**

- _Nenhuma pendência em aberto._ (Os itens anteriores — lance pelo app, upload de foto em massa,
  peso da sondagem na nota e imagem pelo CDN do catálogo — foram **cancelados/descartados**.)

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

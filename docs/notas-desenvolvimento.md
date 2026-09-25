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
- **Schema consolidado em `supabase/setup.sql`, re-executável (tudo `IF NOT EXISTS`).** Não é
  mais Supabase hospedado (esse trecho do documento é anterior ao cutover pra VPS, ver "Infra"
  abaixo) — em **produção**, `deploy.yml` reaplica `setup.sql` sozinho a cada push pra
  `main`/`vps` (`docker compose exec postgres psql -f /docker-entrypoint-initdb.d/01-setup.sql`,
  depois do `up -d`), então uma tabela/coluna nova já existe no próximo deploy sem passo manual.
  Localmente, aplicar com `psql -f supabase/setup.sql` contra o Postgres do `docker compose` de
  dev (ou recriar o volume). Migrações incrementais em `supabase/migrations/` continuam só como
  **histórico/changelog** do schema. Ao criar tabela/coluna, editar `setup.sql` **e**
  `src/integrations/supabase/types.ts` à mão. Tabelas: `lots`, `known_artists`, `app_state`,
  `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`, `lot_condition`, `lot_sales`,
  `wantlist_items`, `collection_items`, `purchases`, `excluded_lots`.
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
    ⚠️ **Fix v0.58.3 — vigiar um lote confirmava no site mas o card continuava "não vigiado"**:
    a grade geral do dia (`rawDay`, `index.tsx`) sobrescreve `lot.watched` com `watchedIds.has
    (lot.idPeca)` sempre que `watchedIds.size > 0` (tem prioridade sobre o campo vindo da
    varredura geral) — e `watchedIds` deriva só de `watched.data` (a query `listWatched`, que lê
    a conta do LeilõesBR de novo). `toggle.onSuccess` já reescrevia `lotsQuery` na hora
    (`item.watched = result.watched`), mas só tratava o acumulador local (`watchedAccumRef`, que
    alimenta `watchedIds`) no caminho de DESVIGIAR — vigiar dependia inteiramente do
    `invalidateQueries`/refetch de `listWatched` pra `watchedIds` pegar o lote novo, e a conta do
    LeilõesBR pode demorar um instante pra refletir o toggle que acabou de confirmar. Resultado:
    o usuário vigiava, o site confirmava, mas o card no dia continuava sem a borda/ícone de
    vigiado até o próximo refetch (nem sempre visível, dependendo do timing). Fix: `toggle.
    onSuccess` agora trata as DUAS direções simetricamente — vigiar também escreve na hora em
    `watchedAccumRef` (reconstruindo o `WatchedLot` a partir do lote já conhecido em
    `lots.data.lots`, já que o retorno do toggle só traz `idPeca/idLeilao/base/watch`) e
    `queryClient.setQueryData(watchedQuery.queryKey, …)`, igual ao que desvigiar já fazia.
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
    ⚠️ **Fix v0.59.1 — lote continuava "vigiando" na ferramenta depois de desvigiado direto no
    site**: a poda do acumulador (`mergeWatchedAccum`) só removia um item quando o dia dele saía
    da janela de `WATCH_WINDOW_DAYS` — a saída "explícita" (linha acima) só cobria o desvigiar
    feito PELO PRÓPRIO APP (`toggle.onSuccess`). Se o usuário desvigiasse direto no site do
    LeilõesBR (fora do app), o `fresh` do próximo fetch já vinha sem o lote, mas como ele ainda
    estava dentro da janela de dias, o item ficava "grudado" no acumulador/`localStorage` como
    vigiado até o leilão sair da janela (até `WATCH_WINDOW_DAYS` dias depois). Fix:
    `mergeWatchedAccum` agora remove também um item ausente do `fresh` quando o leilão dele
    ainda **não terminou** (`auctionFinished`, `vinyl-parse.ts`, janela de 3h de graça após o
    horário de início) — se já terminou, mantém (é o caso original que a v0.51.4 corrigia: a
    conta para de listar o lote assim que o leilão acaba, mesmo ainda sendo "hoje"). Como `MyBid`
    (lances) não tem campo `time`, essa remoção por ausência só se aplica a vigiados
    (`WatchedLot`), preservando o comportamento de lances.
    ⚠️ **Fix v0.60.9 — lote com lance aparecia só como "Vigiando" (sem borda/status de lance)**:
    a poda por janela de dias em `mergeWatchedAccum` (`upcomingDayKeys(WATCH_WINDOW_DAYS)`, "hoje
    + próximos 4 dias") tratava `date` sempre como a data do LEILÃO — verdade para `WatchedLot`,
    mas não para `MyBid`: em `MyBid`, `date` (`leiloesbr-bids.server.ts#parseBidChunk`) é a data
    em que o LANCE foi dado (tipicamente hoje ou um dia antes do pregão), não a do leilão. Assim
    que essa data caía fora da janela "só futuro" — ou seja, em qualquer lance dado num dia que
    não fosse hoje —, o item era removido do acumulador na própria chamada de merge (antes de
    chegar a `bids.data`), e o `LotCard` nunca recebia `bidStatus`/`myBid`, caindo no card
    "só vigiado". Fix: `mergeWatchedAccum` agora poda vigiados (`item.time !== undefined`) pela
    janela de dias FUTUROS (`upcomingDayKeys`, como antes) e lances (`item.time === undefined`)
    por uma janela de dias PASSADOS a partir da data do lance (`recentDayKeys`,
    `BID_RETENTION_DAYS` = 14, margem generosa entre dar o lance e o leilão fechar).
    `recentDayKeys` é o espelho de `upcomingDayKeys` em `vinyl-parse.ts`.
    ⚠️ **Fix v0.74.2 — vigiado de leilão distante sumia da ferramenta**: a poda por janela de
    dias futuros (`upcomingDayKeys(WATCH_WINDOW_DAYS)`, "hoje + próximos 4 dias") também
    descartava vigiados de leilões **além** dessa janela — mesmo sendo uma vigia real, confirmada
    direto na conta do LeilõesBR (`l=8`, `listWatchedFromSite`), sem depender de o lote já estar
    na tabela `lots` (varredura geral limitada ao mesmo `WINDOW_DAYS` do servidor,
    `leiloesbr-scrape.server.ts`). Fix: `mergeWatchedAccum` não poda mais vigiados pelo TETO
    futuro — só remove quando o dia já é passado (`dayKey < hoje`) ou sem data legível; o teto
    artificial de `WATCH_WINDOW_DAYS` (removido, não é mais usado em lugar nenhum) só existia
    para espelhar a janela de scraping, mas o card do vigiado não depende dela (vem pronto —
    título/preço/imagem/data — direto da conta; casamento com `lots` para preço ao vivo/nota
    IA/Discogs é best-effort, se o lote ainda não foi varrido o card simplesmente mostra menos
    dado, nunca some). Lances (`MyBid`) não mudam — a poda deles continua olhando pra trás
    (`recentDayKeys`/`BID_RETENTION_DAYS`), já que `date` ali é a data do LANCE, não do leilão.
    ⚠️ **Fix v0.83.1 — lance para leilão futuro sumia da aba "Lances"**: como `date` em `MyBid`
    às vezes reflete a data do LANCE mas em outros casos o card mostra a data que aparece na
    listagem (que pode ser a do próprio leilão, futura), a checagem `!validBidDays.has(dayKey)`
    (`validBidDays` = só `recentDayKeys`, hoje + passado) removia do acumulador qualquer lance
    cujo `dayKey` caísse no futuro — ou seja, lances para leilões que ainda vão rolar sumiam da
    tela assim que eram mesclados. Fix: `mergeWatchedAccum` agora nunca poda lances por dia
    FUTURO (`dayKey > hoje`, sem limite de quão longe), só remove lances cujo dia já é PASSADO e
    caiu fora da janela de retenção — reduzida de `BID_RETENTION_DAYS` = 14 para 3 (hoje + 2 dias pra trás; lance
    passado pode sumir da tela depois de 2 dias).
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
  - **Redução de falso positivo (v0.77.0):** três frentes, priorizadas por custo/risco:
    - **Denylist de termos genéricos aprendida** (`app_state.collection_keyword_denylist`,
      `getCollectionKeywordDenylist`/`addCollectionKeywordDenylist` em `app-state.server.ts`),
      mesmo padrão do `trash_keyword_denylist` (só cresce, filtra dos dois lados). No painel de
      relação (`OwnedPanel`), quando o casamento foi automático/sugerido, os termos distintivos
      que causaram o score (`matchedAlbumTerms` em `wantlist-match.ts`) aparecem como chips
      clicáveis — clicar nega aquele termo GLOBALMENTE (não só no lote aberto), então um falso
      positivo causado por uma palavra genérica que `GENERIC_ALBUM_TOKENS` não previu deixa de
      se repetir em qualquer lote futuro, sem precisar reeditar o código. `ownedScore`/
      `ownedMatchForLot`/`coverage` ganharam um parâmetro opcional `denylist` que filtra os
      tokens do candidato ANTES de calcular cobertura.
    - **Apelidos do Analytics compartilhados com a Coleção:** `analytics_artist_aliases`
      (fusão manual de grafias, curada em "Análise de Vendas") antes só valia lá — agora
      `resolveArtistAlias(nome, aliases)` (`wantlist-match.ts`, mesma chave
      `normalizeForMatch` de `analytics.ts`) é aplicado ao nome do artista tanto em
      `ownedCandidate` (disco da Coleção) quanto em `lotIdentity` (lote) antes do casamento —
      uma correção de grafia feita numa tela passa a valer na outra. Query
      `["analytics-aliases"]` (mesma chave da tela de Analytics, cache compartilhado) também
      buscada na home.
    - **Calibração offline dos limiares:** `scripts/calibrate-collection-thresholds.ts`
      (`bun run calibrate-collection-thresholds`) reconstrói, a partir de
      `lots`/`lot_ident`/`lot_market`, a identidade de cada lote já presente em
      `collection_feedback` e roda `ownedScore` (agora exportado) contra os limiares atuais e
      uma varredura de cortes (0.50–0.95), reportando precisão/recall por corte — permite
      ajustar `OWNED_MATCH_MIN`/`OWNED_CONFIDENT_MIN`/`OWNED_ARTIST_MIN` com dado real em vez de
      no chute. Não roda automaticamente (é um script de análise manual, não um step do cron).
    - **Não implementado nesta rodada:** âncora por `release_id` do Discogs em
      `collection_items` (`lot_market.release_id` como sinal de altíssima confiança antes do
      fallback textual) — maior impacto estrutural, mas mexe em schema; fica como próximo passo.
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
  IA + artista + título; `extra` = casa + nº do lote. **Casamento por PALAVRA INTEIRA
  (v0.72.2):** todo `.includes`/`.startsWith` compara com espaço nas pontas (haystack e termo
  ambos "acolchoados") — sem isso "rita" batia em qualquer palavra que a contivesse solta
  ("manuscrita", "margarita"), já que `título` é a descrição completa do card (texto livre da
  casa), não só um nome curto. **Com busca ativa**, a listagem do dia
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
  **Defasa** (a varredura geral roda só 3×/dia via cron) e **some de vez** quando o leilão entra
  ao vivo (o lote sai da listagem pública) — por isso, para vigiados + lances, é sobrescrito pelo
  valor AO VIVO abaixo quando disponível.
- **Meu lance** = `myBid` (só na página "Meus lances", `l=4`).
- **Próximo lance e valor atual AO VIVO** = **NÃO** existem na listagem nem nas páginas de conta
  (o "atual" da conta é o mesmo `price` defasado acima). Só no **detalhe do lote** (`peca.asp`,
  JSON `loadData`): **`data[0].VALOR_VALUE`** (atual) e **`data[0].NOVO_VALOR`** (próximo, já
  calculado pelo site). **Só o lote ABERTO traz esses campos** → **1 requisição por lote** →
  buscado só para **vigiados + lances** (conjunto pequeno), nunca a listagem inteira.
  Implementação: `leiloesbr-lot-details.server.ts` (`fetchLotDetails`, concorrência 8, teto 100,
  regex `"VALOR_VALUE":"(\d+)"` / `"NOVO_VALOR":"(\d+)"`) → `getLotDetails` → query
  `["lot-details", ...]` (`staleTime` 3min, `refetchOnMount: "always"`). Não persiste (busca ao
  vivo, cache curto).
- **NÃO inferir o incremento** — o `NOVO_VALOR` real diverge dos "termos" da casa; ele é
  autoritativo. **`base`** (do `data-watch`) NÃO é o incremento (é a base/plataforma).
- **Regra de UI (card):** sempre "Atual"; "Próximo" quando há `nextBid`; "Meu lance" quando há
  `myBid` (linha abaixo). **Correção do "Atual" quando VENCENDO:** a listagem pública traz
  valor defasado → o `LotCard` usa `myBid` como "Atual" quando `bidIsWinning(status)`; por isso
  `myBid` é passado a **todos** os cards (`myBidById`). "Meus lances" (`l=4`) não traz o atual →
  casar por `id` com a varredura geral (`priceById`), sobrescrito pelo valor AO VIVO
  (`currentValueById`/`effectivePriceById`, em `index.tsx`) quando o `peca.asp` traz
  `VALOR_VALUE` — cobre tanto o caso "defasado" quanto o caso "sumiu da listagem geral".

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

## Aviso de lance superado (v0.59.0)

- **Só client-side, só com o app aberto** — nenhuma mudança em cron/`/api/cron`/DB. Reaproveita
  o refetch já existente de `["vinyl-my-bids"]` (`staleTime` 5min + refresh manual) tanto em
  `index.tsx` quanto em `analise.tsx`.
- **Detecção:** `bidIsCovered(status)` (`vinyl-parse.ts`, regex `/cobert/i`) identifica "fui
  superado". O evento a avisar é a **transição** para coberto — não o estado em si — senão todo
  reload avisaria de novo de um lote já coberto numa sessão anterior.
- **`bid-alerts.ts`** (`detectNewlyCoveredBids` + hook `useBidCoveredAlerts`): compara o `status`
  de cada `MyBid` contra um snapshot do último `status` visto por `id`, persistido em
  `localStorage` (`BID_STATUS_SNAPSHOT_KEY`) via os mesmos `loadAccum`/`saveAccum` genéricos de
  `watched-accum.ts` (chave compartilhada entre `index.tsx`/`analise.tsx`, igual ao acumulador de
  vigiados/lances). Quando há lote(s) recém-coberto(s), dispara `toast.warning` (`sonner`, já
  montado globalmente em `__root.tsx`) — um toast por lote, ou agrupado se vier mais de um na
  mesma leva.
- **Indicador persistente na tela** continua sendo o badge vermelho já existente
  (`BidStatBadges`/`HouseStats.red`, `badges.tsx`/`grouping.ts`) — não foi criado nenhum badge
  novo, o toast é só o "empurrão" ativo.

## Painel de mudanças — DESCONTINUADO (v0.25.0)

A página **`/dashboard`** foi removida (home/Análise/Ao vivo cobrem o uso). Chave órfã
`dashboard_baseline` em `app_state` pode ser apagada à mão. O `enrichLotes` (nº de lote)
segue existindo, usado pela home ("Atualizar tudo" — desde v0.84.0 também roda `galleryscan`/
`condition`/`aiident`, ver histórico de versões).

## Casas verificadas

- "Marcar casa como verificada" (chave `${dia}|${casa}`) **PERSISTE no servidor**: `app_state`
  chave `verified_houses` (array global). `getVerifiedHouses`/`setVerifiedHouses`. **Marcar
  também FECHA a casa** (`toggleVerified` remove de `openHouses`) e migra para "Já verificadas".
- **localStorage vira só cache** (pinta a tela na hora); fonte da verdade é o servidor. No 1º
  load há **migração única** localStorage → servidor. (Antes ficava só no localStorage → sumia
  ao trocar de navegador/dispositivo ou usar a URL de preview, de origem diferente.)

### Ordem das casas e abrir/fechar seções (v0.74.0)

- **Ordenação uniforme das casas** (grade principal, Vigiados do dia, Vigiados geral, Lances
  do dia, Lances geral): sempre por **horário do leilão** e, no empate (sem horário ou mesmo
  horário), **alfabética**. Antes a grade principal ordenava por nº de lotes (desc) e os
  vigiados/lances por nº de itens (desc) — trocado pelo horário, que é o que importa pra saber
  a ordem em que os leilões abrem no dia.
  - `timeMinutes(time)` (`grouping.ts`) converte "19:30h"/"9h"/"9:30" em minutos desde meia-noite
    (mesmo regex de `auctionStartMs` em `vinyl-parse.ts`); sem horário/ilegível vai pro fim
    (`+Infinity`), igual ao `loteNum`.
  - `groupByHouse` (grade principal) e `groupWatchedByHouse` (vigiados/lances) ordenam por
    `timeMinutes` e devolvem `time` no grupo.
  - **Lances não têm horário na origem** ("Meus lances" só traz a data do lance, não o horário
    do leilão) — `houseTimeByDayHouse` (`index.tsx`) casa `${dayKey}|casa` com o horário lido
    da varredura geral e dos vigiados, e `bidsWithHouseUrl` injeta esse horário em cada lance
    antes de agrupar (mesmo padrão do `houseUrlByName` já existente pra URL da casa).
- **Abrir/fechar por casa, com "Fechar todas"**: a grade principal já tinha
  `openHouses`/`toggleHouse` (casa começa FECHADA); ganhou um botão "Fechar todas" no início da
  lista (`closeAllHouses(day)`, remove as chaves `${dia}|casa` do set).
  - Vigiados do dia, Vigiados geral, Lances do dia e Lances geral **não tinham como recolher
    casa nenhuma** (sempre abertas) — ganharam o mesmo padrão, só que com o **padrão invertido**
    (casa começa ABERTA): `closedHouseSections`/`toggleHouseSection`/`closeAllHouseSections`
    (`index.tsx`), chave por tela (`watched-day|`, `bids-day|`, `watched|`, `bids|` +
    `${dia}|casa`) pra não colidir entre as 4 telas. `BidHouseSections`
    (`bid-house-sections.tsx`, usado por Lances do dia e Lances geral) ganhou as props opcionais
    `isHouseOpen`/`onToggleHouse`/`onCloseAll` — sem elas, continua sempre aberto (usado também
    por outras telas que não precisam do recolher).
- **Barra de chips das casas** (no header, acima da lista de dias — mostra cada casa da grade
  principal com contagem e ir direto pra seção) ganhou um botão de olho pra ocultar só ela,
  independente do "recolher topo" (`MobileTopToggle`/`barsHidden`) que já existia — estado local
  `housesBarHidden`, só no navegador (sem persistir). Chip é distinto do `openHouses` visto no
  item acima: continua controlando abrir/fechar cada seção, só a LISTA de chips some.

## Atualização em background (cron 3×/dia, v0.69.41)

- **Endpoint** `/api/cron` (tratado direto em `src/server.ts`, FORA das server functions → sem
  Supabase/CSRF), protegido pelo segredo **`CRON_TOKEN`** (header `x-cron-token`; o fallback
  `?token=` foi removido — vazava em logs; comparação em tempo constante, `tokensMatch`).
- **Steps:** `chunk` (varre bloco), `enrich` (nº de lote por `offset`), `aiident`
  (identificação IA), `aieval` (avaliação IA), `market` (Discogs), `condition` (estado
  pré-leilão), `sales` (captura de vendas), `reident` (reidentifica/padroniza o histórico de
  vendas pela IA), `cleannonvinyl` (limpeza retroativa de itens não-disco já capturados,
  `dryRun` por padrão — `&apply=1` apaga de fato; uso manual único, não entra no laço do
  `refresh.yml`), `salesdebug`/`catdebug` (diagnósticos).
- **GitHub Actions** `.github/workflows/refresh.yml`: `cron: "10 3,11,19 * * *"` (UTC = BRT
  00:10/08:10/16:10) + `workflow_dispatch`. Reduzido de 4x/dia (v0.60.0 e antes) para 2x/dia em
  v0.60.1 — a Fluid Active CPU da Vercel estava estourando a cota do plano Hobby (ver
  `docs/economia-migracao.md`) — e aumentado de volta para 3x/dia em v0.69.41 (já fora da
  Vercel, no VPS) pra reduzir o gap de descoberta entre execuções (ver Pendências: "Leilão de
  casa multi-dia sumia de um dia específico"). Varre em blocos até `nextPage:null`, enriquece
  por `offset` até `done:true`, depois laços curtos de `aiident` → `aieval` → `market`.
- O **"Atualizar tudo"** manual na UI continua (chunk + enrich por cursor), sem mudança.
- **Corrigido em v0.60.2:** os steps `aieval`, `aiident` e `market` baixavam `lot_ai`/
  `lot_ident`/o snapshot inteiro de `lots` a cada chamada do laço (mesmo padrão que causava o
  egress do `reident`, ver `docs/economia-fase-1-egress-e-cpu.md`). Em vez de uma RPC de
  anti-join (exigiria migration nova), a correção foi um **cache curto em memória (TTL 30s)**
  na própria instância de function: `scrapeVinylLots(false)` (`leiloesbr-scrape.server.ts`,
  `memCache`) e `getAllLotAi`/`getAllLotIdent` (`lot-ai.server.ts`/`lot-ident.server.ts`,
  `allCache`) devolvem o resultado já lido em vez de reconsultar o banco, dentro do TTL.
  Invalidado a cada escrita (`upsertLotAi`/`updateLotTags`/`upsertLotIdent`) para nunca servir
  algo mais velho que a última gravação **desta instância**. Como o laço do cron chama esses
  steps em sequência rápida (sem `sleep`, exceto `aieval`/`aiident` esperando batch), a mesma
  instância "quente" da Vercel tende a atender várias chamadas seguidas e reaproveitar o cache.
  Best-effort: se cair numa instância fria a cada chamada, funciona igual a antes (só sem o
  ganho). `getAllLotMarket` (`lot-market.server.ts`) **não** foi cacheado de propósito — o
  `market` grava nela a cada iteração e o próximo laço precisa ver essa escrita para não
  reprocessar os mesmos lotes.
  Mitigação complementar: laços do `refresh.yml` encolhidos (`aieval`/`aiident` 10→5,
  `market` 30→12).
- **v0.60.3:** mesma correção estendida a `condition` (`enrichConditions`, lia
  `lot_condition` inteira a cada chamada) e `sales` (`captureFinishedSales`, lia
  `seen_auctions` inteira — tabela **nunca podada**, cresce para sempre igual `lot_sales`
  antes do fix do `reident`). Cache TTL 30s em `getAllLotCondition` (invalidado por
  `upsertLotCondition`) e em `readSeenAuctions` (sem invalidação por escrita — quem grava
  `seen_auctions` é outro módulo, `recordAuctions`; tolerável, best-effort).

## IA (avaliação, identificação, modo)

**Multi-provedor (v0.27.0):** o app usa **Claude (Anthropic)** OU **Gemini (Google)** — camada
plugável em **`ai-provider.server.ts`** (+ metadados client-safe em `ai-provider.ts`). Modelos
baratos por padrão: **`claude-haiku-4-5`** (`ANTHROPIC_API_KEY`, override `ANTHROPIC_MODEL`) e
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
    (`identCollectionSync`, `ai-eval.server.ts`, SÓ TEXTO, nunca a capa), rodando com um `id`
    avulso ("draft") já que o disco ainda não existe em `collection_items`; **não persiste
    nada**. Preenche artista/álbum/ano/descritivo/tags no formulário (tags são ACRESCENTADAS às
    já digitadas, via `mergeTagsText`, sem duplicar) para o usuário revisar/ajustar antes de
    "Enviar" — mesmo aviso de failover de provedor (`formatFailoverTrail`) das outras telas de IA.
    Usa sempre o provedor padrão do `app_state` (sem seletor próprio no diálogo).

## Exclusão de lotes — `excluded_lots` (v0.72.0)

- **Objetivo:** o usuário exclui manualmente um lote "lixo" (ex.: joia, item que escapou do
  filtro de vinil) e ele **nunca mais volta**, mesmo em varreduras futuras do cron — e o sistema
  **aprende** os termos do título para sinalizar (nunca esconder sozinho) lotes futuros
  parecidos como "possível lixo".
- **DELETE físico, sem desfazer** — diferente do padrão "soft-hide via `app_state`" usado pelo
  Analytics (`analytics_excluded_sales`/`analytics_excluded_artists`) ou pelo aprendizado da
  Coleção (`collection_feedback`): aqui o lote é APAGADO de `lots` de verdade
  (`excludeLot`, `src/lib/lot-exclusion.server.ts`) — `ON DELETE CASCADE` já existente limpa
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` junto (mesmas FKs da Fase 5 da migração
  VPS). Reverter exigiria re-raspar o site; não há botão de "desfazer" nesta versão.
- **Tabela `excluded_lots`** (`supabase/setup.sql` +
  `supabase/migrations/20260922000000_excluded_lots.sql`): `id` é a MESMA PK de `lots.id`
  (histórico — a linha sobrevive ao lote já apagado, mesma razão de `lot_sales` nunca cascatear
  com `lots`), `title`/`house`/`artist` (snapshot no momento da exclusão), `reason` (opcional,
  do usuário), `keywords text[]` (extraídas do título, ver abaixo), `excluded_by`, `excluded_at`.
- **Bloqueio de reinserção pelo cron:** `persistLots` (`leiloesbr-scrape.server.ts`) filtra os
  lotes frescos contra `getExcludedLotIds()` (1 query best-effort — nunca lança, um erro aqui só
  falha em não filtrar nada) ANTES do upsert. Mesmo princípio dos outros prune
  (`pruneOutOfWindow`/`pruneNonVinylLots`), mas aplicado na ENTRADA em vez de limpeza posterior.
- **"Possível lixo" — heurística por palavras-chave, SEM IA** (`src/lib/lot-exclusion.ts`,
  módulo puro/client-safe, mesmo padrão de `grading.ts`/`wantlist-match.ts`):
  `extractKeywords(title, artist)` normaliza (`normalizeForMatch`, de `vinyl-parse.ts`), remove
  stopwords em PT + termos genéricos de catálogo ("disco", "vinil", "lote", "capa"...) e o
  próprio artista (evita falso positivo por nome comum); `matchPossibleTrash` compara por
  OVERLAP DE CONTAGEM (não percentual, `MIN_OVERLAP=2`) contra os lotes já excluídos — o
  primeiro casamento vira o sinal (`{ matchedTerms, excludedTitle }`).
- **Calculado no CLIENTE, NÃO persistido:** `index.tsx` busca `getExcludedLotsForMatching`
  (`["excluded-lots"]`, `staleTime` 30 min) e monta `possibleTrashById` num `useMemo` a partir de
  `lots.data.lots` — mesmo padrão de `albumById`/`marketById`. Decisão deliberada: volume baixo
  (exclusão manual, 1 usuário), sem testes automatizados no projeto, evita decidir "quando
  recalcular" (a cada exclusão? a cada upsert do cron?) que uma tabela/coluna persistida exigiria.
- **UI:** botão de lixeira no `LotCard` (só aparece quando `onExclude` é passado — hoje só nas
  duas listagens de DESCOBERTA de lotes novos: busca com relevância e "por casa → artista";
  **não** nas abas Vigiados/Lances, que mostram lotes já em acompanhamento) abre
  `ExcludeLotDialog` (`components/vinyl/exclude-lot-dialog.tsx`, um diálogo só, controlado por
  estado no `index.tsx`, mesmo padrão do `OwnedPanel`) com motivo opcional. Sucesso remove o
  lote do cache de `["vinyl-lots"]` na hora (otimista) e invalida `["excluded-lots"]`. Badge
  "⚠ possível lixo" (laranja, com tooltip dos termos casados) fica na linha de badges do card,
  ao lado de demanda/condição — nunca esconde nada sozinho.
- **`setup.sql` reaplicado automaticamente a cada deploy:** esta PR também corrigiu a convenção
  antiga ("SQL Editor ou `psql -f`", resquício de quando o projeto era Supabase hospedado — não
  é mais, ver "Infra" abaixo) — `deploy.yml` agora roda
  `docker compose exec postgres psql -f /docker-entrypoint-initdb.d/01-setup.sql` depois do
  `up -d`, em TODO push pra `main`/`vps` (idempotente, `IF NOT EXISTS`), então uma tabela/coluna
  nova em `setup.sql` já existe no próximo deploy sem passo manual. Ver "Restrições do ambiente"
  no topo deste documento.
  ⚠️ **Fix v0.72.1 — esse mesmo auto-apply quebrou o primeiro deploy em produção**: `setup.sql`
  ainda tinha `GRANT`/`REVOKE` para papéis (`anon`/`authenticated`/`service_role`) e um
  `INSERT INTO storage.buckets` herdados do Supabase hospedado, que nunca existiram de verdade
  no Postgres self-hosted da VPS — rodavam sem erro só porque o script nunca tinha sido
  executado de fato contra esse banco (o schema veio de `pg_restore`, não de `setup.sql`; ver
  "Infra" abaixo). Na primeira execução automática (`ON_ERROR_STOP=1`), o script travou no meio
  (`role "service_role" does not exist`), ANTES de chegar em `excluded_lots` — a tabela nunca
  foi criada, e a exclusão de lote falhava em produção com "relation excluded_lots does not
  exist". Corrigido: `CREATE ROLE IF NOT EXISTS` (idempotente) pra `anon`/`authenticated`/
  `service_role` logo no topo de `setup.sql` (só pra RLS não falhar — a conexão real do app
  ignora RLS por ser dona das tabelas) + removida a linha morta do Storage bucket (fotos da
  Coleção são arquivo em disco desde a Fase 5).
- **Badge "possível lixo" clicável → aprendizado por negação (v0.73.0):** clicar no badge diz
  "isto NÃO é lixo" — não precisa excluir nada nem existe mais um lote pra apontar (o casamento
  é por palavras-chave, não por id). O clique nega os TERMOS que causaram aquele casamento
  específico (`ExclusionSignal.matchedTerms`), não só aquele lote: `app_state` ganha a chave
  `trash_keyword_denylist` (array simples, mesmo padrão de `verified_houses`, só cresce — nunca
  esquece um termo já negado), via `getTrashKeywordDenylist`/`addTrashKeywordDenylist`
  (`app-state.server.ts`) e as server functions `getTrashKeywordDenylist`/`dismissPossibleTrash`
  (`lot-exclusion.functions.ts`). `matchPossibleTrash` (`lot-exclusion.ts`) ganhou um 3º
  parâmetro opcional `denylist: ReadonlySet<string>`, filtrado de AMBOS os lados (keywords do
  lote novo E do lote excluído) antes de contar o overlap — assim o termo negado deixa de gerar
  falso positivo em QUALQUER lote futuro, não só no que foi clicado (é isso que "melhora o
  modelo": a heurística fica mais precisa a cada correção, sem precisar reexcluir nada). UI:
  o badge vira `<button>` com "✕" quando `onDismissTrash` está presente (`LotCard`); clique
  chama `dismissTrashMutation` (`index.tsx`) com atualização OTIMISTA de
  `["trash-keyword-denylist"]` — o badge some da tela na hora, antes mesmo da resposta do
  servidor, e reverte com toast de erro se a gravação falhar.

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

## Lote em pregão ao lado de "Ao vivo agora" (v0.75.0–v0.76.0)

Selo `LiveLotNow` (`src/components/vinyl/live-lot-now.tsx`): "🔨 Lote 457" + mini barra
"135/322 · 41%" logo após a tag "Ao vivo agora" — na lista principal (dentro de
`AuctionStatusInline`, `badges.tsx`, cobre as 3 ocorrências do `index.tsx`) e nos cards do
`/ao-vivo`. Só com `status === "live"` e `presencialUrl`.

- **Mecânica**: o `presencial.asp` chega com o lote VAZIO (`<span class="is-lotenumber">--</span>`)
  — quem preenche é o JS da página (`novoPresencial.LePregao`). O servidor imita isso:
  `publicFetch` do `presencial.asp` (sem login) → `idleilao`/`idsite` do script inline
  (`UpdatePresencialArr`, `parsePresencialIds`; cacheados por URL) → GET no endpoint de polling
  comum da plataforma `https://d1vzg1b1ofiies.cloudfront.net/1s/le_registro_pregao_cfbr_v1.asp?i=<idleilao>&j=<idsite>&p=`
  (`p` vazio = primeira carga, responde igual; override por `PRESENCIAL_PREGAO_URL`). Resposta
  `LANCES*|*INFOLEILAO*|*flag*|*PROXIMOS_LOTES`; `INFOLEILAO.LOTE` = nº do lote,
  `QTD_ATUAL`/`QTD_LOTES` = "Peça nº x de y", % = `floor(x/y*100)` (igual ao site). Parser puro
  em `src/lib/presencial-now.ts`; fetch em `leiloesbr-presencial.server.ts` (valida https + host
  público via `isPublicHost` exportado do proxy + caminho `/presencial/presencial.asp`; cache 30 s —
  ≤ metade do intervalo do cliente, senão vira o piso da atualização;
  best-effort → `null`, selo some). Server fn `getPresencialNow`.
- **Atualização**: `useQuery` com `refetchInterval` 1 min (era 5 min no v0.75.0 — ~7 lotes de
  atraso num pregão de ~40 s/lote; 1 min ≈ 1–2 lotes, custo ainda desprezível: 60 GETs de ~5 KB/h
  por casa ao vivo vs. 3.600/h da própria página do site), `staleTime` 30 s, `refetchIntervalInBackground: false`
  (pausa com a aba oculta) e `refetchOnWindowFocus`. `queryKey ["presencial-now", url]`
  compartilhada entre lista e `/ao-vivo`. Dado até ~1 min defasado — tooltip mostra "há X min".
- Formato descoberto pelo usuário no console do navegador (2026-09-22, Traditio, leilão 63534);
  a rede deste ambiente não alcança as casas nem o CDN.
- **v0.76.0**: mesmo selo (lote + barra) também na seção "Acontecendo agora" (`LiveAuctions`,
  `src/components/vinyl/live-auctions.tsx`) — leilões que já começaram e somem da listagem
  pública. Card compacto de 2 linhas (nome da casa + 1 linha de info): a linha "Início hh:mm ·
  UF · N lote(s)" (`HouseInfoLine`, local ao arquivo) é TROCADA pelo lote em pregão agora assim
  que a consulta carrega, em vez de virar uma 3ª linha — mantém o tamanho do card igual, com ou
  sem dado. Mesma `queryKey ["presencial-now", url]` do `LiveLotNow`, então a consulta é
  deduplicada com a lista principal/`/ao-vivo` quando a mesma casa aparece nos dois — nenhuma
  requisição extra.

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

## Infra — economia / saída dos free tiers (migração para VPS concluída, Fase 6 feita)

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
- **Fase 2 (VPS único em São Paulo, R$ 37,59/mês) — plano fechado em v0.60.5/6, Fases 1–6
  concluídas (v0.62.0–v0.69.13), cutover feito e `vps` mesclada em `main`.** Migração completa
  (Postgres + Auth + Storage + Host + backup/faxina) em 6 fases, executadas numa branch
  **`vps`** paralela enquanto a `main` ficou intocada na Vercel; a Fase 6 (cutover, v0.69.13)
  migrou o banco de produção real pro VPS e mesclou `vps` → `main` — `main` voltou a ser a
  branch de trabalho/produção padrão (v0.69.17), Supabase/Vercel mantidos de pé só como rede
  de reversão (sem prazo definido pra desligar). `vps` segue viva em paralelo só pelo trabalho
  experimental da Fase 7 (preview deployments via Dokploy, abaixo). A camada de dados saiu por
  um **shim `postgres.js`** que preserva o nome exportado `supabaseAdmin` e é ligado por
  `DATABASE_URL` —
  os 15 arquivos de lógica e toda a UI não mudaram. Auth virou OAuth Google direto (o contrato
  preservado é `context.claims.email`, então os 60 `assertAllowed` ficaram intactos); Storage
  virou volume em disco, servido pelo Node até a Fase 4 e pelo Caddy depois dela. `vite.config.ts:9`
  já honrava `SERVER_PRESET`, então trocar de host (Fase 4) foi env var, não código: `Dockerfile`
  multi-stage (`bun run build` com `SERVER_PRESET=node-server` → runtime `node:22-slim`, copiando
  só o `.output` do Nitro, que já vem com `node_modules` rastreado por dependência — inclui o
  binário nativo do `sharp`), `docker-compose.yml` (`caddy` + `app` + `postgres:17`, desenhado
  para multi-app desde o início — rede Docker externa `proxy`, `mem_limit` por serviço),
  `Caddyfile` (TLS automático, reverse proxy pro `app`, `file_server` pro volume de
  `/collection/*`) e `.github/workflows/deploy.yml` (build → GHCR → SSH no VPS → `docker compose
  pull && up -d`, disparado a cada push em `vps`). `version-bump.yml` passou a comparar também
  contra `vps` (`branches: [main, vps]`), não só `main`. Fase 5 entrou junto: serviço `backup`
  no compose (imagem própria em `docker/backup/`, também buildada/publicada pelo
  `deploy.yml` — `pg_dump` a cada 24h para o Cloudflare R2, S3-compatible; a retenção de 14
  dias é uma regra de lifecycle no bucket, não lógica no script); ping pro healthchecks.io no
  fim/erro do `refresh.yml` (`HEALTHCHECKS_PING_URL`, opcional); FKs `ON DELETE CASCADE` de
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` para `lots(id)` (nunca `lot_sales`, que é o
  arquivo permanente) — migração limpa os órfãos já acumulados antes de criar a constraint;
  novo `step=prune` no cron (`seen_auctions`, só remove leilões com vendas já capturadas,
  nunca perde backlog). Roteiro completo, riscos e verificação por fase em
  `docs/economia-fase-2-vps-unico.md`.
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
| v0.58.3      | Fix: vigiar um lote confirmava no site (LeilõesBR) mas o card na grade geral do dia continuava aparecendo "não vigiado". `watchedIds` (deriva de `listWatched`, que relê a conta do LeilõesBR) tem prioridade sobre `lot.watched` sempre que já há outros vigiados — e `toggle.onSuccess` (`index.tsx`) só atualizava o acumulador local que alimenta `watchedIds` no caminho de DESVIGIAR, não no de VIGIAR (dependia do refetch de `listWatched` pegar o lote novo, que pode atrasar). Agora vigiar também escreve na hora em `watchedAccumRef`, reconstruindo o `WatchedLot` a partir do lote já conhecido em `lots.data.lots` |
| v0.59.0      | Aviso de "lance superado": toast (`sonner`) quando um lote com lance vira `status === "Coberto"` (`bidIsCovered`, `vinyl-parse.ts`), disparado pelo hook `useBidCoveredAlerts` (`bid-alerts.ts`) sobre o `bids.data` das queries `["vinyl-my-bids"]` já existentes em `index.tsx`/`analise.tsx`. Só funciona com o app aberto (nenhuma mudança em cron/DB) — a transição é detectada comparando com um snapshot do último `status` visto por lote, persistido em `localStorage` via `loadAccum`/`saveAccum` (mesmo helper de `watched-accum.ts`) |
| v0.59.1      | Fix: lote ficava marcado "vigiando" na ferramenta mesmo depois de desvigiado direto no site do LeilõesBR (fora do app), até sair da janela de dias do acumulador. `mergeWatchedAccum` (`watched-accum.ts`) agora remove também um item ausente do `fresh` quando o leilão ainda não terminou (`auctionFinished`), não só quando o dia sai da janela |
| v0.60.0      | Botão "refazer consulta" no painel de detalhes da nota da IA (hover no selo, cards e Análise): reavalia o lote na hora, ignorando o cache por título (`reevaluateLot` server fn → `evalLotsSync` direto + `upsertLotAi`), e atualiza o cache `["lot-ai"]` local com o resultado — ver seção "IA (avaliação, identificação, modo)" |
| v0.60.1      | Cron 4x/dia → 2x/dia (`refresh.yml`, `0/3/9/15/21` → `10 3,17 * * *`) — Fluid Active CPU da Vercel estourou a cota do Hobby; egress do Supabase também segue acima da cota (ver `docs/economia-migracao.md`) |
| v0.60.2      | `aieval`/`aiident`/`market` liam `lot_ai`/`lot_ident`/`lots` inteiros a cada chamada do laço (mesmo padrão de egress do `reident`) — cache curto (TTL 30s, invalidado por escrita) em `scrapeVinylLots`/`getAllLotAi`/`getAllLotIdent` + laços do `refresh.yml` encolhidos (aieval/aiident 10→5, market 30→12) |
| v0.60.3      | Mesmo fix estendido a `condition`/`sales` — `getAllLotCondition`/`readSeenAuctions` também liam tabela inteira a cada chamada do laço (`seen_auctions` nunca é podada, cresce para sempre); cache TTL 30s nas duas |
| v0.60.4      | Mesmo fix no último caso recorrente: `getAllLotSales({ withOrig: false })` (sem `ids`) — usado por `getVinylSales` (Vinil Analytics) e pela padronização de grafia dentro de `reidentifyAllSales` — ganhou cache TTL 30s, invalidado por `upsertLotSales`. Varredura de padrões concluída: `collection.server.ts`/`wantlist.server.ts` também leem tabela inteira, mas só em página aberta pelo usuário (não em laço do cron) — prioridade baixa, não mexido |
| v0.60.5      | Plano de migração para VPS único fechado e documentado (só documentação, sem mudança de código): `docs/economia-fase-2-vps-unico.md` reescrito como plano executável em 6 fases — shim `postgres.js` preservando `supabaseAdmin`, OAuth Google direto, Storage em volume, branch `vps` paralela com a `main` intocada até o cutover |
| v0.60.6      | Provedor e SO fechados no plano de migração (só documentação): HostGator VPS Cloud OCI NVMe 4 em São Paulo (2 vCPU / 4 GB / 100 GB, 13 ms) com "SO Simples" Ubuntu LTS — os 4 GB removem o risco de OOM no `sharp` e os 2 vCPU tiram a disputa do cron com o Postgres |
| v0.60.7      | Catálogo de Aplicações do provedor avaliado no plano (só documentação): "Docker" é atalho aceitável, **"Supabase" self-hosted é descartado** (12+ containers, ~3-4 GB, não cabe nos 4 GB junto com o app — e Realtime/Edge Functions nem são usados), K3S descartado |
| v0.60.8      | Plano de migração passa a prever multi-app no VPS (só documentação): rede Docker externa compartilhada com o Caddy roteando por domínio, um Postgres só com bancos separados, `mem_limit` por serviço e orçamento de memória (~800 MB usados de 4 GB) — evita refatorar o compose depois |
| v0.60.9      | Fix: lote com lance dado aparecia na tela só como "Vigiando" (sem borda/status de lance). `mergeWatchedAccum` (`watched-accum.ts`) podava TODO item pela janela "hoje + próximos N dias" (`upcomingDayKeys`), mas em `MyBid` (lances) o campo `date` é o dia em que o LANCE foi dado (passado), não o do leilão — o item saía do acumulador assim que era mesclado, antes de chegar a `bids.data`/`LotCard`. Lances agora podam por uma janela de dias PASSADOS a partir da data do lance (`recentDayKeys`, novo espelho de `upcomingDayKeys` em `vinyl-parse.ts`; `BID_RETENTION_DAYS` = 14); vigiados continuam podando pela janela futura, sem mudança de comportamento |
| v0.61.0      | Abas gerais **Vigiados**/**Lances** (`index.tsx`) passam a agrupar por dia de forma recolhível — cabeçalho do dia (antes só rótulo) virou botão com chevron; dia atual (`days[0]`) começa aberto, os demais fechados por padrão (`watchedDayOpen`/`bidsDayOpen`, `Record<dayKey, boolean>` — só grava override quando o usuário clica) |
| v0.61.1      | Novo menu **Compras** (`/compras`, botão no header ao lado de Coleção/Analytics): histórico PERSISTIDO de "Minhas compras" (vinil), diferente de Vigia/Lances (lidos ao vivo). Nova tabela `purchases` (`supabase/setup.sql` + migration), sync incremental (`purchases.server.ts`: `syncPurchasesIncremental`, mesma descoberta de leilões vencidos via `wonAuctionIdsFromBids`/`l=4` da Coleção, mas gravação numa tabela própria — um lote pode aparecer em `purchases` E `collection_items`), novo `step=purchases` no cron/`refresh.yml`, e `purchases.functions.ts` (`getPurchases`/`scanPurchases`/`scanPurchasesFull`). UI com 3 visões por botão toggle (mesmo idioma de "Vigiados/Lances do dia"): mais recentes, por dia, por casa (`groupWatchedByHouse` reaproveitado) |
| v0.61.2      | Compras: as visões "por dia" e "por casa" não podiam mais misturar as duas dimensões — cada uma agora traz a outra como sub-agrupamento aninhado (`DaySection`, `compras.tsx`): "por dia" separa cada dia em sub-cabeçalhos por casa; "por casa" separa cada casa em sub-seções por dia. "Dia" é a unidade colapsável recorrente nas duas visões (top-level em "por dia", aninhada dentro de cada casa em "por casa"), sempre com o dia mais recente aberto por padrão e os demais fechados (`useState` por instância, sem `useEffect` — a chave estável por dia preserva o toggle do usuário entre refetches) |
| v0.62.0      | Migração para VPS, Fase 1 (`docs/economia-fase-2-vps-unico.md`): novo shim `postgres.js` (`src/lib/db.server.ts` conexão singleton lazy; `src/lib/db-query.server.ts` builder encadeável/thenable cobrindo `from/select/eq/neq/gte/lte/gt/lt/like/in/not/or/order/range/limit/single/maybeSingle/insert/update/delete/upsert` + `rpc`) reproduzindo a fatia do PostgrestQueryBuilder realmente usada. `client.server.ts`: com `DATABASE_URL` definida, `supabaseAdmin.from`/`.rpc` passam a falar direto com o Postgres via o shim; `.storage` continua no cliente Supabase (migra na Fase 3); sem `DATABASE_URL`, comportamento idêntico a antes. Nenhum import mudou nos 15 arquivos de lógica de negócio — reverter é apagar a env var. `upsert` replica a proteção do PostgREST contra colunas ausentes no payload (caso `orig_text` em `lot-sales.server.ts`): colunas fora de TODAS as linhas do lote não entram no `INSERT`/`ON CONFLICT UPDATE`. Validado contra Postgres real do VPS (dump/restore do Supabase); `types` customizado em `db.server.ts` corrige `date`/`timestamp`/`numeric` que o `postgres.js` devolvia como `Date`/string em vez de string/número (PostgREST) — sem isso, Compras quebrava e Analytics perdia valores nas médias |
| v0.63.0      | Migração para VPS, Fase 2 (`docs/economia-fase-2-vps-unico.md`): Auth sai do Supabase, vira Google OAuth direto (authorization code + PKCE) implementado à mão. Novo `src/lib/auth.server.ts` — fluxo completo (`/api/auth/google/start`, `/api/auth/google/callback`, `/api/auth/logout`, tratados fora das server functions em `server.ts`, mesmo padrão de `handleCron`/`handleLiveProxy`) e cookie de sessão HttpOnly assinado por HMAC (`gs_session`, 30 dias), reaproveitando o padrão de `leiloesbr-live.server.ts` (cookie `lp_auth`). Novo `src/lib/auth.functions.ts` (`getSessionEmail`, sem middleware, pra não lançar quando não há sessão). `auth-middleware.ts` **reescrito com o mesmo nome/path** (`requireSupabaseAuth`) para validar o cookie em vez de Bearer JWT — os 60 call sites de `.middleware([requireSupabaseAuth])` não mudaram uma linha. `start.ts` perde o `attachSupabaseAuth` (cookie viaja sozinho, sem precisar de middleware client-side anexando `Authorization`). `_authenticated/route.tsx` passa a checar sessão no servidor (tira o `ssr: false`); `routes/auth.tsx` vira link simples pro `/api/auth/google/start` (sem PKCE no cliente). Removidos `auth-attacher.ts` e `client.ts` (cliente Supabase do navegador); **`api-fetch.ts` foi mantido**, ainda usado pelo cliente Supabase do `.storage` (Fase 3) — desvio do plano original, que previa remover os três juntos. Novas env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` |
| v0.64.0      | Migração para VPS, Fase 3 (`docs/economia-fase-2-vps-unico.md`): fotos da Coleção saem do bucket `collection` do Supabase Storage, viram arquivos em disco (`COLLECTION_DIR`, default `./data/collection`). Novo `src/lib/collection-storage.server.ts` — `uploadCollectionFile`/`getCollectionPublicUrl`/`collectionPathFromUrl`/`removeCollectionFile` e `handleCollectionAssets` (serve `GET/HEAD /collection/*` com `Cache-Control: public, max-age=604800` e guarda contra path traversal); até a Fase 4 (Docker/Caddy) o próprio Node serve esses arquivos, registrado em `server.ts` no mesmo padrão de `handleCron`/`handleLiveProxy`/`handleGoogleAuth` — na Fase 4 o Caddy assume esse papel sem mudar este módulo. Os 3 usos de `supabaseAdmin.storage` em `collection.server.ts` (`uploadCollectionImage`, `listUncompressedCollectionImages`, `backfillCompressCollectionImage`) migrados; `compressCollectionImage` não muda. **Com Auth (Fase 2) e Storage (Fase 3) fora do Supabase, `@supabase/supabase-js` saiu do `package.json`** — `client.server.ts` virou só um wrapper de `createDbQueryClient()` (`DATABASE_URL` agora obrigatória, sem fallback pro Postgres do Supabase); `auth-attacher.ts`/`client.ts` (Fase 2) e agora `api-fetch.ts` removidos. Testado localmente sem precisar do VPS (upload/leitura/remoção/path-traversal via script direto no módulo) — dados reais das fotos migram no cutover (Fase 6), bucket do Supabase continua no ar até lá |
| v0.65.0      | Migração para VPS, Fase 4 (`docs/economia-fase-2-vps-unico.md`): host sai da Vercel, vai pro Docker Compose num VPS. Novo `Dockerfile` (multi-stage: `oven/bun:1` builda com `SERVER_PRESET=node-server`, `node:22-slim` só copia o `.output` do Nitro — que já vem com `node_modules` rastreado por dependência, incluindo o binário nativo do `sharp`, sem reinstalar nada na imagem final). Novo `docker-compose.yml` (`caddy`/`app`/`postgres:17`) já desenhado para multi-app no mesmo VPS desde o início: rede Docker **externa** `proxy` (só o Caddy publica 80/443), `mem_limit` por serviço, Postgres sem porta publicada. Novo `Caddyfile` (TLS automático por `APP_DOMAIN`, reverse proxy pro `app`, `file_server` servindo `/collection/*` direto do volume — o mesmo `COLLECTION_DIR` do Node, agora também montado no Caddy). Novo `.github/workflows/deploy.yml`: builda a imagem no Actions (não no VPS) a cada push em `vps`, publica no GHCR e faz `docker compose pull && up -d` por SSH (`webfactory/ssh-agent`); secrets novos `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`/`VPS_DEPLOY_PATH`. `version-bump.yml` passa a comparar também contra a base `vps` (antes só `main`), já que as fases da migração abrem PR pra lá. Ajustes de passagem: User-Agent do Discogs (`discogs.server.ts`) lê `PUBLIC_BASE_URL` em vez do domínio fixo da Vercel; `README.md`/`AGENTS.md`/`CLAUDE.md`/`.env.example` reescritos (ainda descreviam Supabase + Vercel, defasados desde a Fase 1). Sem mudança de código de produto — testado por build local da imagem (`docker build`) e leitura estática do compose/Caddyfile; deploy real (`workflow_dispatch` do `refresh.yml` contra o VPS, `/api/live`) fica para quem tem acesso à máquina, junto com a checagem de arquitetura (`uname -m`) já prevista no plano |
| v0.66.0      | Migração para VPS, Fase 5 (`docs/economia-fase-2-vps-unico.md`): backup, monitoramento e faxina. Novo serviço `backup` no compose (`docker/backup/Dockerfile` + `backup.sh`, base `postgres:17-alpine` + `awscli`): loop que roda `pg_dump` a cada 24h (`BACKUP_INTERVAL_HOURS`) e sobe o `.sql.gz` pro Cloudflare R2 (S3-compatible, `R2_ENDPOINT`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) — a retenção de 14 dias é uma regra de **lifecycle no bucket** (configurada uma vez no painel do R2), não lógica no script, então o backup nunca apaga nada sozinho; imagem buildada/publicada pelo mesmo `deploy.yml` do `app` (novo job de build, tag `-backup`). `refresh.yml` ganha um ping pro healthchecks.io (`HEALTHCHECKS_PING_URL`, opcional): sucesso no fim, `/fail` via `trap ... ERR` se qualquer chamada falhar — falha silenciosa do cron era o risco nº 1 do plano. Nova migração `20260917120000_orphans_fk_cascade.sql` (espelhada em `supabase/setup.sql`): limpa os órfãos já acumulados em `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` (todos com `id` = `lots.id`, que `pruneOutOfWindow` some de baixo deles) e cria `FOREIGN KEY ... ON DELETE CASCADE` idempotente (`pg_constraint` checado antes do `ADD CONSTRAINT`) pras próximas podas não deixarem órfão de novo — **nunca** em `lot_sales` (arquivo permanente de vendas). Novo `step=prune` no cron (`pruneSeenAuctions`, `leiloesbr-auctions.server.ts`): remove de `seen_auctions` (que nunca era podada, só crescia) os leilões cujas vendas já constam em `app_state.sales_captured`, com margem de 14 dias — nunca perde o backlog de um leilão ainda pendente de captura. Sem mudança de código de produto visível na UI — validado por `tsc`/lint/build; dump/restore real no R2 e o teste de restauração ("backup não testado não é backup") ficam para quem tem acesso ao VPS/R2 |
| v0.67.0      | Migração para VPS, ainda Fase 5: novo serviço `portainer` no compose (`portainer/portainer-ce:lts`, `--http-enabled`), exposto pelo Caddy num subdomínio PRÓPRIO (`PORTAINER_DOMAIN`, nunca um path do domínio do app) — painel visual de containers/logs/deploys, o mais perto de um "dashboard estilo Vercel" que dá pra ter num VPS único. ⚠️ Tem acesso ao socket do Docker do host inteiro (todos os apps da máquina, não só o Garimpo); documentado no checklist manual (senha do admin no primeiro acesso, antes do timeout; considerar allowlist de IP/Cloudflare Access). De passagem, **corrigido um bug real que vinha desde a Fase 4 (v0.65.0, já mesclado)**: o serviço `caddy` no `docker-compose.yml` nunca tinha `env_file`, então `{$APP_DOMAIN}` no `Caddyfile` (placeholder do PRÓPRIO Caddy, resolvido pelo ambiente do container em tempo de execução — não é substituição do docker-compose) ficaria vazio em produção; sem esse `env_file`, o Caddy teria subido com endereço de site vazio. Achado ao verificar como `{$PORTAINER_DOMAIN}` seria resolvido |
| v0.67.1      | Só documentação: `docs/economia-fase-2-vps-unico.md` ganha uma seção **"Progresso"** com checkbox por passo do checklist manual da Fase 6 (contratar VPS, chave SSH, secrets, `.env`, R2, healthchecks.io, deploy, DNS, Portainer, Google OAuth, validação, cutover) — antes os passos eram só instrução, sem nenhum registro de "o que já rodou" persistido entre sessões (o trabalho é feito fora do repo, por SSH/painéis externos, e uma sessão nova não tinha como saber o que já foi feito). `docs/economia-migracao.md` (índice) corrigido — ainda dizia "Fase 2: execução não iniciada", desatualizado desde que as Fases 1–5 entraram em código |
| v0.68.0      | Fase 6 (cutover) em andamento, primeiros passos manuais do checklist executados no VPS real: `deploy.yml` ganha suporte a `VPS_SSH_PORT` (opcional, cai pra 22 se ausente) — `ssh-keyscan`/`ssh`/`scp` passam a usar `-p`/`-P`, necessário porque o VPS trocou a porta padrão por segurança. `docs/economia-fase-2-vps-unico.md`: passo 1 (preparar o VPS) reescrito com mais detalhe — troca de porta do SSH (com o cuidado de nunca fechar a sessão em uso), o achado de que **`sudo` no usuário `deploy` sem senha precisa de `NOPASSWD` em `/etc/sudoers.d/`** (ou ele nunca autentica), e uma pegadinha real de produção: imagens cloud-init (comum em provedores de VPS) trazem um `/etc/ssh/sshd_config.d/50-cloud-init.conf` que **reforça `PasswordAuthentication yes`** e vence a edição manual do `sshd_config` principal (o `Include` desses drop-ins vem ANTES no arquivo, e o `sshd` usa o primeiro valor encontrado) — resolvido com um drop-in `00-hardening.conf` que entra antes na ordem alfabética. Também documentado: `ufw` pode estar instalado mas **inativo** por padrão (regras cadastradas não valem nada até `ufw enable`). Checklist de progresso marcado (passos 1–3 concluídos: VPS endurecido, chave SSH dedicada do GitHub Actions gerada e autorizada, secrets cadastrados) |
| v0.68.1      | Fix do primeiro `workflow_dispatch` real do `deploy.yml` contra o VPS: `docker/build-push-action@v6` com `cache-to: type=gha` falhava com "Cache export is not supported for the docker driver" — o runner hospedado do GitHub Actions usa o driver `docker` do Buildx por padrão, que não suporta esse tipo de cache; precisa do driver `docker-container`. Novo passo `docker/setup-buildx-action@v3` antes dos dois builds (app e backup) resolve |
| v0.68.2      | Fix do primeiro login real contra o VPS (`sslip.io`): `redirect_uri_mismatch` do Google mesmo com a URI certa cadastrada no Console. Causa: atrás do Caddy, a conexão do Node com o container é HTTP puro (TLS só na borda) e o Nitro/h3 não confia em `X-Forwarded-Proto` por padrão — `url.origin` (`src/lib/auth.server.ts`) montava o `redirect_uri` como `http://` mesmo com o site servido em HTTPS. `redirectUri()` agora prioriza `PUBLIC_BASE_URL` (já configurada certa no `.env` de produção) sobre `url.origin`, que vira só o fallback de dev local. `PUBLIC_BASE_URL` passa de opcional pra efetivamente obrigatória em produção atrás de proxy reverso — `.env.example` atualizado |
| v0.68.3      | Só documentação: checklist de progresso da Fase 6 (`docs/economia-fase-2-vps-unico.md`) atualizado até o passo 11 — primeiro deploy real bem-sucedido em `143-95-214-240.sslip.io` (TLS automático, login Google, sessão LeilõesBR ativa) e Portainer em `painel-143-95-214-240.sslip.io`. Registrados os três achados de produção só visíveis rodando de verdade: `.env` editado no Windows chegando com CRLF e aspa desbalanceada (quebrava o parser do `docker compose`), chave SSH do GitHub Actions gerada com passphrase por engano (`-N '""'` no PowerShell não é vazio de verdade), e o fix do `redirect_uri` do v0.68.2. Passo 6 (healthchecks.io) fica pendente, pulado por ora |
| v0.68.4      | Fix real de deploy: o `postgres:17-alpine` do `docker-compose.yml` nunca recebia o schema sozinho — descoberto tentando salvar um item na Coleção (`relation "collection_items" does not exist"`). Postgres serve `docker-entrypoint-initdb.d`: scripts ali só rodam quando o volume de dados nasce vazio. `docker-compose.yml` ganha um mount `./supabase-init:/docker-entrypoint-initdb.d:ro`; `deploy.yml` copia `supabase/setup.sql` pro VPS nesse caminho a cada deploy (é re-executável, `IF NOT EXISTS` — copiar de novo não faz nada em bancos já inicializados). Validado de ponta a ponta contra o VPS real: upload de foto na Coleção e um ciclo completo do `backup` (`pg_dump` → upload pro R2) funcionando |
| v0.68.5      | Limpeza de sobras do Supabase que a migração deixou pra trás (achadas numa varredura, sem pedido específico): `leiloesbr-live.server.ts` (`proxySecret`) tinha um fallback morto pra `SUPABASE_SERVICE_ROLE_KEY`, que não existe mais em lugar nenhum — removido, cadeia vira `LIVE_PROXY_SECRET \|\| CRON_TOKEN`; `.env.example` atualizado pra combinar. `scripts/compress-collection-images.ts`: comentário do topo ainda descrevia o backfill como dependente de rede pro Supabase Storage e das env vars `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — o script já usa `DATABASE_URL` (via `supabaseAdmin`) e baixa as fotos do próprio domínio público (`PUBLIC_BASE_URL`) desde a Fase 3, só o comentário estava desatualizado |
| v0.68.6      | 3 achados de uma revisão de código pedida sobre toda a Fase 4-6 (Docker/Caddy/Postgres/backup/auth): **(1)** `auth.server.ts` decidia o `Secure` dos cookies (sessão, OAuth) por `url.protocol === "https:"` — atrás do Caddy isso é sempre `"http:"` (mesmo bug de protocolo já corrigido pro `redirect_uri` no v0.68.2, mas deixado passar nos cookies); novo `isSecureRequest()` compartilha a mesma prioridade de `PUBLIC_BASE_URL`, usado nas 4 chamadas de `cookieHeader`. **(2)** `docker/backup/backup.sh`: se o `aws s3 cp` falhasse, o `.sql.gz` nunca era removido (o `rm -f` vinha depois, sob `set -e`) — acumulava lixo em `/tmp` do container de vida longa a cada falha; trocado por `trap 'rm -f "$file"' RETURN`, que limpa em qualquer saída da função. **(3)** `pruneSeenAuctions` (`leiloesbr-auctions.server.ts`) calculava o corte de retenção com `.toISOString()` (UTC), enquanto `day_key` é sempre a data em São Paulo — desalinhava por algumas horas perto da virada do dia; corrigido pra usar o mesmo `Intl.DateTimeFormat` de `todayDayKey` |
| v0.68.7      | Só documentação: cookie `Secure` do v0.68.6 revalidado no VPS real (DevTools confirmou o atributo marcado no `gs_session`) e o teste de restauração do backup ("backup não testado não é backup") executado contra o VPS real — dump mais recente baixado do R2, restaurado num Postgres descartável isolado (`docker run postgres:17`, sem tocar no banco de produção) via `psql -v ON_ERROR_STOP=1`, e conferido: as 12 tabelas do schema vieram todas e `collection_items` bateu com a linha esperada. Checklist de progresso (`docs/economia-fase-2-vps-unico.md`, passo 11) atualizado |
| v0.69.0      | `ai-provider.server.ts`: antes de sair do Gemini por quota e cair pro Claude, `runOne` agora tenta um downgrade interno pro `gemini-2.5-flash-lite` (cota gratuita própria, separada do Flash) — só propaga (acionando o failover de provedor de `runText`) se o Flash-Lite também estourar quota, ou se o modelo pedido já era ele mesmo |
| v0.69.1      | Failover de IA (`runText`, `ai-provider.server.ts`) deixa de ser silencioso: percorre a ordem canônica dos provedores (hoje Claude → Gemini, pronta pra crescer) registrando um motivo claro por tentativa em `attemptErrors` — `"sem chave de API configurada"` pro que nem tem chave, `"sem créditos/quota"`/`"indisponível no momento"` pro que respondeu com erro — em vez de pular provedor sem chave em silêncio ou só dizer "trocou de provedor" no sucesso. Propagado por `evalLotsSync`/`identLotsSyncRows`/`identCollectionSync`/`conditionAiSync` (`SyncOutcome.attemptErrors`) e pelas rotas sob demanda (`analyzeOnDemand`, `reidentifyCollection`, `reidentifyCollectionItem`) até a UI: novo `formatFailoverTrail` (`ai-provider.ts`) monta o toast passo a passo (ex.: "Claude: sem chave de API configurada · Gemini: sem créditos/quota — usei Gemini") em `index.tsx`/`colecao.tsx`. Quando NENHUM provedor atende, a mensagem de erro final já vem com a trilha completa (o `throw` de `runText` junta os motivos), então os toasts de "IA não retornou" existentes passam a mostrar por que cada provedor falhou |
| v0.69.2      | Modelo do Gemini virou escolhível na UI: novo `GeminiModelSelect` ao lado do `AiProviderSelect` (home, Coleção, Vinil Analytics), listando `GEMINI_MODELS` do mais barato ao mais caro (`ai-provider.ts`) — 6 ids escolhidos por busca na web, padrão trocado pro alias `gemini-flash-lite-latest`. Persistido em `app_state.gemini_model`, resolvido uma vez por rodada síncrona via `resolveGeminiModel()` (`ai-eval.server.ts`) e passado como 3º parâmetro opcional a `runText`/`runOne` |
| v0.69.3      | Diagnóstico temporário: `step=prune` (`cron.server.ts`) vinha falhando com 400 só quando chamado pelo `refresh.yml` via GitHub Actions (3 rodadas seguidas, #120/#121 e a #119 nem chegava a testar) — mas funcionava normal (200) quando testado com `curl` direto do VPS, com o mesmo token/header. Como sucesso e o fallback "step inválido" são ambos silenciosos (nenhum loga nada) e o Caddy não tem `log` configurado no site, não havia nenhuma evidência de qual `step` o servidor via de fato. Adicionado `console.log("[cron] recebido", {step, search, xff})` logo após parsear o `step`, pra próxima falha vir com prova direta — remover depois que o caso for entendido |
| v0.69.4      | Fix do v0.69.2: `gemini-flash-lite-latest` (o padrão escolhido) e `gemini-3.5-flash-lite` voltam **400 INVALID_ARGUMENT** de verdade — não existem pra API, quebrando a análise por IA em produção no mesmo dia (confirmado pelo usuário). Como 400 não é erro de quota/transitório, propaga direto sem acionar o failover — um id inventado quebra a chamada sem aviso. `GEMINI_MODELS` reduzida pra só os TRÊS ids confirmados: `gemini-2.5-flash-lite` (mais barato, desliga out/2026), `gemini-3.1-flash-lite` (**novo padrão** — confirmado rodando, sem prazo de desligamento) e `gemini-flash-latest` (histórico, mais caro). `GEMINI_FREE_FALLBACK_MODEL` volta a ser `gemini-2.5-flash-lite`. Lição documentada: nome de modelo "provável" de busca na web não é confiável, testar contra a API antes de adicionar |
| v0.69.5      | Fase 7 (opcional, `docs/economia-fase-2-vps-unico.md`): planejado preview deployment por PR via **Dokploy** (preferido a Coolify pela margem de memória da VPS — 2 vCPU/4 GB, ~2–2,4 GB livres depois do Portainer). Dokploy roda fora do `docker-compose.yml`, Traefik dele em portas alternativas, nunca 80/443 — Caddy continua a única borda pública/TLS. Novo bloco `{$PREVIEW_DOMAIN}` no `Caddyfile` (`reverse_proxy dokploy-traefik:80`, HTTP puro) e nova env `PREVIEW_DOMAIN` (`.env.example`) documentando o wildcard e a exigência de DNS-01 (HTTP-01 não valida wildcard). Decisão explícita do usuário: preview aponta pro **banco de produção** e roda com credenciais reais/cron ativo — não é ambiente somente-leitura, ação na UI da preview é ação real na conta. Mitigação obrigatória por causa disso: cron automático (`refresh.yml`/healthchecks) nunca aponta pro domínio de preview, já que a sessão do leiloesbr é por origem/cookie em memória e login simultâneo derruba uma sessão na outra. Instalação do Dokploy, DNS wildcard e certificado DNS-01 ficam pendentes (trabalho manual no VPS) |
| v0.69.6      | Segunda tentativa de diagnosticar o 400 do `step=prune` (v0.69.3 não deu prova nenhuma: `console.log` de aplicação simplesmente não chega no `docker logs` — Nitro usa logger próprio (`consola`), não repassa `console.log` cru pro stdout capturado pelo Docker; removido). Duas mudanças: **(1)** `cron.server.ts` — o fallback "step inválido" (400) agora ecoa `receivedStep`/`receivedSearch` no corpo da resposta. **(2)** `refresh.yml` — só a chamada de `step=prune` deixa de usar o `call()` compartilhado (que tem `-f`, suprime corpo em 4xx) e passa a imprimir o corpo completo + `HTTP_STATUS` via `-w`, sem abortar o step (`\|\| true`) — a prova fica direto no log do próprio GitHub Actions, sem depender do `docker logs` do VPS (que se mostrou não confiável nesse caso). Reverter as duas mudanças depois que o caso for entendido |
| v0.69.7      | Fase 7 corrigida com dados reais da instalação no VPS (`vpsbr-16094357`): ambiente roda sslip.io, não domínio próprio — cortado o plano de DNS-01/wildcard, `PREVIEW_DOMAIN` é só um domínio normal (HTTP-01 automático, igual `APP_DOMAIN`). Traefik do Dokploy é container standalone (`dokploy-traefik`, não Swarm/compose) na rede `dokploy-network`; portas remapeadas na mão de 80/443 pra **8081/8444** (8080 colide com o entrypoint interno `traefik` do `api.insecure`). `docker-compose.yml`: serviço `caddy` ganha a rede externa `dokploy-network` (só assim alcança `dokploy-traefik` pelo nome); `Caddyfile` corrigido pra `reverse_proxy dokploy-traefik:8081`. **Incidente real de produção**: o bloco `{$PREVIEW_DOMAIN}` foi ao ar pelo `deploy.yml` antes de `PREVIEW_DOMAIN` existir no `.env` do VPS — variável vazia vira bloco `{ }` sem domínio, que o Caddy recusa por não ser "configuração global" válida (não é o primeiro bloco do arquivo) → Caddy em crash-loop, app inteiro fora do ar até setar a env e forçar recriação do container (`--force-recreate`, um `up -d` normal não recria só por mudança no `.env`). Achado um segundo bug no meio da correção: `echo ... >> .env` colou o valor novo direto na última linha do arquivo (sem quebra de linha antes), corrompendo `DISCOGS_TOKEN` numa única linha `DISCOGS_TOKEN=...PREVIEW_DOMAIN=...` — corrigido com `sed` inserindo a quebra de linha que faltava. `.env.example` ganha aviso em maiúsculas sobre a obrigatoriedade de `PREVIEW_DOMAIN` não-vazio. `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`DISCOGS_TOKEN` marcados pra rotação (apareceram em texto puro numa sessão ao depurar o `.env`) |
| v0.69.8      | Fase 7: também confirmado que `docker compose up -d` sozinho **não recria** um container quando só a lista de `networks:` de um serviço muda no compose (mesma pegadinha do `env_file` do v0.69.6) — precisou de `--force-recreate` de novo pro Caddy entrar de fato na `dokploy-network` depois do deploy automático. Cadeia Caddy → `dokploy-traefik:8081` validada de ponta a ponta (`preview.143-95-214-240.sslip.io` responde 404 do Traefik, TLS válido). Achado em produção: um certificado emitido pro subdomínio de preview entra no log público de Certificate Transparency, e bots de varredura (`leakix` etc.) já bateram nele menos de 15 min depois do primeiro request — confirma que "subdomínio não anunciado" não é proteção nenhuma. Mitigação: `basic_auth` (usuário `preview`, hash bcrypt gerado com `docker run --rm caddy:2-alpine caddy hash-password`) na frente do bloco `{$PREVIEW_DOMAIN}` inteiro no `Caddyfile` — a senha em si não fica no repo, só documentada como comentário no `.env` do VPS (não versionado) |
| v0.69.9      | Fase 7: novo `docker-compose.preview.yml` (usado só pelo Dokploy, modo "Compose" simples, nunca pelo `deploy.yml`/produção) pra buildar o app de preview a partir do `Dockerfile` existente e servir na porta 3000. Duas redes externas: `dokploy-network` (Traefik do Dokploy enxerga o container — labels `traefik.*` explícitos, já que `exposedByDefault` é `false` no `traefik.yml`) e `garimpo_default` (a rede do compose de PRODUÇÃO, reaproveitada só pra resolver o hostname `postgres` — decisão explícita de apontar a preview pro banco real sem duplicar dado nem tocar no compose de produção, sem precisar publicar porta nem mudar nada no Postgres existente). Roteamento em HTTP puro (entrypoint `web`, não `websecure`) — TLS continua sendo só o Caddy. Escopo desta etapa: validar UM app de preview fixo (branch `vps`, domínio único `PREVIEW_DOMAIN`) antes de configurar a automação real de "um subdomínio por PR" do Dokploy, que exige TLS on-demand no Caddy (fora do escopo por ora) |
| v0.69.10     | Fase 7 validada de ponta a ponta no VPS real: repo conectado no Dokploy (GitHub App própria, só este repo), app `garimpo-preview` deployado e testado — login Google + Basic Auth funcionando, dados reais da produção aparecendo (mesmo banco). **Achado grave no caminho**: instalar o Dokploy (Swarm + várias recriações de container) deixou o **DNS interno do Docker quebrado pra rede `garimpo_default`** — `getaddrinfo('postgres')` passou a falhar em QUALQUER container dessa rede, inclusive `garimpo-app-1` de produção; só não derrubou a produção na hora porque o pool do `postgres.js` já tinha conexão aberta de antes (não precisa re-resolver DNS pra manter viva), mas qualquer reconexão nova falharia. TCP direto por IP funcionava normal, confirmando que era só a resolução de nome. Corrigido com `docker compose down && up` (recria os containers, não precisa recriar a rede em si) — a preview precisou do mesmo tratamento, mas via `docker compose ... up -d --force-recreate` direto no diretório do Dokploy, já que os botões "Deploy"/"Rebuild" do painel não recriavam o container sozinhos sem mudança de código. Lição registrada em `docs/economia-fase-2-vps-unico.md`: suspeitar do DNS interno do Docker (não da rede/compose) quando um container novo não resolve um hostname que outros resolvem, e usar `node -e "require('dns').lookup(...)"` em vez de `getent hosts` pra diagnosticar (`getent` se mostrou pouco confiável nessas imagens, retornando vazio até em containers funcionando) |
| v0.69.11     | Fase 7: TLS "on-demand" no Caddy pra suportar preview real por PR (não mais um domínio fixo). Novo bloco global `on_demand_tls` (topo do `Caddyfile`, obrigatório ser o primeiro) + endpoint interno `:2020/ask-preview` (não publicado, só o próprio Caddy chama) que aprova qualquer domínio igual ou subdomínio de `PREVIEW_DOMAIN`, rejeitando o resto — testado com tentativas de burlar (`evilpreview.<domínio>`, `<domínio>.evil.com`), ambas bloqueadas. Bloco fixo `{$PREVIEW_DOMAIN} { ... }` vira um catch-all `:443` (qualquer SNI que não seja `{$APP_DOMAIN}`/`{$PORTAINER_DOMAIN}`) com `tls { on_demand }` + Basic Auth + `reverse_proxy dokploy-traefik:8081`. `docker-compose.preview.yml` vira template reutilizável: labels do Traefik usam `${PREVIEW_ROUTER_NAME:-garimpo-preview}` em vez de nome fixo, pra apps de PRs diferentes não colidirem no mesmo Traefik. **Processo novo, por causa dos dois incidentes reais anteriores**: sintaxe do Caddyfile validada localmente ANTES de mandar pro VPS — baixado o binário oficial do Caddy (sem precisar de Docker) e rodado `caddy validate`/`caddy run` de verdade contra o arquivo do repo, incluindo teste do endpoint `/ask-preview` com curl. Registrar esse hábito: qualquer mudança de Caddyfile daqui pra frente passa por essa validação antes do push, já que `deploy.yml` aplica direto em produção |
| v0.69.12     | Só documentação: validado no VPS real que `teste-novo-123.preview.143-95-214-240.sslip.io` (subdomínio nunca antes usado) recebeu certificado Let's Encrypt automaticamente e chegou no Traefik — prova de ponta a ponta do TLS on-demand do v0.69.11. Investigada e **descartada por ora** a automação nativa de "um subdomínio por PR" do Dokploy (existe, só em apps tipo "Application", com `Wildcard Domain` e rede extra configuráveis) — bloqueio real: Google OAuth não aceita redirect URI com wildcard, cada subdomínio novo quebraria o login até alguém cadastrar a URL na mão no Google Cloud Console, anulando a vantagem de ser automático. Decisão do usuário: manter o esquema atual (um app de preview fixo, redirect URI já cadastrada, login funcionando) em vez de múltiplos previews em paralelo. Registrado em `docs/economia-fase-2-vps-unico.md` como pendência reavaliável só se o app deixar de depender de login Google |
| v0.69.13     | **Cutover da Fase 6, passo 8: `vps` mesclada em `main`** (PR normal, merge commit — preserva o histórico das ~14 commits da migração, mesma convenção do PR #182 anterior). Decisão do usuário: mesclar antes do fim da janela de segurança de 1 semana, já com o VPS validado de ponta a ponta contra dados reais; Supabase e Vercel continuam de pé, intocados, como rede de reversão fácil — nada foi desligado. `deploy.yml` passa a disparar em push tanto pra `vps` quanto pra `main` (antes só `vps`) — `vps` continua existindo em paralelo enquanto durar o trabalho experimental da Fase 7 (preview deployments via Dokploy) lá, sem tocar `main` ainda |
| v0.69.14     | **Bug real de produção encontrado e mitigado**: o cron (`step=prune`, depois `step=aieval`) passou a voltar 500/503 ("CRON_TOKEN não configurado") só quando chamado via GitHub Actions — causa raiz: `docker-compose.preview.yml` (Fase 7) tem um serviço chamado `app`, e o Compose registra o nome do serviço como alias de rede automaticamente; como esse compose entra de propósito na rede `garimpo_default` (pra alcançar o `postgres` de produção) **e** na `dokploy-network`, e o Caddy de produção está nas DUAS também, o alias `app` ficou duplicado nas duas redes — o Caddy (`reverse_proxy app:3000`) passou a resolver, de forma ambígua, ora pro container de produção, ora pro de preview (sem `CRON_TOKEN`, sem as mesmas credenciais). Mitigação imediata aplicada no VPS: `docker network disconnect` do container de preview das duas redes (confirmado: cron voltou a responder 200). Fix definitivo no código: serviço renomeado de `app` pra `previewapp` em `docker-compose.preview.yml` — sem colisão de alias, mantém a resolução de `postgres` (alias diferente, intocado). Pendente: recriar o container de preview no Dokploy com o compose atualizado (fica inoperante até lá, sem rede nenhuma) |
| v0.69.15     | Segundo bug real de produção, diferente do v0.69.14 (a colisão de rede já foi corrigida e confirmada — a preview foi recriada como `previewapp`): `step=aieval` volta 500 quando chamado pelo `refresh.yml` via GitHub Actions logo em seguida do `enrich`, mas funciona normal (200) testado isolado direto do VPS — mesmo padrão de "só falha via Actions" já visto no `prune`. `call()` (com `-f`) suprime o corpo do erro, então não dá pra ver a mensagem real ainda. Aplicada a mesma técnica de diagnóstico do `prune` (v0.69.3/v0.69.6) só nesse loop do `refresh.yml`: curl sem `-f`, `HTTP_STATUS` extraído por um marcador (`===HTTPSTATUS===`, robusto a `===` dentro do JSON — testado isolado), e o loop para (sem abortar o resto do cron) em vez de `set -e` matar a run inteira. Próxima falha deve trazer a mensagem de erro real do `catch` de `handleCron` |
| v0.69.16     | A mensagem real do v0.69.15 veio: `"Missing DATABASE_URL environment variable."` (`db.server.ts`) — intermitente e sem explicação ainda. Descartadas duas teorias: (1) corrida com um deploy simultâneo (reproduziu de novo minutos depois, sem nenhum deploy em andamento); (2) requisição batendo no container de preview por engano (a rede está limpa — só um alias `app`, `previewapp` distinto — e o preview TAMBÉM tem `DATABASE_URL` configurado, então nem explicaria o erro). Um teste direto no `localhost:3000` do próprio container de produção, rodado segundos antes/depois da falha via Actions, sempre funciona — o processo em si tem a env var (confirmado também por `printenv`). Ainda não dá pra saber se é sempre o MESMO processo Node respondendo, então o `catch` de `handleCron` (`cron.server.ts`) passa a incluir `pid`/`uptimeSec`/`hostname`/`hasDatabaseUrl` no corpo de qualquer erro 500 — remover depois que o caso for entendido |
| v0.69.17     | Só documentação: `main` mesclada com `vps` de novo (4 commits, #190) e — decisão do usuário — **`main` volta a ser a branch de trabalho padrão** a partir de agora (não `vps`). `AGENTS.md`/`CLAUDE.md` atualizados: aviso de migração trocado por um registro do cutover concluído, convenção de branch de trabalho volta a apontar pra `origin/main`, `deploy.yml` documentado como disparando em `main` (produção) ou `vps` (ainda usada pela Fase 7/preview deployments, trabalho paralelo de outra sessão) |
| v0.69.18     | Só documentação: auditoria da migração pedida pelo usuário. `notas-desenvolvimento.md` tinha ficado pra trás em dois pontos desde o cutover (v0.69.13): a seção "Infra — economia" ainda dizia "Fase 6 pendente"/"só falta o cutover" e a seção Pendências dizia "nenhuma pendência em aberto" sem citar o bug do `step=aieval` (500 intermitente, em aberto desde v0.69.15/16). Ambos corrigidos. `README.md` também corrigido (deploy já dispara em `vps` OU `main` desde v0.69.13, não só `vps`). Investigação do `aieval` retomada: reproduzido de novo (`refresh.yml` #134, já na `main`) com `hostname: "169.254.46.219"` (link-local) + `hasDatabaseUrl: false` no corpo do 500 — hipótese inicial de colisão de alias com um terceiro container foi **testada e descartada** com `docker ps -a`/`docker inspect` reais do VPS (só existe UM container com alias `app`, o `garimpo-app-1` de produção; `previewapp` tem alias próprio, sem colisão). Ou seja, a resposta com hostname link-local só pode ter vindo do próprio `garimpo-app-1` — mecanismo ainda não entendido (variáveis de `env_file` não deveriam variar entre boots do mesmo container). Notada uma correlação temporal com o deploy do v0.69.17 (não confirmada como causa — o próprio método de teste desta sessão garante proximidade com deploys, mesmo confundidor que o v0.69.16 já tinha descartado numa rodada anterior). Próximos passos (`docker inspect` no instante da falha, teste longe de qualquer deploy, `journalctl`/`dmesg`) e mitigação estrutural recomendada (health check ativo do Caddy contra `/api/health`, independente da causa raiz) registrados em Pendências |
| v0.69.19     | Só documentação: mais 2 reproduções do bug do `aieval`, confirmando de vez que não é corrida com deploy. `refresh.yml` #135 disparado via API (workflow_dispatch) 30min depois do último deploy, sem nada no meio — falhou igual (`hostname: "169.254.64.71"`). #136 disparado pelo `schedule` normal do GitHub (produção real, ninguém acionou manualmente) quase 1h depois do último deploy — falhou de novo (`hostname: "169.254.31.101"`). Calculando o boot inferido pelas 3 falhas (#134/#135/#136): ~18:20:19, ~18:51:14 e ~19:18:03 UTC — intervalos de 30min55s e 26min49s, faixa de 27–31min, não cravado em 30 exatos mas forte demais pra ser coincidência com 3 pontos independentes (2 deles sem deploy nem ação manual por perto). Hipótese líder agora: algo no HOST (cron/systemd timer/rotina de monitoramento, não este repo) reinicia/recria o `garimpo-app-1` nesse intervalo. Monitor de estado (`~/monitor-aieval.sh`) ligado na VPS desde antes da falha do #135, ainda não lido (sessão sem acesso à VPS no momento) |
| v0.69.20     | Só documentação: hipótese de restart/pressão de memória do v0.69.19 **descartada com prova direta** — monitor + `docker events` (cobrindo as janelas exatas, depois de corrigir um erro de fuso horário nosso: `docker events`/`journalctl` mostram hora LOCAL do servidor, não UTC) não mostram nenhum evento de `create`/`start`/`die` do `garimpo-app-1` nas duas falhas; `OOMKilled: false`, `RestartCount: 0`, `StartedAt` idêntico do início ao fim. `previewapp` também descartado com prova direta: `docker exec`+`curl` no seu IP interno sempre devolve "CRON_TOKEN não configurado" (503), nunca "Missing DATABASE_URL" — como `handleCron` checa `CRON_TOKEN` antes de tudo (`cron.server.ts:43-45`), o preview nunca chegaria a esse ponto. `garimpo-app-1` também descartado: hostname real ao vivo é um hash normal de container (nunca bate com os `169.254.x.x` das falhas), e 25 chamadas diretas ao seu IP interno — incluindo 5 simulando a carga real do `chunk` — tiveram 100% de sucesso. Conclusão: nenhum container conhecido explica a resposta observada; a suspeita migra do "qual container está de pé" pro **próprio Caddy ou o caminho de rede entre ele e o `app`** (TLS, keep-alive, resolução de DNS no momento exato), já que `chunk`/`enrich` nunca falham nesse mesmo caminho externo mas `aieval` falha às vezes. Próximo passo proposto (não implementado): header de resposta no Caddyfile expondo `{http.reverse_proxy.upstream.address}` pra provar, na próxima falha, pra qual IP o Caddy realmente mandou a requisição |
| v0.69.21     | Implementado o próximo passo do v0.69.20. Novo `src/lib/health.server.ts` (`handleHealth`, endpoint `/api/health`, sem token — só expõe booleans): confirma `DATABASE_URL`/`CRON_TOKEN` presentes e faz um `select 1` no Postgres antes de responder `{ok:true}`; registrado em `server.ts` como os demais handlers fora das server functions. `Caddyfile`: `reverse_proxy app:3000` ganha `health_uri /api/health` (`health_interval 10s`, `health_timeout 5s` — health check ATIVO do Caddy, evita rotear pra uma instância num estado ruim, qualquer que seja a causa do bug do `aieval`) e `header_down X-Debug-Upstream {http.reverse_proxy.upstream.address}` (diagnóstico temporário — expõe na resposta, sem precisar de log, pra qual IP:porta o Caddy realmente discou; remover depois que o caso for entendido). Validado localmente antes do push, por regra do `AGENTS.md`: `caddy validate` (sintaxe OK) e `caddy run` numa porta alternativa (subiu limpo, health checker e header confirmados no JSON adaptado — `dial tcp: lookup app` e o erro do ACME contra o Let's Encrypt são esperados fora do VPS/sem o container `app` de verdade). `tsc --noEmit`, `lint` e `build` verdes |
| v0.69.22     | **Fix de uma regressão real introduzida pelo v0.69.21, achada em produção na primeira rodada pós-deploy** (`refresh.yml` #137): a linha nova que imprimia o header (`upstream="$(grep ... \| tr -d '\r')"` seguida de `[ -n "$upstream" ] && echo ...`) quebrava sob o `set -euo pipefail` do script sempre que o header `X-Debug-Upstream` NÃO aparecia na resposta — `pipefail` faz o `grep` sem match (exit 1) contaminar o pipeline mesmo o `tr` seguinte tendo sucesso, e o `&&` com o lado esquerdo falso conta como comando falhando pro `set -e`. Resultado: a run #137 morreu com exit code 1 **sem imprimir nada do `aieval`**, mascarando completamente se o bug original ainda ocorre ou não — uma falha nova e diferente, não uma reprodução. Corrigido com `\|\| true` no `grep` e trocando o `&&` solto por um `if` de verdade (condição de `if` nunca aciona `set -e`). Os três cenários (header presente, ausente, arquivo inexistente) testados isoladamente em bash local antes do push — todos sobrevivem agora. **Lição:** `set -e`/`pipefail` em scripts de CI é uma armadilha clássica pra qualquer `grep`/`test` que pode legitimamente "falhar" sem ser um erro — sempre isolar com `\|\| true` ou `if`, nunca `&&`/`\|\|` soltos como o comando final de uma linha |
| v0.69.23     | **Achada a razão real de o header `X-Debug-Upstream` nunca aparecer**: com o fix do v0.69.22 no ar, a run #138 reproduziu o bug original de novo (`hostname: "169.254.67.35"`, `hasDatabaseUrl: false`) e o script não morreu mais — mas o header continuou ausente. Causa: `docker compose up -d` **não recria/reinicia um serviço só porque o CONTEÚDO de um arquivo montado via bind mount mudou** (o `Caddyfile` é montado assim) — o Compose decide recriar comparando a definição do serviço no compose file, não o conteúdo dos volumes. Mesma classe de bug já documentada neste projeto (v0.69.5/v0.69.8: mudança no `.env` precisou de `--force-recreate` na mão). Ou seja, **desde o v0.69.21 o Caddy nunca chegou a carregar o Caddyfile novo** — o `health_uri`/`header_down` ficaram só no arquivo em disco, nunca ativos de verdade. Corrigido em `deploy.yml`: depois do `docker compose up -d --remove-orphans`, novo `docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` — recarrega a config em tempo real (zero downtime, não derruba conexão nenhuma), garantindo que todo deploy realmente aplica o Caddyfile atualizado, não só copia pro disco. **Lição pro futuro**: qualquer mudança de Caddyfile só se torna efetiva de verdade em produção com esse `reload` — sem ele, o arquivo no VPS muda mas o processo do Caddy continua rodando a config antiga até um restart manual ou uma recriação de container por outro motivo (troca de imagem, `.env`, etc.) |
| v0.69.24     | **Mistério não resolvido, registrado pra continuidade**: com o `caddy reload` do v0.69.23 confirmado rodando sem erro no log do deploy (`"using config from file"` + `"adapted config to JSON"`, exit 0 — `garimpo-caddy-1` nem chegou a ser recriado nesse deploy, `garimpo-app-1`/`garimpo-backup-1` sim, porque a tag da imagem muda a cada deploy), a run `#139` do `refresh.yml` reproduziu o bug de novo (`hostname: "169.254.73.67"`) e **o header `X-Debug-Upstream` continuou ausente**. Ou seja: o `reload` roda sem erro, mas ou (a) não está de fato aplicando a config nova no processo do Caddy, ou (b) a config está aplicada mas por algum motivo o `header_down` não é adicionado nessa resposta específica de falha — nenhuma das duas hipóteses tem explicação óbvia (não é comportamento documentado do Caddy pular `header_down` em respostas de erro do upstream). Tentativa de checar direto do domínio público bloqueada pelo proxy de saída deste ambiente (403). **Próximo passo, só possível com acesso à VPS**: checar a config AO VIVO do Caddy via API admin (não o que está no disco) — `docker exec garimpo-caddy-1 wget -qO- http://localhost:2019/config/ | grep -o "X-Debug-Upstream"`. Se não aparecer: o reload não está realmente aplicando (investigar por quê — talvez a API admin não esteja no endereço padrão, ou precise de `--address`). Se aparecer: o mistério é mais fundo, no comportamento do `header_down` sob falha, e vale tentar a alternativa de log de acesso completo (`log { output file ... }`) em vez de header |
| v0.69.25     | **Confirmado que o `caddy reload` FUNCIONA de verdade** (log do próprio Caddy mostra `"admin.api","msg":"received request","uri":"/load"` seguido de `"load complete"` a cada deploy) — a suspeita (a) do v0.69.24 (reload não aplicando) cai. **Achado real, mas que acabou sendo outro confundidor, não o mistério do `aieval`**: o log do Caddy mostra dois eventos genuínos de `"dial tcp 172.19.0.5:3000: connect: connection refused"` — mas ao cruzar os timestamps com os eventos de rede (`sbJoin`) do `garimpo-app-1` no `journalctl`, **os 4 "recreate" do container hoje batem EXATAMENTE com os 4 deploys desta sessão** (PRs #192–195, um por merge — a tag `APP_IMAGE:${{ github.sha }}` muda a cada deploy, então `garimpo-app-1` é recriado em TODO deploy, sempre). Os dois "connection refused" são só o gap normal de alguns ms trocando de container durante um recreate — nada misterioso, e o `RestartCount` nunca passou de 0 porque cada recreate é um container NOVO (reseta a contagem), não um crash-loop do mesmo container. **Isso reabre uma dúvida importante sobre os testes de HOJE** (`#137`/`#138`/`#139`): como fiz 4 deploys em ~40min nesta sessão, todo teste de hoje caiu perto demais de algum deploy meu — o mesmo confundidor que a run `#136` de ONTEM (genuinamente ~56min longe de qualquer deploy) já tinha descartado. A teoria de "periodicidade ~27–31min" do v0.69.19 foi construída em cima de `#134`/`#135`/`#136` de ontem — **essas continuam válidas** (135 e 136 confirmados sem deploy por perto na hora), mas não deve ganhar mais pontos de dado a partir dos testes de hoje, que estão contaminados. **Decisão**: parar de disparar deploys por um tempo (mínimo ~30-40min sem nenhum push/deploy) antes do próximo teste, pra finalmente conseguir uma reprodução limpa com o header/health-check já confirmadamente ativos |
| v0.69.26     | **A janela limpa apareceu de graça**: o `schedule` normal do GitHub disparou a run `#140` às 08:30 UTC, **5 horas depois do último deploy** (bem mais que os 30-40min planejados) — reproduziu o bug de novo (`hostname: "169.254.51.151"`) e **o header `X-Debug-Upstream` continuou ausente**, mesmo com o reload confirmado ativo há 5h. Isso praticamente descarta de vez a suspeita (a) do v0.69.24/25 (reload não aplicado) — não sobra tempo suficiente pra explicar 5h de config "desatualizada". **Testado localmente e CONFIRMADO que `header_down` funciona normal**: Caddy real + backend fake devolvendo o corpo JSON idêntico ao bug (500 "Missing DATABASE_URL...") → o header aparece certinho na resposta E no log de acesso. Ou seja: **a suspeita (b) também cai** — não é um problema do Caddy pular `header_down` em erros. Testado também que `curl -D` + `--retry` (exatamente como o `refresh.yml` usa, sem `--retry-all-errors`) captura o header corretamente em todas as 4 tentativas contra um servidor de teste local. **Conclusão desta rodada**: com as duas hipóteses de Caddy descartadas por teste direto, a suspeita migra pra fora do Caddy inteiramente — a requisição que falha pode não estar nem chegando nesse Caddy/site block. Implementado `curl -v` na chamada do `aieval` (`refresh.yml`), capturando o handshake de rede real (IP conectado, certificado TLS servido) — testado localmente sob `set -euo pipefail` (sobrevive, mesmo padrão de proteção do v0.69.22). Isso deve mostrar, na próxima falha, se o GitHub Actions está de fato conectando no IP certo do VPS com o certificado certo, ou se há algo de DNS/roteamento do lado de fora que nem chega a ser problema do Caddy |
| v0.69.27     | **🎯 CAUSA RAIZ ENCONTRADA — fecha a investigação do bug do `aieval` aberta desde v0.69.15.** A run `#141` reproduziu a falha de novo e o `curl -v` (v0.69.26) revelou tudo na primeira tentativa: `Connected to leilao-finder-buddy.vercel.app (64.29.17.195) port 443`, `subject: CN=*.vercel.app`. **O secret `APP_URL` do GitHub Actions nunca foi atualizado pro domínio do VPS no cutover da Fase 6** — continua apontando pra Vercel. Isso explica cada peça do mistério de uma vez: hostname link-local (`169.254.x.x`) é o padrão normal de runtime serverless da AWS Lambda por trás do Vercel; `hasDatabaseUrl: false` porque `DATABASE_URL` é uma env exclusiva do VPS, nunca cadastrada no painel da Vercel; o corpo do erro bate exatamente com o código atual porque **a Vercel nunca parou de fazer auto-deploy deste repo** (confirmado pelos comentários do bot `vercel[bot]` aparecendo em TODOS os PRs desta sessão, #192–197) — a Vercel está rodando o código mais recente, só que com o ambiente antigo (sem `DATABASE_URL`). O checklist de progresso do cutover (`docs/economia-fase-2-vps-unico.md`, item 12) foi marcado `[x]` dizendo "cron reabilitado e validado com dados reais" — mas isso validou o cron rodando MANUALMENTE contra o VPS na época; **o secret `APP_URL` em si, usado pelo `refresh.yml` de verdade, nunca foi trocado**. Ou seja: possivelmente NENHUMA chamada do cron 2×/dia desde o cutover (v0.69.13) chegou de fato no VPS — tudo foi pra Vercel, que ainda tem `SUPABASE_*`/Postgres antigo configurado o suficiente pra `chunk`/`enrich` (scraping + persistência) parecerem funcionar normalmente na maior parte do tempo, mas falha especificamente onde o código exige `DATABASE_URL` sem fallback (só a partir do `client.server.ts` pós-v0.64.0). **Ação necessária, só o usuário pode fazer** (secret do GitHub, fora do alcance de qualquer sessão): trocar o secret `APP_URL` em Settings → Secrets and variables → Actions pra `https://143-95-214-240.sslip.io` (o `APP_DOMAIN` real do VPS). Recomendado também, depois de confirmar que o cron passa a bater no VPS: desligar de vez o auto-deploy da Vercel pra este repo (Vercel → Project Settings → Git → desconectar), já que ele não serve mais nenhum propósito e só criou essa armadilha — e reforçar no checklist de cutover que "cron validado" precisa checar o secret em si, não só um teste manual |
| v0.69.28     | **Achado mais fundo do bug de perda de lotes**: `persistLots` (`leiloesbr-scrape.server.ts`) fazia `await supabaseAdmin.from("lots").upsert(...)` sem checar `{ error }` — o shim `db-query.server.ts` tem contrato de NUNCA lançar (erro do Postgres vira `{ data: null, error }` resolvido, igual PostgREST), então o `try/catch` ao redor da chamada nunca disparava e `scrapeVinylChunk`/`enrichMissingLotes` reportavam sucesso mesmo quando nada foi gravado (ex.: rodando contra ambiente sem `DATABASE_URL`, caso do v0.69.27). Diferente do `aieval` (que sempre checa `error` e relança, por isso é o único que estourava 500), `chunk`/`enrich` mascaravam a falha por trás de um HTTP 200 com `scraped`/`updated` contando o que foi RASPADO do site, não o que foi GRAVADO no banco — cron rodando 2×/dia desde o cutover da Fase 6 sem persistir um lote sequer, sem nenhum log. Corrigido: `persistLots` checa `error` e relança (try/catch morto removido); `scrapeVinylChunk`/`enrichMissingLotes` devolvem `persisted: boolean`; `refresh.yml` aborta a run (+ ping de falha no healthchecks.io) em `persisted:false` em vez de seguir o laço até o fim. Não troca o secret `APP_URL` (v0.69.27, ainda pendente só o usuário) — só torna a perda visível em vez de silenciosa a partir de agora |
| v0.69.29     | **Segundo secret divergente encontrado em paralelo, mesma classe do `APP_URL`**: com `APP_URL` corrigido, a run `#143` do `refresh.yml` chegou a bater no VPS de verdade mas voltou **401 Unauthorized** logo no primeiro step (`chunk`) — como `handleCron` (`cron.server.ts`) checa o `CRON_TOKEN` antes de qualquer outra coisa, um 401 ali só podia ser mismatch entre o secret `CRON_TOKEN` do GitHub Actions e o `CRON_TOKEN` do `.env` do VPS, também nunca sincronizado no cutover. Usuário igualou os dois; a run `#144` completou TODOS os steps do cron com sucesso ponta a ponta contra o VPS real (chunk, enrich, aieval, aiident, market, condition, sales, reident, purchases, prune), com o `aieval` mostrando `conn-info` direto pro domínio do VPS — confirmação final e independente de que o bug do `aieval` (v0.69.27) estava mesmo resolvido |
| v0.69.30     | **Confirmado em produção que o `APP_URL` já tinha sido trocado pelo usuário** (runs `#151`/`#152` do `refresh.yml`, 2026-09-21: todos os steps verdes, `chunk`/`enrich` com `persisted:true`, `aieval` conectando direto no domínio do VPS). Ao validar os números pós-fix, o usuário achou um bug DIFERENTE e mais antigo (não causado pela migração — código já existia em 10/09, bem antes da Fase 1): a varredura geral (`scrapePages`/`scrapeVinylChunk`) parava de escanear páginas assim que achava uma cujo dia mínimo já tinha passado da janela, assumindo ordenação estritamente monotônica por data — mas a listagem intercala leilões, então isso deixava dias inteiros de fora sem nenhum log (dia 24/9 com 0 lotes cercado de dias com centenas; casa Abreu Colecionismo com só 125 dos 198 lotes reais do dia 22, confirmados no catálogo dela e por casas com histórico normal na base como RT Leilões e Artes). Reproduzido de forma determinística: duas rodadas completas do cron pararam exatamente no mesmo intervalo de páginas. Corrigido: removido o corte antecipado por `minDay` em `scrapePages`/`scrapeVinylChunk` — a varredura agora sempre vai até `MAX_PAGES`/`page=1`, só o filtro por `dayKey` item a item decide o que entra na janela |
| v0.69.31     | Validado em produção que o fix de paginação (v0.69.30) funcionou (run `#153`: sequência de páginas `93→78→63→48→33→18→3→null`, cobrindo o intervalo antes pulado). Mesmo assim o usuário reportou um lote específico do dia 24/9 ainda ausente (casa "Coisa Antiga Leilões", idLeilao 65152) — caso NOVO, de natureza diferente do bug de paginação já corrigido. Sem acesso de rede aos sites de leilão nem ao banco de produção no ambiente de dev, criada ferramenta de diagnóstico pra decidir se é categorização da própria LeilõesBR (fora do nosso controle) ou um filtro nosso descartando por engano: `findLotDebug` (`leiloesbr-scrape.server.ts`) + `step=findlot&q=<idLeilao ou casa>` (`cron.server.ts`) varre toda a listagem geral (mesma categoria, sem filtro de dia/`looksNonVinyl`) e reporta cada ocorrência encontrada; novo workflow `debug-cron.yml` (`workflow_dispatch`, input `querystring`) chama qualquer step de diagnóstico do `/api/cron` avulso, sem rodar a cadeia pesada do `refresh.yml`. Investigação em andamento — ver Pendências |
| v0.69.32     | `step=findlot&q=65152` rodado em produção: varreu as 93 páginas da categoria "Disco de Vinil" da LeilõesBR de ponta a ponta e não achou NENHUMA ocorrência do leilão 65152 — descarta bug nosso (paginação/filtro/parse) pra esse caso específico. Usuário então trouxe achado novo: no catálogo PRÓPRIO da casa "Coisa Antiga Leilões", o leilão 65152 tem 401 itens, 319 categorizados como "Disco de vinil" pelo filtro do site DELA — ou seja, a categorização interna da casa não está batendo com a tag `tp=` que a nossa busca geral usa (ou não chega na LeilõesBR). Adicionado `findLotSearch`/`step=findlot2&idLeilao=<...>&pesquisa=<termo>&lockToVinyl=0\|1` (`leiloesbr-scrape.server.ts`/`cron.server.ts`): busca por texto livre (filtrado no servidor, mantém o total de páginas viável) e opcionalmente SEM travar a categoria, pra achar o mesmo idLeilao em qualquer categoria da LeilõesBR. Investigação em andamento — ver Pendências |
| v0.69.33     | **Fechamento do bug do `aieval` (v0.69.27/29) e limpeza pós-migração**: removida TODA a instrumentação temporária de diagnóstico usada pra caçar o bug (header `X-Debug-Upstream` no `Caddyfile`, `curl -v`/`-D` no `aieval`/`prune` do `refresh.yml` — ambos voltam a usar `call()` padrão) e TODAS as referências ativas à Vercel do código/docs (pedido do usuário assim que a correção foi confirmada em produção): `vercel.json` removido, `.vercel` tirado de `.gitignore`/`.dockerignore`, comentários em `vite.config.ts`/`discogs.server.ts`/`leiloesbr-scrape.server.ts`/`lot-ai.server.ts`/`lot-ident.server.ts`/`lot-sales.server.ts` reescritos sem menção à Vercel, `CLAUDE.md` atualizado (cutover já concluído, não "falta a Fase 6"), `.env.example` corrigido (chaves de IA/Discogs são lidas do `.env` do VPS, não mais "Environment Variables da Vercel"). Mantido só o registro histórico da migração (`economia-fase-2-vps-unico.md`/`economia-migracao.md`/`README.md`) — não é instrução ativa, é o porquê da arquitetura atual. Usuário confirmou nesta janela que também já removeu o auto-deploy da Vercel pro repo e a Authorized redirect URI antiga (Google Cloud Console) — ambas ações fora do alcance de qualquer sessão |
| v0.69.34     | `step=findlot2&idLeilao=65152&pesquisa=Ray Charles&lockToVinyl=0` rodado em produção: achou o item de primeira (1 página, texto filtrado no servidor) — leilão 65152 está saudável na listagem geral (dayKey correto, passaria no filtro de vinil), só não está marcado com `tp="Disco de Vinil"`. Confirma categorização de fora, fora do nosso scraper. Usuário trouxe pista nova: no catálogo da casa, o filtro "Disco de vinil" grava `tipo=\|129\|` (código numérico local), diferente do `tp=` hex da LeilõesBR — podem ser esquemas de categoria diferentes. Adicionado `findLotByCategory`/`step=findlotcat&idLeilao=<...>&tp=<...>&pesquisa=<termo>` (testa qualquer `tp=` cru direto na busca geral) e `findLotRawCard`/`step=findlotraw` (HTML bruto do card, pra quando os campos já extraídos não bastarem). Investigação em andamento — ver Pendências |
| v0.69.35     | `step=findlotcat&tp=\|129\|` confirmado: código numérico da casa não é reconhecido pela busca geral da LeilõesBR. Usuário achou a saída: a página `busca_andamento.asp?tp=<vinil>` mostra uma seção "GALERIAS" (casas com código `ga=<n>` que filtra só aquela casa) — plano aprovado pra usar isso como mecanismo de DESCOBERTA. Achado central da pesquisa: `fetchCatalogData(domain, idLeilao)` (`leiloesbr-catalog.server.ts`, já existente) já busca o catálogo INTEIRO de um leilão conhecido tentando `Tipo=129` (o mesmo código da casa) e caindo pro catálogo completo se vier vazio — ou seja, o problema é só descobrir o `idLeilao`, não buscar os lotes dele. Fase 1 (diagnóstico, ainda não validada em produção): `listGalleries`/`step=galleries[&tp=<...>\|tp=none]` (tenta extrair a seção GALERIAS, sempre devolve `rawSnippet` do HTML bruto pra ajustar o parser) e `step=catalogdebug&domain=<...>&idLeilao=<...>` (chama `fetchCatalogData` direto, isola descoberta de extração). Investigação em andamento — ver Pendências |
| v0.69.36     | `step=galleries` rodado em produção contra v0.69.35: `galleries: []` (parser regex não achou nada), mas o `rawSnippet` confirmou a estrutura real do HTML — `<ul id="comboGalerias">` com um `<li>` por galeria, checkbox (`value="<código>"`) e `<label>` (nome) em `<div>`s irmãos, não aninhados; o regex antigo só olhava o texto logo após o `<input>` e sempre batia em espaço em branco entre tags. `listGalleries` reescrita pra usar `node-html-parser` (`querySelectorAll`/`querySelector`, mesmo parser de `parseCard`/`parseCards`) — `#comboGalerias li` com fallback pra `.lista-subcats-item`, extrai `input[value]` + `label` por item. `rawSnippet` aumentado pra 8000 chars. Ainda não validado em produção — ver Pendências |
| v0.69.37     | `step=galleries` revalidado em produção: parser DOM funcionou, 68 galerias extraídas, "Coisa Antiga Leilões" achada (`ga=356`). Implementada a Fase 2 (enumeração por galeria): descoberto que `fetchCatalogData` não serve pra criar `VinylLot`s novos (sem `image`/`price`/`dayKey`/`artist` — só enriquece lotes já existentes); abordagem adotada reaproveita `fetchPageSearch`/`parseCards` (mesma função da listagem geral) paginando por `ga=<código>` em vez de `tp=<categoria>`, filtrando por título (`looksNonVinyl`) em vez de tag da plataforma. Adicionado `listGalleryAuctions(galleryCode)`, `scanGalleries(offset, count, tp?)`/`step=galleryscan` (chunked como `chunk`/`enrich`) em `leiloesbr-scrape.server.ts`/`cron.server.ts`. Ainda não testado em produção — ver Pendências |
| v0.69.38     | Fix: link "site da casa" ia pro link genérico da casa na LeilõesBR (scrapado da listagem geral), não pro catálogo do leilão específico do grupo — novo `catalogUrlFromLot({idLeilao, url})` (`vinyl-parse.ts`, mesma extração de `presencialUrlFromLot`) monta `<domínio>/catalogo.asp?Num=<idLeilao>`; `houseAuctionInfo` (`grouping.ts`) passa a expor `catalogUrl`. Aplicado nos 4 lugares que renderizam "site da casa": lista principal por dia e Vigiados do dia (`index.tsx`, via `auctionInfo.catalogUrl`), Análise por dia (`analise.tsx`, direto de `group.lots[0]`) e Lances por casa (`bid-house-sections.tsx`, direto de `houseGroup.lots[0]`) — todos com fallback pro `houseUrl` antigo quando o lote não casa o padrão LeilõesBR |
| v0.69.39     | Fix: clicar em "Vigiar" confirmava a vigia no LeilõesBR (toast de sucesso) mas o card voltava a mostrar "Vigiar" pouco depois, mesmo a casa já mostrando o lote como vigiado — causa era o `void queryClient.invalidateQueries({queryKey: watchedQuery.queryKey})` disparado logo após o `toggle.onSuccess` (`index.tsx`): a página de conta do LeilõesBR (`conta_site.asp?l=8`) demora a refletir o toggle que acabou de ser confirmado por `vigiar_peca.asp`, então o refetch imediato trazia a lista "atrasada" (sem o lote recém-vigiado) e o `mergeWatchedAccum` (`watched-accum.ts`) apagava a entrada otimista que tínhamos acabado de gravar (regra "sumiu do fresh + leilão não terminado = vigia removida de fato"); o mesmo problema existia na direção contrária (desvigiar reaparecendo). Removido o invalidate logo após o toggle — o estado gravado ali já é autoritativo (veio da resposta do próprio endpoint de toggle, com retry até confirmar); a reconciliação com a conta acontece no próximo refetch natural (`staleTime`/refresh manual), quando o LeilõesBR já tiver atualizado |
| v0.69.40     | `step=galleryscan` testado isolado em produção contra "Coisa Antiga Leilões" (`ga=356`, índice 14): achou 323 lotes (bate com os ~319 marcados vinil no catálogo da casa), `persisted:true`; `findlot2` confirma o leilão 65152 saudável. Descoberta por galeria validada fim a fim — integrada ao `refresh.yml` (nova seção `step=galleryscan`, chunked `offset`/`count=3`, entre "Varredura em blocos" e "Preenchimento de nº de lote"), passa a rodar 2x/dia. Investigação considerada resolvida — ver Pendências |
| v0.69.41     | Cron 2x/dia → **3x/dia, de 8 em 8h** (`refresh.yml`, `10 3,17 * * *` → `10 3,11,19 * * *`, BRT 00:10/08:10/16:10) — achado do usuário: leilão 64791 (Robson Gini/Trem das 7) com dia 1 (21/9) publicado tarde demais pra o cron 2x/dia pegar antes do pregão ficar "ao vivo" (a listagem geral da LeilõesBR para de listar os lotes de um leilão assim que ele entra ao vivo — `findlot` confirmou os lotes do dia 2 presentes mas nenhum do dia 1). Não é remoção do nosso lado (upsert nunca apaga o que já foi capturado) — é gap de DESCOBERTA: se o cron não escaneou antes do horário do pregão, o lote nunca chega a entrar no banco. Janela menor entre execuções reduz a chance de perder catálogos publicados perto da hora do pregão |
| v0.69.42     | Fix: bloco "Acontecendo agora" (`live-auctions.tsx`) agora começa **fechado** (colapsado), com botão pra abrir/fechar (chevron) — antes ficava sempre expandido ocupando espaço mesmo sem o usuário estar olhando pro pregão. Fix: `NON_MEDIA_COLLECTIBLE_RE` (`vinyl-parse.ts`, usada por `looksNonVinyl`) ganhou termos de joalheria (anel/anéis, joia, bijuteria, pulseira, colar, brinco, pingente, corrente de ouro/prata, relógio de pulso, aliança) — achado do usuário: casas que vendem "de tudo" listam anéis/joias na mesma categoria "Disco de vinil" do site e eles passavam pelo filtro por não baterem em nenhum formato de mídia bloqueado (mesma classe de problema do ex-libris/numismática/perfumaria já filtrados) |
| v0.69.43     | Fix mais profundo do mesmo sintoma: usuário mostrou um leilão da "Alberto Lopes - Leiloeiro Público" (`ga=199`, "LEILÃO ANTIGUIDADES RJ") **sem NENHUMA categoria de disco** no catálogo da própria casa (só Diversos/Fotografia/Joias/Porcelana/Relógio) que mesmo assim aparecia no app — causa raiz não era só faltar termo na lista de bloqueio: `listGalleryAuctions` (`step=galleryscan`, v0.69.37) usa `ga=<código>` **sem travar `tp=` de categoria** (ao contrário da varredura geral, que trava "Disco de Vinil" e por isso pode usar `looksNonVinyl`, uma lista de BLOQUEIO permissiva por padrão). Sem a garantia de categoria, qualquer item cujo título não batesse em nenhum termo ruim conhecido (ex.: miniatura de carrinho de coleção) entrava como se fosse vinil. Trocado o filtro de `listGalleryAuctions` de `looksNonVinyl` para `isVinylTitle` (função já existente, não usada até então — exige palavra de vinil no título) só nesse caminho; a varredura geral (`scrapeVinylChunk`, categoria travada) continua com `looksNonVinyl`. Trade-off consciente: casas dedicadas a vinil com títulos "Artista - Álbum" sem a palavra "vinil"/"LP" podem perder cobertura *só* via `galleryscan` — mas essas mesmas casas já são cobertas pela varredura geral (categoria tagueada corretamente na plataforma), então `galleryscan` é reforço, não fonte única |
| v0.69.44     | Pedido do usuário: manter (e ampliar) a lista de bloqueio de `NON_MEDIA_COLLECTIBLE_RE` (`vinyl-parse.ts`) além do que já tinha — acrescentados livro/revista, quadro/pintura, lata, brinquedo/miniatura/carrinho (colecionáveis de brinquedo), boneco/boneca. Continua sendo o mecanismo de defesa em profundidade da varredura geral (`scrapeVinylChunk`, categoria `tp=` travada) — protegido pelo guard `mentionsVinyl`/`mentionsDisc` em `looksNonVinyl`/`isVinylTitle`: um lote que de fato menciona "vinil"/"LP"/"disco"/"compacto" nunca é descartado só por também citar um desses termos (ex.: "capa com lata pintada" numa descrição de LP genuíno) |
| v0.69.45     | Pedido do usuário: **limpeza retroativa** dos itens que já tinham entrado no banco antes dos fixes de v0.69.42–44 — `lots` só recebe upsert (merge durável, nunca apaga sozinho), então um fix de filtro não remove o que já tinha sido capturado. Novo `pruneNonVinylLots(dryRun, limit)` (`leiloesbr-scrape.server.ts`): relê a janela atual (`WINDOW_DAYS`), reaplica `looksNonVinyl` no título (mesmo critério da varredura) e apaga em lotes de 200 (`DELETE ... WHERE id = ANY(...)`) os que não deveriam ter entrado — `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` somem junto por `ON DELETE CASCADE`; `lot_sales` (histórico de vendas) nunca é tocado. Exposto via `GET /api/cron?step=cleannonvinyl` (protegido por `CRON_TOKEN`, como os demais steps) — **`dryRun` por padrão** (só lista o que seria removido, sem apagar nada); `&apply=1` apaga de fato. Uso manual único (não entra no `refresh.yml`) — rodar `dryRun` primeiro, conferir a amostra de títulos devolvida, só então `apply=1` |
| v0.70.0      | Pedido do usuário: a Coleção deixa de varrer "Minhas compras" sozinha — removidos os botões "Atualizar coleção"/"Varredura completa" e toda a pipeline de importação direta (`importWonLots(Incremental)`, `parsePurchaseTitle`, `deriveCandidate`, fila de duplicados) de `collection.server.ts`/`colecao.tsx`. Em troca, `/compras` (que já varre "Minhas compras" para a própria tabela `purchases`) ganha: **(1)** um selo de relação com a Coleção por card (`Disc3`, `compras.tsx`), casando pelo `lot_id` exato e reaproveitando a mesma infra de vínculo manual/aprendizado da home (`collection_links`/`collection_feedback`, `resolveOwned`/`OwnedPanel`) — permite confirmar, vincular a outro disco já cadastrado, marcar "não tenho" ou reativar o automático; **(2)** botão **"Enviar para a coleção"** (só sem relação confirmada) que abre um diálogo de edição pré-preenchido (palpite de artista via `extractArtist`/`titleCase`) e cria o item via `addCollectionItem` com `lotId`, herdando valor pago/data/casa/UF/imagem da compra. `GradeSelect` extraído para `components/vinyl/grade-select.tsx` (reusado pelos dois diálogos) |
| v0.71.0      | Pedido do usuário: botão **"Identificar pela IA"** no diálogo "Enviar para a coleção" (`/compras`) — antes de confirmar o envio, preenche artista/álbum/ano/descritivo/tags a partir só do título da compra. Nova `identifyDraftFromTitle` (`collection.server.ts`) reusa o mesmo prompt/modelo de `reidentifyCollectionItem` (`identCollectionSync`, só texto, nunca a capa) com um `id` avulso ("draft"), já que o disco ainda não existe em `collection_items`; não persiste nada, só devolve o resultado para o formulário. Exposta via `identifyPurchaseDraft` (`collection.functions.ts`), usando sempre o provedor de IA padrão do `app_state` (mesmo aviso de failover das outras telas) |
| v0.71.1      | Continuação de v0.69.42–45: usuário rodou `step=cleannonvinyl&apply=1` em produção ("o processo retirou muitos itens mas ainda temos muitos outros") e achou mais um caso — "Antiga salva sobre 3 pés, produzida em metal espessurado à prata..." (bandeja/salva de prata antiga), de novo da "Alberto Lopes - Leiloeiro Público" (mesma casa generalista do achado de v0.69.43). `NON_MEDIA_COLLECTIBLE_RE` (`vinyl-parse.ts`) ganha termos de prataria/utensílios antigos: salva, bandeja, prataria, baixela, castiçal, talheres, molheira, centro de mesa. Reforça a suspeita de que essa casa específica marca itens fora de disco na própria categoria "Disco de Vinil" da LeilõesBR (não só via `galleryscan`, já corrigido em v0.69.43) — se o padrão persistir após mais uma rodada de `cleannonvinyl`, considerar excluir a casa da varredura em vez de só ampliar a lista de termos (ver Pendências) |
| v0.71.2      | Fix: a caixa de busca da home (`index.tsx`) já só filtrava a lista no Enter/clique em "Pesquisar" (estado `search` separado do rascunho digitado), mas o rascunho vivia como `useState` dentro do próprio `RouteComponent` — um componente de ~2500 linhas com dezenas de listas/cálculos — então cada tecla digitada re-renderizava a árvore inteira e travava a digitação mesmo sem filtrar em tempo real. Extraído `LotSearchBox`, componente próprio que guarda o rascunho em estado local e só chama `onSearch`/`onClear` (que tocam `search` no pai) ao confirmar; digitar agora só re-renderiza essa caixa pequena |
| v0.71.3      | Mais uma rodada do mesmo padrão (v0.69.42–v0.71.1): usuário mostrou 6 lotes de documentos/livros históricos ("Brochura autografada", "OPÚSCULO / Monumento...", "Prova de Fogo", "Cap Recona"...) e apontou que vários não têm NENHUM termo bloqueável no título (sem "livro"/"joia"/etc., só o texto da capa/folheto). `NON_MEDIA_COLLECTIBLE_RE` (`vinyl-parse.ts`) ganha termos de documentos/impressos históricos: rascunho, bilhete, manuscrito, carta, brochura, página, escrita, opúsculo, folheto, panfleto (lista dada pelo usuário). Título como "INTEGRALISMO Antônio Pompeo com dedicatória" continua passando — não tem termo seguro pra bloquear ("dedicatória" sozinha é arriscada: aparece também em LP autografado genuíno) — reforça a nota já registrada em Pendências: lista de termos está batendo o teto de escala pra essa casa, próximo passo é exclusão por casa, não por termo |
| v0.72.0      | Pedido do usuário: excluir um lote manualmente (nunca mais volta, mesmo em varreduras futuras) e o sistema aprender com a exclusão para sinalizar "possível lixo" em lotes parecidos (sem esconder sozinho). Nova tabela `excluded_lots` (DELETE físico em `lots`, cascade limpa `lot_ai`/`lot_ident`/`lot_market`/`lot_condition`); heurística por palavras-chave do título sem IA (`lot-exclusion.ts`); filtro em `persistLots` bloqueia reinserção pelo cron; badge "possível lixo" calculado no cliente, não persistido. Botão de excluir só nas listagens de descoberta (busca e "por casa → artista"), não em Vigiados/Lances. Corrigida de passagem a convenção desatualizada de aplicar `setup.sql` ("SQL Editor", resquício do Supabase hospedado) — `deploy.yml` agora reaplica o schema sozinho a cada deploy. Ver seção "Exclusão de lotes" |
| v0.72.1      | Fix P0: o v0.72.0 fez `deploy.yml` reaplicar `setup.sql` contra o Postgres já rodando em produção, e isso quebrou o deploy — `service_role` (papel do Postgres do Supabase, nunca existiu de verdade neste Postgres self-hosted) travava o script inteiro no meio (`ON_ERROR_STOP=1`), ANTES de chegar em `excluded_lots`, então a tabela nunca foi criada e a exclusão de lote falhava em produção ("relation \"excluded_lots\" does not exist"). `setup.sql` ganha um bloco `CREATE ROLE IF NOT EXISTS` (idempotente) para `anon`/`authenticated`/`service_role` antes do primeiro uso; a conexão real do app ignora RLS por ser dona das tabelas, então isso só existe para as linhas de RLS não falharem. De quebra, removida a linha morta `INSERT INTO storage.buckets` (Storage do Supabase não existe mais — fotos da Coleção são arquivo em disco desde a Fase 5, ver "Fotos da Coleção") — que ia quebrar a mesma execução um pouco mais adiante. Validado rodando `setup.sql` 3x seguidas contra um Postgres 17 local (fresh + 2 reruns), todas saída 0 |
| v0.72.2      | Fix: busca por relevância (`searchRelevance`, `vinyl-parse.ts`) casava substring SOLTA dentro de outra palavra — usuário achou (buscando "rita") lotes sem nenhuma relação, ex. um LP do Airton Lima Barbosa cuja descrição só cita "dedicatória **manus­crita**" (contém "rita" grudado). Confirmado por eliminação: sem IA associada ao lote (sem `aiLabel` no card) e usuário confirmou ter vindo da caixa de busca, não do filtro por artista — descartando erro de identificação da IA. Todos os `hay.includes(needle)` (identidade e campos fracos, camadas 2–4) e o `startsWith` (camada 5) passaram a exigir borda de PALAVRA INTEIRA (haystack e agulha com espaço nas pontas) — "manuscrita"/"margarita"/"sanscrita" não batem mais em "rita", mas frases/termos legítimos continuam batendo igual |
| v0.73.0      | Pedido do usuário: clicar no badge "possível lixo" remove o aviso e ENSINA o modelo que aqueles termos não indicam lixo ("adaptando e melhorando o modelo"). Nova chave `app_state.trash_keyword_denylist` (array simples, só cresce); `matchPossibleTrash` (`lot-exclusion.ts`) ganha parâmetro `denylist` filtrado dos dois lados do casamento — o termo negado deixa de gerar falso positivo em QUALQUER lote futuro, não só no clicado. Badge vira botão clicável ("✕") com atualização otimista via `dismissTrashMutation`. Ver seção "Exclusão de lotes" |
| v0.73.1      | Merge de v0.72.2 (fix de busca por palavra inteira) sobre a base já em v0.73.0 (badge "possível lixo" clicável) — sem conflito de lógica, só de versão/changelog |
| v0.73.2      | Fix P0: deploy quebrando de novo desde o v0.72.1 (que corrigiu `service_role`) — dessa vez no bloco de FKs `ON DELETE CASCADE` (v0.67.0, "FKs de limpeza"): `ADD CONSTRAINT lot_ai_id_fkey` (e as três irmãs) travava com violação de FK, porque produção tinha órfãos de antes da Fase 5 que a limpeza da migração `20260917120000_orphans_fk_cascade.sql` nunca rodou contra esse banco (schema veio de `pg_restore`, e só `setup.sql` é reaplicado automaticamente — migrações avulsas não são). `setup.sql` ganha os mesmos 4 `DELETE ... WHERE NOT EXISTS` da migração original antes do `ADD CONSTRAINT`, tornando o bloco idempotente mesmo com órfãos acumulados |
| v0.73.3      | Fix: "Atual"/"Próximo" desatualizados ou ausentes nos cards de vigiados/lances — `leiloesbr-lot-details.server.ts` passa a ler também `VALOR_VALUE` (valor atual AO VIVO) do `peca.asp`, não só `NOVO_VALOR`; `index.tsx` sobrescreve `price`/`priceById` com esse valor quando disponível (`currentValueById`/`effectivePriceById`) e corrige a aba "Vigiados", que não passava `nextBid` ao `LotCard` |
| v0.73.4      | Fix: lotes no formato "LP DISCO DE VINIL ARTISTA ÁLBUM ANO" (sem nenhum separador entre artista e álbum) caíam em `UNCLASSIFIED_LABEL` mesmo com artista claro no título (ex.: "Ira! Vivendo e Não Aprendendo 1986", "John Denver Poems Prayers and Promises 1974") — `extractArtist` (`vinyl-parse.ts`), sem separador, só tinha a frase inteira como candidato: vira "" pela trava de >5 palavras, ou pior, um "artista" espúrio com a frase toda quando ≤5 palavras (ex. "Legiao Urbana Dois 1986" virava artista "Legiao Urbana Dois 1986" em vez de casar "Legião Urbana" via `known_artists`). Nova `matchKnownArtistAtStart` roda ANTES da heurística de corte: casa um nome conhecido ancorado no início do título (índice lazy só do bundle `KNOWN_ARTISTS_SEED`, client-safe — sem tocar a tabela `known_artists` do banco). `buildKnownArtistIndex` também para de descartar nome de 1 palavra <4 chars quando a grafia original tem pontuação estilizada ("Ira!", "Neu!" — sinal de nome de banda deliberado, não sigla/palavra comum; "RPM"/"Nas"/"Art" etc. continuam de fora, ambíguos com termos comuns de leilão/PT). Seed ganha "John Denver", "Linear", "Fat Boys", "Nazareth" (exemplos reportados pelo usuário que ainda ficavam sem match nem por essa via nem pelo reforço via `fillMissingArtists`) |
| v0.73.5      | Resolve a pendência "Alberto Lopes - Leiloeiro Público" (aberto desde v0.69.42/43, reforçado em v0.71.1): a alternativa cogitada nas Pendências ("excluir a casa da varredura") foi adotada em vez de continuar ampliando `NON_MEDIA_COLLECTIBLE_RE` termo a termo. Novo `BLOCKED_HOUSES`/`isBlockedHouse` em `leiloesbr-scrape.server.ts` (comparação normalizada, trim + minúsculas) bloqueia a casa em TODOS os pontos de entrada — `scrapePages`/`scrapeVinylChunk` (varredura geral, categoria travada), `listGalleryAuctions` (`galleryscan`) e `persistLots` (upsert, defesa em profundidade) — e `pruneNonVinylLots` passa a apagar também lotes já persistidos dessa casa, então `step=cleannonvinyl&apply=1` limpa o que já tinha entrado (achado do usuário, 2026-09-22: item de bijuteria "ANELÃO MASCULINO ANTI STRESS" não batia nenhum termo de `looksNonVinyl`) |
| v0.73.6      | Fix (2ª leva de "artista claro em não classificados", depois do v0.73.4): casas que usam "//" pra separar campos ("LP ANA CARAM C/ ENCARTE // CAPA CONFORME FOTOS // DISCO EM MUITO BOM ESTADO // PODE...") não tinham esse separador reconhecido pelo split de `extractArtist` (só `-`/`:`/`–`/`—`), então o candidato virava a frase inteira e zerava pela trava de >5 palavras. `//` (duas barras — UMA barra continua reservada pro nome de banda tipo "AC/DC", nunca tem espaço antes) entra no split. Duas limpezas novas no candidato: corta o abreviação " C/ " ("com [encarte/pôster]", não é nome — "Ana Caram C/ Encarte" → "Ana Caram") e o ANO final colado sem separador ("Bebeto 1981" → "Bebeto", útil bem além desse formato — qualquer "ARTISTA ANO" que sobre como candidato) |
| v0.74.0      | Ordena as casas (grade principal, Vigiados/Lances do dia e geral) por horário do leilão + alfabética, em vez de por nº de itens; lances ganham horário casado por `${dia}\|casa` (não vêm com horário na origem). Vigiados/Lances (dia e geral) ganham abrir/fechar por casa (antes sempre abertas) + botão "Fechar todas" no início de cada lista (grade principal também ganha o botão). Barra de chips das casas no header ganha botão pra ocultar só ela |
| v0.74.1      | Achado de produção: run `#160` do `refresh.yml` (2026-09-22) voltou "All jobs have failed" — `chunk`/`galleryscan`/`enrich` completaram normalmente (`persisted:true`), `aieval` coletou um batch, mas a 2ª chamada de `step=aiident` (mesmo lote de 25 ainda pendentes de identificação por título, via Gemini síncrono) voltou HTTP 500 nas 4 tentativas do `curl --retry 3` — consistente, não parece blip de rede. Causa raiz real ainda **não** identificada: `call()` usa `curl -f`, que suprime o corpo da resposta (o `catch` de `handleCron` devolve a mensagem do erro + `pid`/`hostname`/`hasDatabaseUrl` no JSON, mas isso nunca chega ao log do Actions). Corrigido o que dava pra corrigir sem essa informação: `aieval`/`aiident` são chunked e idempotentes por design ("o resto completa nas execuções seguintes"), mas uma falha ali estava matando a run INTEIRA via `set -e`, cancelando também `market`/`condition`/`sales`/`reident`/`purchases`/`prune` — nada a ver com o bug em si. Novo `call_soft()` em `refresh.yml` (sem `-f`, extrai o HTTP status por marcador `===HTTPSTATUS===`, mesma técnica do v0.69.15) faz esses dois steps logarem o corpo real do erro e **pularem pro próximo step** em vez de abortar tudo; a run só é marcada como falha (`exit 1` + ping de falha no healthchecks.io) no FINAL, depois que os demais steps já rodaram. Validado localmente (`bash -n`, mais um teste isolado do `call_soft` contra um servidor fake simulando 200/500/conexão recusada). Pendente: a próxima falha do `aiident` deve trazer a mensagem real do erro no log — ver Pendências |
| v0.74.2      | Fix: vigiados de leilões distantes (além de `WINDOW_DAYS`/5 dias, a janela de scraping do servidor) sumiam das abas "Vigiados"/"Lances" — `mergeWatchedAccum` (`watched-accum.ts`) podava pelo teto de `WATCH_WINDOW_DAYS` mesmo sendo vigia real e confirmada na conta do LeilõesBR; agora só poda vigiados pelo dia já PASSADO (removido o teto futuro, `WATCH_WINDOW_DAYS` não existe mais) — lances (`MyBid`) sem mudança |
| v0.75.0      | Lote em pregão agora ("Lote 457" + barra "135/322 · 41%") ao lado de "Ao vivo agora" na lista principal e no `/ao-vivo`, via endpoint de polling do presencial (`le_registro_pregao_cfbr_v1.asp`), atualizado a cada 5 min só com a aba visível |
| v0.75.1      | Selo do lote em pregão atualiza a cada 1 min (era 5 min); cache do servidor 60 s → 30 s para não virar o piso |
| v0.75.2      | Pedido do usuário: remove a barra de chips das casas do header (introduzida em v0.74.0, com botão pra ocultar) pra liberar espaço — clicar na casa direto na grade principal continua abrindo/fechando a seção (`openHouses`/`toggleHouse`, inalterados) |
| v0.76.0      | Selo do lote em pregão (nº + barra) também em "Acontecendo agora", trocando a linha "Início hh:mm" — card mantém o mesmo tamanho |
| v0.76.1      | Pedido do usuário: botão "Incluir/Ocultar finalizados" move da barra de controles do dia pro final da faixa de dias (depois de "Lances") — novo alvo de portal `finishedToggleHost` em `_authenticated/index.tsx`, populado dentro do loop de dias (mesma lógica de `finishedCount`/`showFinished`/`toggleShowFinished` de antes, só muda o destino do portal) |
| v0.76.2      | **Causa raiz do 500 recorrente no cron resolvida** (pendência aberta desde v0.74.1). Runs `#160`/`#161`/`#162` do `refresh.yml` (2026-09-22) falharam em steps DIFERENTES a cada vez (`aiident`, `condition`, `reident`) — investigação por log da VPS (`docker compose logs app`) achou duas causas distintas, não uma: (1) run `#161` colidiu com um deploy em andamento (`docker compose up -d` recriando o container `app` no meio da chamada do cron — nada a corrigir, risco aceito de rodar deploy+cron em paralelo); (2) run `#162`, o real bug: `upsertLotIdent` (`lot-ident.server.ts`) explode com `insert or update on table "lot_ident" violates foreign key constraint "lot_ident_id_fkey"` (código `23503`) quando o `id` não existe mais em `lots` — `lot_ident` tem FK `ON DELETE CASCADE` pra `lots(id)` (v0.67.0), mas `reidentifyAllSales` escreve identificações a partir de `lot_id` de `lot_sales`, tabela histórica que NUNCA é apagada; uma venda cujo lote original foi podado (`step=prune`) ou excluído manualmente (`step=aiident` tem o mesmo risco — lote pode sumir de `lots` entre a seleção do batch e o upsert) gera uma linha órfã que quebra o upsert inteiro do lote e sobe sem tratamento até `handleCron`, virando HTTP 500 pro `curl` do `refresh.yml` e derrubando o resto da run (`sales`/`purchases`/`prune` inclusive). Fix: `upsertLotIdent` agora trata o `code: "23503"` como best-effort — consulta quais `id`s do payload ainda existem em `lots`, descarta os órfãos (loga quantos) e regrava só os válidos, em vez de propagar a exceção. Nenhuma mudança em `reidentifyAllSales`/`cron.server.ts` — o filtro fica centralizado no writer compartilhado, protegendo `aiident` e `reident` ao mesmo tempo |
| v0.76.3      | v0.76.2 corrigiu só `lot_ident`; a mesma classe de bug se repetiu no dia seguinte — run `#164` do `refresh.yml` (2026-09-23) quebrou no step `condition` com `insert or update on table "lot_condition" violates foreign key constraint "lot_condition_id_fkey"` (log da VPS de novo). Checado o `setup.sql`: as MESMAS 4 tabelas ganharam a FK `ON DELETE CASCADE` pra `lots(id)` em v0.67.0 (`lot_ai`, `lot_ident`, `lot_market`, `lot_condition`) — só `lot_ident` tinha o filtro. Extraído `filterExistingLotIds` (novo `lot-orphan-guard.server.ts`) e aplicado o mesmo tratamento de `23503` (filtra pelos `id`s que ainda existem em `lots`, descarta órfãos com log, regrava só os válidos) em `upsertLotAi`/`upsertLotMarket`/`upsertLotCondition`, e `upsertLotIdent` refatorado pra usar o helper compartilhado em vez da consulta duplicada. Fecha a classe inteira do bug, não só a instância que apareceu primeiro |
| v0.76.4      | Validação em produção do v0.76.3 (`workflow_dispatch` manual do `refresh.yml`, 2026-09-23) rodou sem nenhum 500/FK — mas o usuário notou algo estranho: `reident` girou as 15 rodadas permitidas repetindo EXATAMENTE `identified:7, processed:57, remaining:1` sem nunca convergir. Log da VPS confirmou: as 57 vendas pendentes eram descartadas como órfãs em TODA rodada (`[lot-ident] 57 identificação(ões) órfã(s) ignorada(s)`) — não é um caso raro, é o backlog inteiro. Causa: a RPC `get_unidentified_lot_sales` (v0.73.1/20260914000000) faz anti-join só contra `lot_ident`, sem checar se o lote ainda existe em `lots`; como `lot_ident` tem FK `ON DELETE CASCADE` pra `lots(id)`, uma venda de lote já podado NUNCA consegue ganhar linha em `lot_ident` — a RPC devolvia essa mesma venda pra sempre como "não identificada", e `reidentifyAllSales` gastava uma chamada de IA por rodada nela, em todo cron, sem nunca convergir (o fix v0.76.2/v0.76.3 parou o CRASH, mas não esse desperdício). Nova migration `20260923130000_unidentified_sales_requires_live_lot.sql` (+ `setup.sql`, reaplicado automaticamente): a RPC passa a exigir `EXISTS (... FROM lots WHERE lots.id = lot_sales.lot_id)` — venda de lote podado simplesmente para de entrar na fila de identificação (mantém o artista/título da última vez que foi identificada, normalmente enquanto o lote ainda estava ativo) |
| v0.77.0      | Pedido do usuário: reduz falso positivo do casamento "já tenho na Coleção" — denylist de termos genéricos aprendida (chips clicáveis no `OwnedPanel`, `collection_keyword_denylist`), apelidos de artista do Analytics agora compartilhados com a Coleção (`resolveArtistAlias`), e script `scripts/calibrate-collection-thresholds.ts` para calibrar `OWNED_MATCH_MIN`/`OWNED_CONFIDENT_MIN` com os dados reais de `collection_feedback` — ver seção "Curadoria com aprendizado" / Coleção acima |
| v0.78.0      | Pedido do usuário: thumbnail pequeno/comprimido no Vinil Analytics (preview do hover + detalhe da venda), incluindo o HISTÓRICO já capturado — não só as vendas novas. Nova coluna `lot_sales.image` (migration `20260923140000_lot_sales_image.sql` + `setup.sql`) guarda a URL do NOSSO thumbnail (WEBP 200px q70, `sales/<lot_id>.webp` no mesmo volume/rota `/collection/*` das fotos da Coleção — `captureSaleThumbnail`, `lot-sales.server.ts`), NUNCA a URL crua do CDN do catálogo (que não sobrevive ao leilão). Duas fontes: (1) `captureFinishedSales` ganha uma etapa de thumbnail (teto `THUMB_CAP=20`/rodada) a partir de `vinylById.image` (a imagem que a listagem geral já capturava em `lots.image`, agora também propagada por `VinylInfo`) — cobre o fluxo novo; (2) `backfillSaleThumbnails` (novo `step=salesthumbs` do cron, chunked, também no laço do `refresh.yml`) varre vendas com `image IS NULL` e busca a imagem em `lots` pelo `lot_id` — cobre o HISTÓRICO, mas só enquanto o lote ainda tiver linha em `lots` (`WINDOW_DAYS`=5; vendas mais antigas que isso perderam a fonte pra sempre e ganham o marcador definitivo `image=""`, nunca mais reprocessadas — `NULL`=ainda não tentado, `""`=tentado sem fonte). `db-query.server.ts` ganhou o método `.is(col, null)` (faltava no shim; só `.not(col,"is",null)` existia). `SaleRow`/`getVinylSales` passam `image` de graça (`BASE_SALE_COLUMNS`, campo leve) — a UI só trocou o cast `as SaleRow & {image}` por um campo de verdade + mostra a imagem também em `SaleDetailDialog`, que antes não tinha |
| v0.79.0      | Pedido do usuário: arrastar um `SaleMarker` (mini card de venda) para o cabeçalho de outro `AlbumRow` do MESMO artista, no Vinil Analytics, move a venda pra lá — atalho de UI pra cima da correção por venda que já existia (`onApplySaleOverride`/`analytics_sale_overrides`), sem nenhuma mutação nova no servidor. Drag-and-drop nativo (`draggable` + `dataTransfer`, tipo MIME próprio `application/x-vinyl-sale` só reconhecido pelo `AlbumRow`, sem interferir em outro drop da página); o payload carrega artista/álbum de ORIGEM — o alvo confere o artista (nunca move entre artistas diferentes, mesmo manipulando o DOM) e ignora o drop se já é o álbum atual. Feedback visual: card arrastado com opacidade reduzida, cabeçalho do álbum sob o cursor ganha destaque (`ring`+fundo). Funciona com o álbum de destino recolhido (só o de ORIGEM precisa estar aberto pra ver o card). **Limitação conhecida:** drag-and-drop nativo HTML5 não funciona em touch (mobile) — nesses casos a correção por venda pelo diálogo (clique no card → "Corrigir esta venda") continua sendo o caminho, sem mudança |
| v0.79.1      | Fix do v0.78.0: validado em produção (`workflow_dispatch` do `refresh.yml`) que a etapa de thumbnail DENTRO de `captureFinishedSales` nunca funcionava — `sales`/`thumbsUsed` sempre voltava 0, e o `backfillSaleThumbnails` do histórico batia `noSource` em TODO o backlog escaneado (450 registros em 30 rodadas). Causa: essa etapa buscava a imagem em `vinylById` (o snapshot AO VIVO da listagem geral, `scrapeVinylLots`) — mas um leilão **some da listagem geral assim que fica "ao vivo"** (comportamento já documentado em "Scraping do LeilõesBR"), então os lotes que `captureFinishedSales` processa (JÁ TERMINADOS) NUNCA estão nesse snapshot; a etapa buscava no lugar errado, sempre vazio. Removida (código morto) — `backfillSaleThumbnails` já cobre o caso: busca a imagem em `lots` (o BANCO, que ainda tem a linha por até `WINDOW_DAYS`=5 dias), roda logo depois no mesmo `refresh.yml`, e ordena por `captured_at DESC` — então uma venda recém-capturada sempre entra na FRENTE da fila do backfill, sem depender do snapshot ao vivo. `THUMB_CAP`/`thumbsUsed`/`VinylInfo.image` removidos (não tinham mais uso) |
| v0.80.0      | Pedido do usuário: recupera thumbnail do backlog mesmo depois que `lots.image` já não existe mais — validado NA PRÁTICA (SSH manual no VPS, não só leitura de doc) que a página do LOTE (`peca.asp`, o mesmo link de `source_url`) continua trazendo a foto mesmo com o lote fechado/vendido, em duas gerações de template (mesma dualidade que `fetchCatalogData` já trata pro catálogo): template NOVO (JSON `loadData` embutido, campo `VPASTA` — sobrevive ao fechamento, **não** é exclusivo do lote "aberto" como a doc antiga (`docs/notas-desenvolvimento.md`, "Referência: JSON loadData do peca.asp") sugeria) e template ANTIGO (HTML server-side puro, sem JSON — primeiro `<img>` que não pareça logo/banner). Nova `fetchLotPageImage` (`lot-sales.server.ts`) tenta essa página como fallback DENTRO de `backfillSaleThumbnails`, só quando `lots.image` já não existe (1 requisição extra por lote, throttled com `LOT_PAGE_THROTTLE_MS`=350ms — bem mais caro que o caminho barato, por isso só como fallback). Nova `resetNoSourceThumbnails` (`step=resetnosourcethumbs`, ÚNICA VEZ, fora do laço do `refresh.yml`) volta pra `NULL` as vendas que o v0.78.0/v0.79.1 tinham marcado `""` (sem fonte) julgando só por `lots.image` — julgamento errado agora que se sabe que a página do lote é uma segunda fonte válida |
| v0.80.1      | Fix badge "Lote N" cobrindo o card inteiro em alguns lotes do Catavento Discos: o campo `LOTE` do endpoint JSON (`fetchCatalogJson`, `leiloesbr-catalog.server.ts`) vinha, para alguns registros (aparentemente multi-item), com a descrição inteira em vez do número curto — sem validação nenhuma antes de virar `data.lote`. Agora só aceita `LOTE` no formato `[0-9]+[a-zA-Z]?` (mesmo padrão já usado pelo parser HTML irmão, `parseCatalogData`), caindo pra `null` (sem badge) caso contrário. Badge (`lot-card.tsx`) também ganhou `max-w`/`truncate`/`whitespace-nowrap` como defesa em profundidade, pra uma string longa nesse campo nunca mais crescer sobre o card |
| v0.81.0      | Pedido do usuário: a IA do Analytics (`reidentifyAllSales`, global e por artista/álbum) passa a agregar o álbum identificado ao bucket **já existente do artista** em vez de criar quase-duplicados por variação de grafia/edição — artista é a chave principal (canonizado primeiro, como já era), álbum entra depois, DENTRO do universo daquele artista: `albumsByArtist` (via `deriveAlbum` sobre os títulos atuais) + novo `matchExistingAlbum`/`extractAlbumPart` (`vinyl-parse.ts`, exato por `normalizeForMatch` ou similaridade por token ≥ `0.6`) escolhem a grafia já conhecida em vez da nova da IA. Diálogo de correção manual por venda também ganhou o mesmo espírito: o `<datalist>` de álbum só sugere os do artista digitado (`Suggestions.albumsByArtist`) |
| v0.82.0      | Pedido do usuário: novo botão **`IaAllAlbumsButton`** (ícone `Layers`) ao lado do `IaButton` do artista no Vinil Analytics — roda a IA em TODOS os álbuns daquele artista de uma vez, chamando `reidentifySales` uma vez por álbum em sequência (mesma rotina do botão de um álbum, já existente), em vez de precisar abrir e clicar álbum por álbum manualmente. Handler de página `reidentifyAllAlbums` agrega os resultados num único toast/invalidação; nenhuma mudança no servidor |
| v0.83.0      | Pedido do usuário: variante **somente-leitura, externa** do Vinil Analytics para compartilhar sem login Google — `/vinil-analytics-publico` (rota top-level, FORA de `_authenticated/`, lê `?token=` via `validateSearch`). Autenticação por **token diário derivado** (não é sessão nem fica gravado no banco): `publicAnalyticsTokenFor`/`todayPublicAnalyticsToken`/`assertPublicAnalyticsToken` (`access.server.ts`) — `HMAC-SHA256(PUBLIC_ANALYTICS_SECRET, "vinil-analytics:" + data em America/Sao_Paulo)`, hex truncado a 16 chars; aceita o token de HOJE **ou de ONTEM** (folga de 1 dia pra um link perto da virada não quebrar na hora). Nova env `PUBLIC_ANALYTICS_SECRET` (`.env.example`). Nova server function **SEM** `requireSupabaseAuth`/`assertAllowed` — `getPublicVinylAnalytics` (`leiloesbr.functions.ts`) — só o gate do token, devolve `{ sales, aliases }` (mesmos dados de `getVinylSales`/`getAnalyticsAliases`); `getTodayPublicAnalyticsToken` (autenticada) devolve só o token do dia pro cliente, nunca o segredo. Para não duplicar as ~1900 linhas de UI, o corpo do Analytics virou componente compartilhado `src/components/vinyl/analytics-view.tsx` (`AnalyticsView`, prop `readOnly`) — no modo público some TUDO que muta (editar/fundir artista ou álbum, corrigir/excluir venda, excluir artista, drag-and-drop entre álbuns, reidentificar por IA, seletor de provedor/modelo de IA, painel "Ocultos"); ordenação/filtro/expansão/detalhe de venda continuam. A página autenticada (`vinil-analytics.tsx`) ficou só com a busca de dados via server functions + os handlers de mutação, passados como props, e ganhou o botão "Copiar link público" (ícone `LinkIcon`) que busca o token de hoje e monta a URL com `window.location.origin` |
| v0.83.1      | Pedido do usuário: aba "Lances" deve mostrar TODOS os lances dados, mesmo pra leilão futuro; lances passados podem sumir depois de 2 dias. Fix: `mergeWatchedAccum` (`watched-accum.ts`) podava um lance (`MyBid`, `item.time === undefined`) sempre que `dayKey` caía fora de `recentDayKeys` (só hoje + passado) — um lance com `dayKey` FUTURO nunca batia nessa janela e sumia do acumulador assim que era mesclado. Agora dias futuros nunca são podados por data; só dias já passados caem na janela de retenção, reduzida de `BID_RETENTION_DAYS` = 14 para 3 (hoje + 2 dias pra trás) |
| v0.84.0      | Pedido do usuário: achado real de produção (leilão específico da Abreu Colecionismo ausente do app, confirmado por `catalogdebug`/`findlot` via `debug-cron.yml`) revelou que o botão manual **"Atualizar tudo"** (`refreshAll`, `index.tsx`) só rodava `chunk`+`enrich` — nunca teve o `galleryscan` (existe desde v0.69.40, só no cron automático `refresh.yml`), então casas fora da categoria "Disco de Vinil" da LeilõesBR (ex.: Abreu) dependiam só dos 3 ciclos diários do cron pra aparecer, nunca do botão manual. `refreshAll` ganha 3 fases novas, na MESMA ordem do `refresh.yml`: **`galleryscan`** (descoberta por galeria, chunked por `offset`, entre `chunk` e `enrich` — os lotes descobertos já entram na mesma passada de nº de lote) e **`condition`** (estado Disco/Capa, chunked por `max`) rodam até `done`; **`aiident`** (identificação por IA, artista/álbum) dispara **UMA chamada só** e não espera o batch terminar — mostra toast "enviado, vai completar sozinho" (Claude Batches) ou "coletando o lote anterior" em vez de girar minutos esperando. `aieval`/`market`/`sales`/`reident`/`purchases`/`prune` ficam de fora de propósito: não descobrem lote novo (são avaliação por IA, âncora Discogs, histórico pós-venda ou dados pessoais do usuário) — ver tabela completa avaliada com o usuário antes de implementar. Novas server functions `runGalleryscan`/`runCondition`/`runAiident` (`leiloesbr.functions.ts`, mesmo padrão de `enrichLotes`/`scrapeVinylChunk`). Lógica do `aiident` extraída de `cron.server.ts` para `ai-ident-step.server.ts` (`runAiIdentStep`), reaproveitada pelos dois lados (`step=aiident` do cron E o botão manual) — elimina duplicação, mesmo comportamento nos dois. Botão troca o rótulo por fase (`refreshPhase`: "Descobrindo por galeria…", "Preenchendo nº de lote…", "Lendo estado Disco/Capa…", "Enviando identificação por IA…") já que as fases pós-varredura-geral têm tamanhos heterogêneos demais pra uma % confiável (a % precisa continua só na 1ª fase, `chunk`) |

## Pendências

**Produto / código (em aberto)**

- **✅ RESOLVIDO (v0.76.2) — Causa raiz do 500 em `step=aiident`/`reident` (achado v0.74.1, run
  `#160` do `refresh.yml`, 2026-09-22).** Confirmada por log direto da VPS (`docker compose
  logs app`) numa recorrência (runs `#161`/`#162`, mesmo dia): `upsertLotIdent` explodia com
  violação de FK (`lot_ident_id_fkey`, código `23503`) quando o `lot_id` não existia mais em
  `lots` (lote podado ou excluído manualmente entre a seleção do batch e a gravação). Ver
  changelog v0.76.2 para o fix.

- **✅ RESOLVIDO (v0.73.5) — Itens não-disco reincidentes da "Alberto Lopes - Leiloeiro
  Público" (aberto desde v0.69.42/43, reforçado em v0.71.1).** Essa casa generalista rendeu 4
  rodadas de achados do usuário (joalheria, depois livro/quadro/lata/brinquedo via
  `galleryscan` sem categoria travada, depois prataria/salva/bandeja, por fim bijuteria de
  novo em 2026-09-22 com "ANELÃO MASCULINO ANTI STRESS" — título sem nenhum termo bloqueável)
  mesmo após rodadas de `step=cleannonvinyl` limpar o que já tinha entrado — confirmando que a
  PRÓPRIA LeilõesBR marca itens fora de disco na categoria "Disco de Vinil" pra essa casa
  específica, não só o gap do `galleryscan` (já corrigido em v0.69.43). Ampliar
  `NON_MEDIA_COLLECTIBLE_RE` termo a termo não escala — adotada a alternativa já cogitada aqui:
  a casa inteira agora é bloqueada (`BLOCKED_HOUSES` em `leiloesbr-scrape.server.ts`, hardcoded
  — não é um toggle de UI como `verified_houses`) em todos os pontos de entrada da varredura, e
  `pruneNonVinylLots`/`step=cleannonvinyl` apaga retroativamente os lotes já persistidos dela.

- **✅ RESOLVIDO DE VEZ (v0.69.27/29, validado em produção 2026-09-21) — `step=aieval` voltando
  500 "Missing DATABASE_URL" (aberto desde v0.69.15).** Causa raiz: **dois secrets do GitHub
  Actions nunca foram atualizados pro VPS no cutover da Fase 6** — `APP_URL` apontava pra Vercel
  (`leilao-finder-buddy.vercel.app`, corrigido v0.69.27) e, uma vez corrigido esse, apareceu o
  segundo em paralelo: `CRON_TOKEN` também divergente entre o secret do GitHub e o `.env` do
  VPS (401 Unauthorized, achado/corrigido v0.69.29). A Vercel nunca parou de receber auto-deploy
  deste repo, então rodava o código atual — só que sem `DATABASE_URL` (env exclusiva do VPS).
  Confirmado resolvido de vez na run `#144` (todos os steps do `refresh.yml` com sucesso,
  `aieval` com `conn-info` direto pro VPS) e reconfirmado nas runs `#151`/`#152` (2026-09-21,
  já sem a instrumentação de diagnóstico precisar de nada especial — ver Histórico de versões,
  v0.69.27–29, pra investigação completa).
  - Mitigação que fica valendo: `/api/health` (`src/lib/health.server.ts`) + `health_uri` ativo
    no Caddy (v0.69.21) — proteção estrutural de baixo custo, útil independente da causa.
  - Instrumentação temporária de diagnóstico **removida** (v0.69.33): header `X-Debug-Upstream`
    no `Caddyfile` e `-v`/`-D` na chamada do `aieval`/`prune` em `refresh.yml` (v0.69.4/21/26) —
    nenhum dos dois é mais necessário, o tráfego já vai pro VPS de verdade.

- **✅ FEITO (v0.69.33) — remoção de TODAS as referências ativas à Vercel do código/docs**,
  pedido explícito do usuário assim que o bug do `aieval` foi confirmado resolvido. Removidos:
  `vercel.json`, entrada `.vercel` em `.gitignore`/`.dockerignore`, menção a `vercel.app` no
  User-Agent do Discogs (`discogs.server.ts`), comentários citando Vercel em
  `vite.config.ts`/`leiloesbr-scrape.server.ts`/`lot-ai.server.ts`/`lot-ident.server.ts`/
  `lot-sales.server.ts`, instruções desatualizadas em `.env.example` (chaves de IA/Discogs
  agora documentadas como lidas do `.env` do VPS, não mais "Environment Variables da Vercel"),
  e o parágrafo do `CLAUDE.md` que ainda dizia "falta a Fase 6" (cutover já concluído desde
  v0.69.13). Mantido de propósito o registro **histórico** da migração (`README.md`,
  `docs/economia-fase-2-vps-unico.md`, `docs/economia-migracao.md`,
  `docs/economia-fase-1-egress-e-cpu.md`) — essas menções não são instrução ativa, são o
  porquê da arquitetura atual (VPS único). Usuário confirmou nesta janela que também já
  desconectou o auto-deploy da Vercel pra este repo (Vercel → Project Settings → Git) e removeu
  a Authorized redirect URI antiga (Google Cloud Console) — ambas ações fora do alcance de
  qualquer sessão. **Fase 6 (cutover) totalmente encerrada, sem pendências restantes.**

- **✅ RESOLVIDO (achado em v0.69.28, decorrente do bug acima) — o cron vinha PERDENDO lotes desde o
  cutover da Fase 6, não só falhando o `aieval`.** Causa raiz de UM NÍVEL MAIS FUNDO do que
  parecia: o shim `db-query.server.ts` (`createDbQueryClient`/`QueryBuilder.execute`) tem
  contrato explícito de **nunca lançar** — todo erro do Postgres (`DATABASE_URL` ausente,
  conexão recusada, o que for) vira `{ data: null, error }` resolvido normalmente, igual ao
  PostgREST. `persistLots` (`leiloesbr-scrape.server.ts`, usado por `scrapeVinylChunk` e
  `enrichMissingLotes`) fazia `await supabaseAdmin.from("lots").upsert(rows, ...)` **sem checar
  `error`** — então o `try/catch` ao redor nunca disparava (não havia o que capturar: a promise
  sempre resolvia "com sucesso", só que sem gravar nada) e o `console.error` de diagnóstico
  nunca rodava. `scrapeVinylChunk`/`enrichMissingLotes` devolviam **HTTP 200 normal**, com
  `scraped`/`updated` contando o que foi RASPADO do site (parse do HTML), não o que foi GRAVADO
  no banco. Combinado com o bug do `APP_URL`/Vercel acima (sem `DATABASE_URL` lá), toda rodada
  de cron desde o cutover da Fase 6 raspou o site normalmente mas **não gravou nada de novo** na
  tabela `lots` real (a do VPS) — o app ficou servindo só o snapshot congelado de antes da
  migração, cada vez mais defasado da contagem real do LeilõesBR, sem nenhum log ou sintoma
  visível (diferente do `aieval`, que usa `ai-eval.server.ts`/outros módulos que SEMPRE checam
  `error` e relançam — por isso só ele estourava 500 e abortava o `refresh.yml`, mascarando que
  `chunk`/`enrich`, rodando antes dele no laço, já não estavam gravando nada). **Corrigido em
  v0.69.28**: `persistLots` agora checa `{ error }` do `.upsert()` e relança (removido o
  `try/catch` que envolvia essa chamada — ela nunca lançava mesmo, então o bloco só escondia o
  problema; o histórico de leilões via `recordAuctions`, best-effort à parte, continua
  silencioso de propósito). `scrapeVinylChunk`/`enrichMissingLotes` devolvem `persisted: boolean`
  (`false` quando o erro relançado foi pego pelo `try/catch` que já existia nelas) e `refresh.yml`
  aborta a run (+ ping de falha no healthchecks.io) assim que vir `persisted:false`, em vez de
  seguir o laço até o fim fingindo que terminou. **Isso não troca o secret `APP_URL` sozinho** —
  só transforma a perda silenciosa em falha ruidosa, visível no log da Action/healthchecks.io,
  até o item acima ser corrigido pelo usuário. Depois de trocar o secret e confirmar rodadas
  verdes: (1) considerar rodar `chunk`/`enrich` manualmente (botão "Atualizar tudo") pra
  recuperar o atraso acumulado mais rápido que esperar os 2 ciclos diários; (2) varrer o resto
  do arquivo por outros `.upsert()`/`.insert()`/`.update()`/`.delete()` que não checam `error`
  (`pruneOutOfWindow` aqui mesmo é um candidato — não corrigido agora por ser limpeza, não
  causa de perda, mas mesma classe de risco) — não é garantido que este seja o único lugar.
  **Confirmado em produção**: as runs `#151`/`#152` (2026-09-21, após o usuário trocar o
  `APP_URL`) mostram `chunk`/`enrich` com `persisted:true` em toda chamada — a gravação no
  banco do VPS está funcionando de verdade.

- **✅ RESOLVIDO (achado em 2026-09-21, INDEPENDENTE da migração — ver nota abaixo) — dia
  inteiro sumindo da listagem (ex.: quinta 24/9 com 0 lotes, cercado por 21/9=1194, 22/9=344,
  23/9=563, 25/9=615).** Depois de confirmar a persistência (item acima), o usuário ainda achou
  lotes de vinil reais sumindo — não só o caso do dia 24 zerado, mas também a casa **Abreu
  Colecionismo** trazendo só 125 dos 198 lotes do dia 22 que aparecem no catálogo dela mesma.
  Causa raiz: `scrapePages`/`scrapeVinylChunk` (`leiloesbr-scrape.server.ts`) caminhavam pelas
  páginas da listagem geral (`busca_andamento.asp`) de trás pra frente e **paravam assim que
  encontravam uma página cujo dia mínimo já tinha passado do fim da janela** (`passedWindow`),
  assumindo que a ordenação é estritamente monotônica por data ("os dias mais próximos ficam
  nas últimas páginas"). Na prática os leilões vêm intercalados (não ordenados só por data) —
  uma página "fora da janela" não garante que as páginas seguintes (números menores) também
  estejam; leilões inteiros com lotes dentro da janela (confirmados pelo usuário: "Peça Única
  Colecionismo" e "Livros Universo - Livros Raros e Antiguidades" com vinil pro dia 24; "RT
  Leilões e Artes", casa já com histórico normal na base) ficavam permanentemente fora do
  alcance da varredura, sem nenhum log. **Achado reproduzível/determinístico**: duas rodadas
  completas do cron (`#151`, `#152`) pararam exatamente no mesmo intervalo de páginas (93→34),
  nunca alcançando as páginas 33→1 em nenhuma das duas — não era questão de dado ainda não
  publicado. **Corrigido em v0.69.30**: removido o corte antecipado por `minDay` em
  `scrapePages` (usada por `scrapeVinylLots`/`refreshVinylDay`) e em `scrapeVinylChunk` (usada
  pelo cron); agora a varredura sempre vai até `MAX_PAGES`/`page=1`, e só o filtro por `dayKey`
  item a item decide o que entra na janela — mais requisições por rodada (hoje ~93 páginas
  completas em vez de parar em ~60), mas dentro do orçamento já existente (`MAX_PAGES=150` na
  leitura ao vivo; laço de 80 chamadas × 15 páginas no `refresh.yml`).
  ⚠️ **Nota de atribuição**: diferente do bug de persistência acima, este é **mais antigo que a
  migração pra VPS** — a lógica `passedWindow` já existia no código em 10/09 (v0.44.x),
  bem antes da Fase 1 da migração (v0.62.0). Não é um efeito colateral do cutover; só não tinha
  sido percebido porque, até a persistência ser corrigida, o app servia um retrato congelado
  de dados antigos e ninguém conferia a distribuição por dia de uma varredura fresca dia a dia.

- **🔎 EM INVESTIGAÇÃO (2026-09-21, v0.69.31/32/34/35) — mesmo após o fix de paginação acima,
  usuário reportou um lote específico do dia 24/9 ainda ausente da ferramenta**: casa "Coisa
  Antiga Leilões", `https://www.coisaantigaleiloes.com.br/catalogo.asp?Num=65152` (idLeilao
  65152). A run `#153` (v0.69.30, pós-fix) já varreu a listagem geral até o fim (93→3→null,
  cobrindo o intervalo antes pulado), então o caso muda de natureza: não é mais o corte
  antecipado por página. **Ferramenta de diagnóstico nível 1** (`findLotDebug`,
  `leiloesbr-scrape.server.ts`, `step=findlot&q=<idLeilao ou casa/URL>` em `cron.server.ts`;
  chamada avulsa via novo workflow `debug-cron.yml`, `workflow_dispatch` com input
  `querystring`, sem rodar a cadeia pesada do `refresh.yml`) rodada em produção
  (`step=findlot&q=65152`): varreu as 93 páginas da categoria "Disco de Vinil" da LeilõesBR de
  ponta a ponta e **não achou NENHUMA ocorrência** do leilão 65152 (`matches: []`) — descarta
  bug nosso (paginação/`looksNonVinyl`/parse de `dayKey`) pra esse caso: o item simplesmente não
  está na categoria vinil da LeilõesBR.
  ⚠️ **Achado do usuário que reabriu a investigação**: no catálogo PRÓPRIO da casa
  (`coisaantigaleiloes.com.br/catalogo.asp?Num=65152`), o leilão tem 401 itens, dos quais **319
  categorizados como "Disco de vinil"** (e 82 como "Música") pelos filtros do site DELA.
  **Ferramenta nível 2** (`findLotSearch`, `step=findlot2&idLeilao=<...>&pesquisa=<termo>&
  lockToVinyl=0|1`): busca por texto livre (`pesquisa`, filtrado no SERVIDOR — mantém o total
  de páginas viável mesmo sem travar categoria), rodada com `pesquisa=Ray Charles&
  lockToVinyl=0` — **achou de primeira** (1 página só, o texto já filtra bem no servidor):
  o item 65152/32420758 ("Os Cantores de Ray Charles") está lá, `dayKey: "2026-09-24"` (correto),
  `wouldKeep: true` (passaria no nosso filtro). **Confirma**: o item existe e está saudável na
  listagem geral da LeilõesBR, só não está marcado com `tp="Disco de vinil"` — categorização
  entre a casa e a plataforma não bate, fora do nosso scraper.
  ⚠️ **Pista nova do usuário**: no catálogo da CASA, marcar o filtro "Disco de vinil" grava
  `tipo=|129|` na URL — um CÓDIGO NUMÉRICO local, bem diferente do `tp=|446973636F2064652076696E696C|`
  (texto "Disco de vinil" em hex) que a LeilõesBR usa na busca geral. Podem ser esquemas de
  categoria DIFERENTES (numérico por casa vs. texto/hex da plataforma). **Ferramenta nível 4**
  (`findLotByCategory`, `step=findlotcat&idLeilao=<...>&tp=<...>&pesquisa=<termo>`): testa
  qualquer `tp=` CRU (ex.: `|129|`) direto na busca geral da LeilõesBR — rodada com
  `tp=|129|&pesquisa=Ray Charles`, **não achou nada** (`matches: []`): o código numérico da
  casa NÃO é reconhecido como categoria pela busca geral da LeilõesBR (esquemas mesmo
  diferentes, confirmado). Também adicionada **ferramenta nível 3** (`findLotRawCard`,
  `step=findlotraw&idLeilao=<...>&pesquisa=<termo>&lockToVinyl=0|1`): devolve o HTML bruto do
  card que bate o idLeilao (truncado), útil se alguma hipótese futura exigir inspecionar o
  markup em vez de só os campos já extraídos por `parseCard` (que hoje não captura NENHUM
  campo de categoria) — ainda não usada.
  💡 **Saída encontrada pelo usuário (v0.69.35, plano em `docs/notas-desenvolvimento.md`
  aprovado)**: ao navegar `busca_andamento.asp?tp=<vinil>` sem `pesquisa`, a página mostra uma
  seção **"GALERIAS"** — checkboxes com CADA CASA que tem itens na categoria filtrada, cada
  uma com um código `ga=<n>` que filtra `busca_andamento.asp?ga=<n>&tp=<vinil>` só pra aquela
  casa. Isolando o problema: o gap é PURAMENTE de descoberta — `fetchCatalogData(domain,
  idLeilao)` (`leiloesbr-catalog.server.ts`, já existente, usada por `enrich`/`condition`/
  `sales`) já busca o catálogo INTEIRO de um leilão conhecido tentando `Tipo=129` (o mesmo
  "129" que a casa usa!) e caindo pro catálogo completo se vier vazio (v0.34.0) — ou seja, uma
  vez que a gente SAIBA que o leilão 65152 existe, o pipeline de extração já funciona; só falta
  descobrir o `idLeilao` quando a categoria da LeilõesBR não bate. Adicionadas duas ferramentas
  de diagnóstico (Fase 1 do plano, ainda não validadas contra produção): `listGalleries(tp)` /
  `step=galleries[&tp=<...>|tp=none]` — tenta extrair a seção GALERIAS (best-effort, a
  estrutura exata do HTML nunca foi inspecionada neste ambiente sem rede; sempre devolve
  também um `rawSnippet` do HTML bruto ao redor da palavra "galeria" pra ajustar o parser com
  dado real) — e `step=catalogdebug&domain=<...>&idLeilao=<...>`, que chama
  `fetchCatalogData` direto com parâmetros arbitrários (isola "descoberta" de "extração": se
  `catalogdebug` pro leilão 65152 trouxer os ~319 itens certos, confirma que só falta a
  descoberta). Próximo passo: rodar `step=galleries&tp=|446973636F2064652076696E696C|` em
  produção, ler o `rawSnippet`, confirmar/ajustar o parser e checar se "Coisa Antiga Leilões"
  aparece na lista — reportar ao usuário e AGUARDAR antes de implementar a Fase 2 (enumeração
  por galeria).
  ✅ **Rodado em produção (v0.69.35)**: `galleries: []` (parser heurístico por regex não achou
  NADA), mas o `rawSnippet` devolvido confirmou a estrutura REAL do HTML — um
  `<ul id="comboGalerias">` com um `<li class="lista-subcats-item">` por galeria, cada um com
  `<input type="checkbox" class="ga" value="<código>" name="gaval" id="ga<n>">` e um
  `<label for="ga<n>">Nome da Casa</label>` num `<div>` IRMÃO (não aninhado dentro do mesmo
  elemento do checkbox) — por isso o regex antigo, que só olhava o primeiro `>texto<` logo
  após o `<input>`, sempre batia em espaço em branco entre tags e descartava todas as
  galerias. Lista alfabética confirmada visível no trecho: Abreu Colecionismo (546), Alberto
  Lopes - Leiloeiro Público (199), Antiguera Leilões (610), Antiques MP (886), Bastos Leilões
  (536), Baú das Antiguidades (1032), Baú do Gordo (1093), Bolorini Leilões (166), Brechó Chic
  Leilões (306), Bruce Angeiras Leilões (299), Catavento Discos (662)... — "Coisa Antiga
  Leilões" ainda não apareceu no trecho de 6000 chars devolvido (a lista é alfabética e o corte
  ficou na letra C antes de chegar em "Coisa"), não confirma ausência.
  🔧 **v0.69.36**: `listGalleries` reescrita pra usar `node-html-parser`
  (`querySelectorAll`/`querySelector`, o mesmo parser já usado por `parseCard`/`parseCards`
  neste arquivo) em vez de regex — busca `#comboGalerias li` (com fallback pra
  `.lista-subcats-item` caso o id mude), extrai `input[type="checkbox"][value]` e `label` de
  cada item, independente de espaço/ordem de atributos entre os dois. `rawSnippet` aumentado
  para 8000 chars. Ainda não validado em produção — próximo passo: rodar
  `step=galleries&tp=|446973636F2064652076696E696C|` de novo e conferir se agora vem a lista
  completa de galerias com "Coisa Antiga Leilões" nela.
  ✅ **Rodado em produção (v0.69.36)**: parser DOM funcionou — **68 galerias** extraídas, e
  **"Coisa Antiga Leilões" está na lista, código `356`** (`ga=356`). Confirma a hipótese sem
  precisar cair pra `tp=none`: mesmo com a categoria "Disco de Vinil" travada, a seção
  GALERIAS lista essa casa (o mismatch de categorização é só nos ITENS dela, não na
  listagem de galerias em si).
  🔧 **v0.69.37 (Fase 2 — enumeração por galeria)**: ao planejar a extração pós-descoberta,
  achado que `fetchCatalogData` (a função original pensada pra isso) NÃO serve — devolve
  `Map<idPeca, CatalogLot>` sem `image`/`price`/`dayKey`/`artist` (foi desenhada só pra
  ENRIQUECER lotes já existentes com nº de lote e dados de venda, não pra criar `VinylLot`s
  novos do zero). Abordagem mais inteligente adotada: reaproveitar `fetchPageSearch`/
  `parseCards` (a MESMA função da listagem geral) paginando por `busca_andamento.asp?ga=<código>`
  em vez de por `tp=<categoria>` — devolve `VinylLot`s já completos, filtrados por TÍTULO
  (`looksNonVinyl`, mesmo critério de `scrapeVinylChunk`) em vez de por tag da plataforma,
  sidestepando o gap de categorização por completo. Adicionado:
  - `listUrlSearch`/`fetchPageSearch` ganham parâmetro opcional `ga` (`leiloesbr-scrape.server.ts`).
  - `listGalleryAuctions(galleryCode)`: pagina `ga=<código>` (sem travar `tp=`), filtra por
    `looksNonVinyl` + janela de dias, devolve `VinylLot[]` prontos pra `persistLots`.
  - `scanGalleries(offset, count, tp?)`/`step=galleryscan&offset=<n>&count=<n>[&tp=<...>|tp=none]`:
    chunked como `step=chunk`/`step=enrich` (cursor `offset` no servidor), varre `count`
    galerias por chamada, persiste os lotes achados a cada bloco (`persistLots`, merge/upsert
    de sempre). Ainda não testado em produção.
  Próximo passo: testar `step=galleryscan` isolado (via `debug-cron.yml`) contra a galeria da
  "Coisa Antiga Leilões" (`ga=356`) especificamente, conferindo se o leilão 65152 aparece com
  ~319 lotes e campos completos — só depois disso considerar adicionar ao `refresh.yml`.
  ✅ **Teste isolado rodado em produção (v0.69.37)**: `step=galleryscan&offset=14&count=1`
  (índice 14 = "Coisa Antiga Leilões", confirmado estável entre duas chamadas de
  `step=galleries`) achou **323 lotes** dessa casa — bate com os ~319 que o usuário viu
  marcados "Disco de vinil" no catálogo dela — com `persisted:true`. `step=findlot2` no
  leilão 65152 (o caso original) confirma o item saudável. Descoberta por galeria validada
  fim a fim.
  🏁 **v0.69.40 — integrado ao `refresh.yml`**: nova seção `step=galleryscan` (chunked,
  `offset`/`count=3`, mesmo padrão de `chunk`/`enrich`) adicionada ao `refresh.yml`, logo
  APÓS "Varredura em blocos" e ANTES de "Preenchimento de nº de lote" — os lotes descobertos
  por galeria entram na mesma passada de `enrich`/`sales`/`condition` que já roda depois, sem
  lógica nova ali. Passa a rodar junto com o resto do cron. 🔄 **v0.69.41**: `workflow_dispatch`
  completo disparado manualmente em produção pra validar o ciclo real (rodando no momento deste
  commit) — investigação considerada **encerrada** a pedido do usuário; se essa run acusar
  `persisted:false` em `galleryscan`, reabrir.
  🔁 **Reaberta em v0.69.43**: usuário achou item de OUTRA categoria (miniatura de coleção, via
  a casa "Alberto Lopes - Leiloeiro Público") entrando pelo `galleryscan` num leilão sem
  NENHUM item de disco no catálogo da própria casa — a validação de v0.69.40 só tinha testado
  contra uma casa DEDICADA a vinil (Coisa Antiga Leilões), nunca contra uma casa generalista
  ("leiloeiro de tudo"), que é justamente o caso em que a falta de trava de categoria (`tp=`)
  nesse caminho dói. Fix: `listGalleryAuctions` trocou `looksNonVinyl` (lista de bloqueio,
  permissiva) por `isVinylTitle` (exige palavra de vinil no título) — ver linha da tabela de
  versões (v0.69.43) para o detalhe completo do porquê.

**Leilão de casa multi-dia sumia de um dia específico (resolvido em v0.69.41)**

- Usuário reportou: leilão 64791 (Robson Gini Leilões/Trem das 7, `tremdas7.com.br`, catálogo
  com "1º DIA" 21/9 e "2º DIA" 22/9) não aparecia na ferramenta no dia 1 (hoje), mesmo validado
  pelo usuário no catálogo da própria casa. Dias 22/23/24 (outros leilões da mesma casa)
  apareciam normalmente; dia 25 também estava faltando no momento do report.
- Diagnóstico (`step=findlot&q=64791`, 92 páginas da categoria "Disco de Vinil"): o leilão
  **é descoberto normalmente** (não é o gap de categorização das outras pendências) — mas
  **todos** os lotes achados vinham com `dayKey: 2026-09-22`, nenhum com `2026-09-21`. Causa:
  a listagem geral da LeilõesBR (`busca_andamento.asp`) **para de listar os lotes de um leilão
  assim que ele fica "ao vivo"** (comportamento já documentado em "Scraping do LeilõesBR",
  v0.51.4 — mesmo efeito que fazia vigiados "sumirem" ao terminar o leilão). O pregão do dia 1
  começava às 15h; a varredura das 14:10 (BRT) não pegou a tempo (catálogo publicado tarde
  demais pela casa) e, depois das 15h, o leilão simplesmente não aparece mais na fonte — não
  tem como redescobrir depois.
- ⚠️ **Não é remoção do nosso lado**: o upsert (`persistLots`) nunca apaga o que já foi
  capturado; um lote só some da janela por `pruneOutOfWindow` (fora dos dias da janela). O
  problema é 100% de **descoberta** — se o cron não escaneou o leilão antes dele ficar ao
  vivo, o lote nunca chega a entrar no banco (não há nada pra "manter visível").
- **Fix (v0.69.41)**: cron 2x/dia → **3x/dia, de 8 em 8h** (`refresh.yml`, `10 3,17 * * *` →
  `10 3,11,19 * * *`, BRT 00:10/08:10/16:10) — reduz a janela entre execuções, diminuindo a
  chance de um catálogo publicado perto do horário do pregão passar batido. Não elimina o gap
  por completo (uma casa pode publicar e já ficar ao vivo dentro do intervalo de 8h), mas é a
  mitigação direta sem reescrever a arquitetura de descoberta (que dependeria de saber o
  horário de cada pregão com antecedência, informação que só vem depois de já ter descoberto o
  leilão). Investigação encerrada a pedido do usuário — mitigação aplicada, sem necessidade de
  aprofundar mais.

  _(Itens mais antigos desta seção — lance pelo app, upload de foto em massa, peso da sondagem
  na nota e imagem pelo CDN do catálogo — foram **cancelados/descartados**.)_

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

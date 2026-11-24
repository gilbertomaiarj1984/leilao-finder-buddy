# UI — Cores, badges, busca e valores do lote

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Cores, badges e busca

- **Verde** = tenho lance e estou ganhando/arrematei (`bidIsWinning(status)` casa
  `venc|arremat|arrebat`). **Vermelho** = tenho lance mas coberto. **Amarelo** = só vigiado.
  Precedência: **lance vence vigia**. **Fúcsia** = "De olho" (v0.107.0: o lote marcado ou um lote
  futuro que casa com um disco marcado — ver `de-olho.md`); perde para lance e
  vigia. O ícone `Binoculars` fica na linha de ações do card, ao lado de Vigiar.
- **Ações otimistas em `/olho` (v0.151.1):** `updateMut`/`deleteMut` (olho.tsx) alteram o cache `lookoutOverview` em `onMutate` (rollback em erro) e só então `refresh()` refaz o cálculo pesado em segundo plano. v0.153.1: vínculos (✓/✕, "Descartar todas", mover lote) também são otimistas (`applyLookoutLinks`, `lookout-overview-patch.ts`). Juntar/separar/identificar/juntar artistas ainda esperam o servidor (artistas: `lookoutArtistKey` duplicada em `lookout.server.ts`/`lookout-match.ts`, impede o patch local simples).
- **Destaque de novos no "De olho" (v0.128.0):** em `/olho`, enquanto houver lote `isNew`
  (v0.132.1: o "visto" só é gravado — `markLookoutSeen` — ao clicar em "Marcar como vistos";
  abrir a página ou resolver outro lote com ✓/✕ não apaga os novos), aparece uma faixa no topo
  ("N artistas com lotes novos", botão "Marcar como vistos"), o
  cabeçalho do artista ganha fundo/linha fúcsia + selo "N novos", a contagem do disco fica em
  negrito fúcsia e cada lote novo no cartão ganha fundo/contorno fúcsia. Ordem nunca muda. Ao lado de cada artista há um botão "Voltar ao topo" (rola a página). Em cada lote por vir (exceto o de origem), o botão `+` abre um diálogo (artista/álbum/ano) que cria um disco de olho novo com aquele lote como origem (`toggleLookout`) e o liga a ele (`setLookoutLink`), tirando-o do disco antigo (v0.133.0).
- **Filtro por dia no De olho (v0.175.0):** faixa "Dia:" abaixo da busca em `/olho` com os próximos 10 dias (hoje + 9, `lookout-day-filter.ts`, dia local via `localDayKey`) + "Todos". Cada chip mostra a contagem de lotes por vir do dia (sempre a total, antes do filtro). Com um dia escolhido, `upcomingList` (e tudo derivado: `upcomingByItem`, contadores do topo, faixa de novos, "Marcar como vistos") passa a ter só os lotes daquele dia e discos/artistas sem lote nele saem da lista (inclusive a seção "Sem lote por vir"); `allUpcoming` guarda o conjunto completo (contagens dos chips e "Adquirido", que desvigia os lotes de todos os dias). Estado só em `useState` (não persiste: o dia envelhece).
- **v0.129.0:** `/olho` ordena em dois blocos (artistas com lote por vir; depois "sem lote por vir"; álbuns com lote primeiro dentro do artista). Arquivados ficam ocultos atrás de botão. A faixa de novos lista cada lote (`olho-item-<id>` é o alvo do scroll). Borda fúcsia só no disco com lote `isNew`; sem novo, `border-border`. Cabeçalho do artista: inicial em círculo + nome em negrito + linha grossa; álbuns recuados (`ml-11`) abaixo.
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
  - **Vencendo defasado (v0.151.2):** `effectiveBidStatus` (`vinyl-parse.ts`) troca "Vencendo" por "Coberto e Vendido" quando o valor de venda conhecido (`sold`) supera o meu lance (`myBid`); usado por `LotCard` e `lotCardState` (mobile). Não mexe em "Vencedor"/"Arrematado"/"Coberto" nem sem os dois valores numéricos.
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
    - próximos 4 dias") tratava `date` sempre como a data do LEILÃO — verdade para `WatchedLot`,
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
  lugar** (falso positivo é pior que faltar). **Desde a v0.86.0 a comparação é POR CAMPO** —
  artista com artista, álbum com álbum, em palavras inteiras — em vez do antigo "saco de
  palavras" (título + artista + álbum juntos, com substring: "arte" casava "parte", o artista
  citado como compositor valia como artista, "Clube da Esquina" casava "Clube da Esquina 2").
  `lotIdentity` passou a carregar, além do saco de palavras (ainda usado pela sondagem), os
  campos estruturados `titleWords`/`titleSegments` (título em ordem + trecho separado por
  " - "/"|"), `artists` (artista efetivo + "Artista" do álbum da IA e do release do Discogs,
  via `splitArtistAlbum`), `albums` (álbum da IA + título do release) e `bundle` (artista
  "Lote" → nada estruturado vale). O score (`ownedScore`) segue "um leva ao outro":
  1. **Artista primeiro** (`artistEvidence`): bate com um artista ESTRUTURADO do lote →
     `confirmed`; nomes aproximados porém bem relacionados (`artistsRelated`: ≥ 75% NOS DOIS
     sentidos, 1 letra de diferença a partir de 4 letras, ou um nome contido no outro com 2+
     palavras — "Elis Regina" ⊂ "Elis Regina & Tom Jobim"; "Milton Nascimento" × "Milton
     Banana" e "Queen" × "Queen Latifah" NÃO). Se o lote é de OUTRO artista o disco nem é
     avaliado (então, com artista confirmado, só os discos DELE disputam o lote); uma
     ocorrência dentro do nome desse outro artista não conta como citação. Sem artista
     estruturado (ou com os dois artistas citados no título — dueto/"X interpreta Y"), basta o
     nome como FRASE no título, mas o score fica limitado a **0.7 ("?")** — sem certeza do
     artista, nunca confiante.
  2. **Álbum depois, nos dois sentidos**: com álbum estruturado (`albumVsStructured`), os nomes
     precisam ter similaridade ≥ 75% (ou um contido no outro com 2+ palavras) e os MESMOS
     números de volume → 0.80–0.95; se o lote foi identificado como OUTRO disco → 0, mesmo que o
     nome apareça no texto (faixa, "contém…"); só um nome de 1 palavra contido no outro
     (subtítulo) → "?". Sem álbum estruturado (`albumInTitle`), o nome precisa estar no título
     como FRASE (palavras inteiras em ordem; entre elas só "enchimento" — "de"/"da"/genéricos,
     no máximo 2): num trecho próprio ("Artista - Álbum - LP") → 0.9; colado ao artista → 0.9
     (1 palavra: 0.75, 0.9 com ano exato); em outro ponto → 0.75/0.65 (+ano); espalhado → 0.6.
     Número logo depois da frase ("… 2", "Vol. 3") que o disco da coleção não tem invalida.
     Tokens do álbum descontam os do **artista** ("A Arte de Jorge Ben" → distintivo só "arte") e
     palavras **genéricas** (`GENERIC_ALBUM_TOKENS`: "ao vivo"/"sucessos"/formato/edição —
     "remasterizado", "deluxe", "vinil"…/estado/stopwords). Disco **homônimo** ("Djavan - Djavan")
     exige artista confirmado + álbum estruturado também homônimo (só com ano exato → "?"). Faixas:
     `>= OWNED_CONFIDENT_MIN` (80%) = ícone confiante; `>= OWNED_MATCH_MIN` (60%) = ícone **com
     "?"**; abaixo não marca. **Sem álbum → não marca** (só a peça exata por `lot_id`, score 1, no
     chamador). Desempenho: pré-filtro por índice de chaves (`fuzzyKeys`: palavra + variações com 1
     letra apagada, cache por identidade em `WeakMap`, chaves do artista pré-calculadas em
     `OwnedCandidate.artistKeys`) descarta de cara os discos cujo artista não aparece no lote.
     `ownedCands` ignora buckets Lote/Coletâneas/Não classificados; mapa `ownedById` memoizado;
     prop `owned: OwnedHit` no `LotCard`.
  - **Coletânea/ao vivo (título genérico)** casa pelo **nome + ano EXATO** (`ownedScore`
    separa tokens distintivos × genéricos; "Ao Vivo (1989)"/"Seus Sucessos (1978)"), sempre
    com o artista verificado antes (confiante só com artista estruturado).
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
    `removeCollectionFeedbackByLot`) + `collection.functions.ts` (`getCollectionLinks`/
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
  Implementação: `leiloesbr-lot-details.server.ts` (`fetchLotDetails`, concorrência 8, teto 100
  POR CHAMADA; campo lido por `loadDataField` — com ou sem aspas — e convertido por
  `parseLoadDataNumber`, que aceita "105", "105.00", "105,00", "1.050,00", "1,050.00") →
  `getLotDetails` → queries `["lot-details", <ids do bloco>]` via `useQueries` (`staleTime` 3min,
  `refetchOnMount: "always"`). Não persiste (busca ao vivo, cache curto).
- **Fatiamento/prioridade (v0.88.0):** os vigiados ACUMULAM (`watched-accum`, incluem dias já
  passados) — com ~180 vigiados + lances, o teto de 100 do servidor cortava lotes arbitrários
  (inclusive de hoje) e o card ficava sem "Próximo". Agora o cliente ORDENA os alvos (pregões de
  hoje/próximos primeiro, do mais cedo pro mais tarde; depois os passados, do mais recente pro
  mais antigo) e busca em blocos de `LOT_DETAILS_CHUNK`=50, 1 query por bloco (`combine` junta
  num mapa por `id`). Lance sem dia na varredura (lote sumiu dela porque o pregão está AO VIVO;
  `b.date` é a data do LANCE, não do pregão) conta como pregão de hoje.
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

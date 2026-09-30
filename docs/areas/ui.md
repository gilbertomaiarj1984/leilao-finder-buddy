# Páginas, UI, cores/badges/busca e valores do lote

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

> **Onde está o código da home (v0.88.4):** as menções a "`index.tsx`" abaixo são históricas —
> a rota só compõe a tela; estado/queries/derivações/mutações estão em
> `src/components/vinyl/dashboard/use-dashboard-data.tsx` e cada parte em
> `dashboard/{dashboard-header,day-tab,watched-tab,bids-tab,lot-search-box}.tsx`. Queries
> compartilhadas entre telas: `src/lib/queries.ts`.

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
  (Ao desvigiar, o toast "Vigia removida" fica 5 s com ação "Desfazer" que revigia o lote.)
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
- **Vigiados por artista — corrigir artista e mover lote (v0.98.0; reverte o "álbum" do v0.97.0):**
  `groupWatchedByArtist(lots, curation)` (`curation` = `artists`/`sales` de `getAnalyticsAliases`,
  via `useAnalyticsAliasesQuery`) agrupa por artista e já aplica a correção por lote
  (`sales[lot.id].artist`). **Corrigir artista** (`WatchedArtistDialog`): escolher um destino LEVA o
  artista editado para o selecionado (alias das chaves de origem → nome do destino); sem destino,
  só renomeia. **Mover lote** (`WatchedLotDialog`, botão na barra do card via `LotCard`
  `origin.onMove`): destino da lista ou digitado; grava `sales[lot.id]` com
  `setAnalyticsSaleOverrides` (lote único numa leitura-e-escrita; preserva o álbum já corrigido);
  também aparece no Analytics; "Desfazer correção" remove. **Arrastar** (HTML5 DnD; não funciona em
  touch — use o botão/lápis): artista ou card de lote sobre o cabeçalho de outro artista →
  `ConfirmMoveDialog` → mesma ação. Durante o arrastar, `useDragAutoScroll` rola a janela quando o
  ponteiro chega a ~90px do topo/rodapé (v0.98.1). Não há subgrupo de álbum em Vigiados.
- **Vigiados — visão "Por artista" (v0.95.0):** `watched-tab.tsx` tem seletor de visão ("Por casa"
  = a de cima, padrão; "Por artista"), estado local (`view`). Por artista: `groupWatchedByArtist`
  (`grouping.ts`) — artistas alfabéticos, baldes genéricos no fim, lotes por **casa → data →
  horário → lote**; o filtro de dia segue `catalogHasDay` (catálogo multi-dia aparece em todos os
  dias). Cada `LotCard` recebe `origin` (casa, pregão = `idLeilao`, dias do catálogo inteiro via
  `daysRangeLabel`, badge multi-dia) e desenha uma **barra superior** amarela (vigiando), verde
  (ganhando) ou vermelha (coberto), mesma regra de cor da borda. Abaixo do cabeçalho do artista, faixa "Pregões envolvidos" (uma linha por casa+`idLeilao`: pregão, dias/multi-dia, `AuctionStatusInline`, `PresencialOrUnsoldLink`, ver catálogo). Seção do artista sempre
  recolhível; **lápis** → `WatchedArtistDialog` (renomear/juntar/desfazer) gravando nos MESMOS apelidos do
  Analytics (`analytics_artist_aliases`, `setAnalyticsArtistAlias`/`clearAnalyticsAlias`, escrita
  otimista em `queryKeys.analyticsAliases`; v0.96.0); chaves de abrir/fechar: `watched|artista|<chave do artista>`.
- **Aba Vigiados por casa → catálogo, com organizador por dia (v0.94.0):** `watched-tab.tsx`
  não agrupa mais por dia → casa. Agora é **casa → catálogo (`idLeilao`)**
  (`groupWatchedByHouseCatalog`, `grouping.ts`). Casa com **mais de um catálogo** mostra um
  sub-cabeçalho por catálogo ("Catálogo N", nº de lotes, dias, status/pregão presencial, "ver
  catálogo"), cada um abrindo/fechando; casa com um catálogo só mantém o cabeçalho único de
  antes (status, presencial, "site da casa"). Casas também abrem/fecham; "Abrir todas"/"Fechar
  todas" agem em casas e catálogos visíveis (estado em `closedHouseSections`, chaves
  `watched|<casa>` e `watched|<casa>|<idLeilao>`; `openAllHouseSections` é o inverso do
  `closeAllHouseSections`). **Organizador por dia**: chips "Todos" + os dias que têm vigiados
  (contagem de lotes); escolher um dia mostra as casas/catálogos que **passam** por ele
  (`catalogHasDay`) — catálogo **multi-dia** (lotes vigiados em datas diferentes, mesmo
  `idLeilao`) aparece em todos os dias que atravessa, sempre com TODOS os seus lotes vigiados
  (badge "multi-dia" + "01/10 a 03/10"). Status do catálogo (`catalogAuctionInfo`): "ao vivo"
  desde o início do 1º dia; "encerrado" só 3h depois do último horário do último dia. O título
  do catálogo é só "Catálogo <idLeilao>" (o nome do leilão não é capturado). Filtro de dia é
  estado local (volta a "Todos" ao trocar de aba). `watchedDayOpen` (abertura por dia) foi removido.
- **Split do `index.tsx`:** lógica em `src/components/vinyl/` — `grouping.ts` (puros + tipos),
  `badges.tsx`, `filters.tsx`, `lot-card.tsx`, `bid-house-sections.tsx`, `live-auctions.tsx`,
  `ai-score.tsx` (UI) + `ai-score-utils.ts` (puros/client-safe — `parseAiAlbum`/`formatAiAlbum`,
  rarity legend, `LotMarket`/`toLotMarket`, `buildInterestMatcher`). Helpers puros/UI ficam em
  arquivos `.ts`/`.tsx` separados por causa do react-refresh (o especificador resolve `.ts`
  antes de `.tsx` — nomes não podem colidir).

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

## Lotes sem lance ao fim do pregão + saída de "Acontecendo agora" (v0.89.0)

Reaproveita o mesmo dado de `getPresencialNow` (`peça atual`/`total`) como sinal PRECISO de que
os lotes de uma casa acabaram (`peca >= total`) — bem mais confiável que a janela de 3h
(`auctionFinished`), que continua intacta e só serve `captureFinishedSales`/badge "Encerrado".
Hook compartilhado `usePresencialNow(url)` (`src/components/vinyl/use-presencial-now.ts`),
mesmo `useQuery`/`queryKey ["presencial-now", url]` de `LiveLotNow`/`HouseInfoLine` (dedup entre
telas), com `isFinished` derivado.

- **Link "pregão presencial" → "lotes sem lance":** nas linhas de casa que hoje mostram o link
  (dia principal e Vigiados do dia em `day-tab.tsx`, aba Vigiados global em `watched-tab.tsx`),
  o link vira `PresencialOrUnsoldLink` (`src/components/vinyl/presencial-or-unsold-link.tsx`):
  sem sinal de fim, mostra o link de sempre; com `isFinished`, mostra "lotes sem lance", cuja
  contagem/lista vem de `getUnsoldLots` (buscada assim que `isFinished`, ver fix abaixo).
  `HouseAuctionInfo`/`houseAuctionInfo` (`grouping.ts`) ganham o campo `idLeilao` (já disponível
  no lote) para a nova server function.
  ⚠️ **Fix (mesma versão) — sinal preciso sozinho não disparava na prática**: achado do
  usuário (casa com badge "Encerrado" mas o link continuava "pregão presencial") — quando o
  pregão termina de verdade, o polling do presencial (`getPresencialNow`) costuma **parar de
  responder** (`now` vira `null` de novo) em vez de ficar parado em "peça = total", então o
  sinal preciso sozinho quase nunca chega a `isFinished=true`. `PresencialOrUnsoldLink` ganhou
  a prop `statusEnded` (= `auctionInfo.status === "ended"`, a mesma heurística de 3h do badge
  "Encerrado") como FALLBACK: `isFinished = presencialFinished || statusEnded`.
  ⚠️ **Fix (v0.89.2) — lista em texto puro, sem o total de lotes**: achado do usuário — a lista
  era uma sequência de links em texto (sem o visual de card do resto do app) e não mostrava
  quantos lotes o leilão teve ao todo. `getUnsoldLotsForAuction` passa a devolver
  `{ lots, total }` (`total` = `catalog.size`, todos os lotes do catálogo, vendidos + sem
  lance); o botão mostra "lotes sem lance (N de total)" — já buscado assim que `isFinished`
  fica `true` (não só ao expandir, `enabled: isFinished`), pro total aparecer sem precisar
  clicar. A lista expandida virou grade de `UnsoldLotCard` (mesmo componente local, espírito
  visual do `LotCard` — imagem, badge do nº do lote, artista/título — sem os controles de
  vigiar/lance, que não fazem sentido com o pregão já encerrado).
- **Servidor — `getUnsoldLotsForAuction`** (`src/lib/unsold-lots.server.ts`, exposta como
  `getUnsoldLots` em `leiloesbr.functions.ts`): busca o catálogo da casa sob demanda
  (`fetchCatalogData`, mesma fonte de `captureFinishedSales`) e devolve o INVERSO do filtro de
  vendas — lotes sem `sold`. Sem persistência — cache em memória com TTL de 5 min (mesmo
  espírito de `leiloesbr-presencial.server.ts`) só para não bater o catálogo repetidamente se o
  usuário abrir/fechar a lista.
  ⚠️ **Fix (v0.89.3) — trazia lotes de OUTRO dia**: achado do usuário — em casas cujo "leilão"
  se estende por mais de um dia (mesmo `idLeilao`, dias diferentes), o catálogo
  (`catalogo.asp?Num=<idLeilao>`) traz TODOS os lotes do leilão inteiro, não só os do dia da
  linha que o usuário está vendo; o catálogo não traz a data de cada lote. Único jeito
  confiável de restringir ao dia certo: cruzar com a tabela `lots` (que grava `day_key` por
  lote, da varredura geral) filtrando por `id_leilao` E `day_key` — `getUnsoldLotsForAuction`
  ganha o parâmetro `dayKey` (de `HouseAuctionInfo.dayKey`, novo campo, já era o parâmetro de
  entrada de `houseAuctionInfo`) e só inclui lotes do catálogo com correspondência CONHECIDA
  pro dia pedido; sem correspondência (lote nunca varrido, fora da janela) fica de fora tanto
  do total quanto da lista — troca completude por certeza de estar no dia certo. Como
  consequência, os filtros de identidade "desconhecido mas parece vinil" (`looksVinyl`,
  `looksNonVinylSale`) saíram — todo lote incluído já vem de um lote CONHECIDO (só a `lots`
  guarda vinil identificado), então o filtro extra virou redundante.
- **"Acontecendo agora" some a casa ao terminar:** `LiveAuctions` (`live-auctions.tsx`) consulta
  `getPresencialNow` de TODAS as casas listadas (`useQueries`, mesma `queryKey`/config de
  `usePresencialNow` — dedup com as outras telas) e filtra da grade qualquer casa com sinal
  preciso de fim OU `auction.status === "ended"` (mesmo fallback de 3h acima) OU override
  manual (abaixo), incluindo no contador do cabeçalho. A casa continua disponível o dia inteiro
  na aba principal por dia e em `/ao-vivo` (que listam por `day_key`, não pela janela de 3h de
  `listLiveAuctions`) — só o card "Acontecendo agora" (que é temporário) esconde.
- **Sem NENHUM sinal automático de fim** (nem presencial nem heurística de 3h): comportamento
  idêntico ao de antes desta versão — MAS ver override manual abaixo (v0.89.4).

### Override manual — "marcar pregão como encerrado" (v0.89.4)

Achado do usuário: uma casa com **131 lotes** terminou o pregão bem antes das 3h (comum — um
pregão roda ~40s/lote), e ficou sem NENHUM sinal de fim: o preciso (`peça = total`) não
disparou (mesma suspeita de sempre — o polling provavelmente já não respondia mais, mas sem
como confirmar nesta rede) e a heurística de 3h ainda não tinha passado. Sem rede real para as
casas de leilão neste ambiente (ver `CLAUDE.md`), não dá pra melhorar o sinal preciso por
análise estática — então, em vez de mais uma heurística de horário, o usuário ganha um botão
pra confirmar o que só ELE pode saber com certeza nesse intervalo.

- **`src/lib/manually-finished-auctions.ts`** (puro/client-safe, só `localStorage`):
  `isManuallyFinished(idLeilao, dayKey)`/`markManuallyFinished(idLeilao, dayKey)` — guarda
  `{"idLeilao:dayKey": timestamp}`, podado a cada leitura (`MAX_AGE_MS` = 24h) pra não crescer
  sem limite. Sem servidor, sem sincronizar entre dispositivos — é uma confirmação pontual do
  que o usuário está vendo na tela dele agora.
- **`src/components/vinyl/use-manually-finished.ts`**: `useManuallyFinished(idLeilao, dayKey)`
  — versão reativa (`useState` hidratado do storage) pra re-renderizar a UI na hora do clique,
  sem esperar reload.
- **UI**: `PresencialOrUnsoldLink` ganha um botãozinho (ícone `Flag`) ao lado do link "pregão
  presencial", visível só enquanto `!isFinished`. Mesmo override consultado (função pura, sem
  hook — não dá pra chamar hook dentro de `.map`) no filtro de `LiveAuctions`
  (`live-auctions.tsx`), pra também sumir de "Acontecendo agora" assim que marcado.
  ⚠️ **Fix (v0.90.1) — vazava pra dias futuros da mesma casa**: achado do usuário — casa cujo
  catálogo se estende por mais de um dia (mesmo `idLeilao`) tinha "lotes sem lance" habilitado
  também na linha de um dia **futuro que nem começou** ("Em breve"). Duas causas, a mesma raiz
  de sempre (o `idLeilao` não distingue dias): (1) a chave do override manual era só `idLeilao`
  — corrigida pra `idLeilao:dayKey` acima; (2) o sinal preciso (`usePresencialNow`) usa a MESMA
  `presencialUrl` (sem dia embutido) pra todos os dias da casa, então um "peça = total" de HOJE
  também valia pro dia de amanhã. Fix definitivo: `PresencialOrUnsoldLink` passa a receber
  `status` (`HouseAuctionInfo.status`, era só `statusEnded`) e `isFinished` agora exige
  `status !== "upcoming"` ANTES de considerar qualquer um dos três sinais — um dia que ainda
  não começou nunca é tratado como terminado, não importa o que os sinais compartilhados
  digam.

## Painel de mudanças — DESCONTINUADO (v0.25.0)

A página **`/dashboard`** foi removida (home/Análise/Ao vivo cobrem o uso). Chave órfã
`dashboard_baseline` em `app_state` pode ser apagada à mão. O `enrichLotes` (nº de lote)
segue existindo, usado pela home ("Atualizar tudo" — desde v0.84.0 também roda `galleryscan`/
`condition`/`aiident`, ver histórico de versões).

- **Barra de dias (home):** exibe 5 dias por vez; setas ‹ › nas pontas paginam de 5 em 5 (estado local `dayOffset` em `dashboard-header.tsx`). Vigiados/Lances ficam sempre visíveis.

- **Histórico e dias futuros (v0.92.0):** `lots` retém hoje-10..hoje+14 (`pruneOutOfWindow`, constantes em `src/lib/day-bar.ts`). Hoje..+4 seguem varridos 4×/dia (`refresh.yml`); +5..+14 só 1×/dia às 02:00 BRT (`refresh-extended.yml`: `step=chunk&ext=1` e `step=enrich&ext=1`, mesmo `concurrency.group`). Histórico é só o que já estava gravado (nunca re-varrido; começa a acumular a partir do deploy). A barra de dias tem 25 dias em 5 páginas de 5 (`dayPage`, abre em hoje); páginas fora de hoje..+4 vêm sob demanda de `getVinylLotsRange` (`useLotsRangeQueries`) e são mescladas em `lots.data`. Dia passado abre mostrando finalizados e sem o botão de atualizar.

- **Cores e "Hoje" (v0.93.0):** abas de dias passados em amarelo, futuros em azul (`dashboard-header.tsx`); botão "Hoje" ao lado da seta direita volta para a página de hoje e seleciona a aba de hoje.

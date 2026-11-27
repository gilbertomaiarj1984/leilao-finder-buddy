# Páginas e telas (UI)

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

> Outras páginas da UI: `ui-agendamentos.md`, `ui-lotes-cores-busca.md`, `ui-pregao-ao-vivo.md`, `ui-desempenho-e-estado.md`, `ui-mobile-pwa.md`, `ui-painel-ia.md`. Histórico de telas descontinuadas: `docs/arquivo/ui-historico.md`.

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
- **"Vigiados do dia" descontinuado (v0.200.0):** a visão por dia (botão na barra do dia, chip no cabeçalho mobile, estado `watchedViewDay`) foi removida; a barra do dia mostra só o texto não clicável "N vigiados hoje/neste dia" (`watchedForDay.length`, `day-tab.tsx`). A aba **Vigiados** global (por dia ou geral) é a única tela de vigiados; menções históricas a "Vigiados do dia" nesta página descrevem o comportamento anterior.
- **Lista copiável por casa (v0.188.0):** `HouseLotListButton` (`components/vinyl/house-lot-list.tsx`) fica ao lado de "pregão presencial" na linha da casa (dia principal, visão Vigiados do dia, aba Vigiados; também por catálogo quando a casa tem vários). Recebe os lotes JÁ filtrados da tela e monta o texto sob demanda (`lib/house-lot-list.ts`, puro): `Lote | Artista — Álbum | próximo lance X (ou "1º lance X (SEM LANCE)") | Estado | trecho`. "Sem lance" = `noBid.ids` (filtro verde ligado) ou `demand.bids === 0`; trecho = `ai.reason`, senão `condition.raw`, senão o título. Não existe na visão "Lances" (sem link de pregão ali).
- **Exportar dia (v0.189.0):** `DayLotListButton` fica no rodapé do painel flutuante de casas (`HouseNav`, só desktop ≥2xl; o `DayTab` ativo entra por portal em `navFooterHost`). Junta os lotes de todas as casas do dia com os mesmos filtros da grade (inclui artista/valor por casa via `filterHouseLots` e "sem lance"), uma seção por casa (`formatDayList`). Não aparece nas visões Vigiados/Lances/Não vendidos nem no celular.
- **`index.tsx` (site principal):** cards por **dia → casa → artista**. `LotCard` mostra nota
  da IA no canto **direito** (`ScoreCorner`), nº do lote no canto **esquerdo**, e o `album` da
  IA ("Artista — Álbum (Ano)", `formatAiAlbum`) **acima** do título. Álbum resolvido por lote =
  `lot_ai.album ?? lot_ident.album` (mapas `albumById` memoizados por assinatura estável para
  não disparar o casamento pesado da sondagem ao editar tag). `effectiveArtist` usa
  `isDiscBundle` → grupo **"Lote"** para conjuntos ("lote com N discos"), senão o artista da IA
  (`parseAiAlbum`), senão o heurístico do título. Header com links **Análise** / **Ao vivo**.
- **Análise de Lotes — lista única (v0.158.0, fase 1 da remodelagem):** a descrição "dois Tops" abaixo é
  histórica. Hoje a página é UMA lista com todos os lotes avaliados (blocos de 30 + "Mostrar mais"):
  - **Linha** (`components/vinyl/analise/lot-row.tsx`): capa, nota (`ScoreBadge`), título/álbum, estado
    **vigia/lance sempre explícito** (pílulas "Vigiando" e "Ganhando"/"Coberto" + borda de `rowStatusTone`),
    oportunidade, raridade, estado do disco/capa (`ConditionBadges`), "já tenho" (Coleção), 🎯 De olho,
    ⭐ interesse, 🔥 procurado (want ÷ have), nº de lances do catálogo, semáforo + UF da casa e "casa mal
    avaliada"; à direita a **conta do lance** (`lotEconomics`, `lot-score.ts`): lance + frete, mercado na
    condição do disco, **teto barato** (≤ 70% do mercado) e **potencial** (mercado − custo), mais a faixa
    Discogs BR. Visualizações **Lista** e **Cards**.
  - **Filtros novos:** Vigiados, oportunidade (barato/justo/caro), disco mínimo (sem estado conhecido não
    passa), custo total até, ocultar já tenho (só casamento confiante), ocultar casas ruins (laranja/vermelho),
    só com mercado — somados aos antigos (busca, casa, raridade, nota, Com lance, Só De olho, dias).
  - **Ordenação** (`analise-rank.ts`): nota da IA, melhor negócio (custo ÷ mercado), potencial em R$, horário
    do pregão, procura. Empates caem na nota. **Ordenação e visualização escolhidas ficam salvas** como padrão
    (`analise-sort`, `analise-view`, via `usePersistedState`).
  - **`useLotInsights(lots)`** (`src/lib/use-lot-insights.ts`): um `Map` id → `LotInsight` (nota, álbum,
    mercado ancorado, condição, demanda, Coleção, De olho, nível da casa). Nasceu da consolidação pedida em
    `docs/pendencias.md`; as peças puras (estado, demanda, identidade, "já tenho") ficam em `src/lib/lot-insight-build.ts` e são as mesmas da home (v0.164.0), que mantém só as queries escopadas e os acessores por lote. Desde a v0.166.0 o hook lê as tabelas por lote em `core`/`rest` (`useHomeLot*Query`), dividindo o cache com a home.
  - **Fase 2 (v0.159.0):** faixa de **visões prontas** com contagem (Garimpo do dia, Pechinchas, Raros,
    Meu radar, Vigiados e lances — `PRESETS` em `analise-rank.ts`, calculadas sobre todos os lotes avaliados; a
    escolhida fica salva em `analise-preset` e soma-se aos filtros); visualização **Por casa** (agrupa o bloco
    visível por casa, com semáforo/UF e a melhor nota); painel **"Por que esta nota"** em cada linha
    (`lot-detail.tsx`: evidências com tom verde/amarelo/vermelho de `buildEvidence`, a conta do lance completa com
    os dois tetos, vendas passadas + link «ver no Analytics», tracklist e link do lote); **barra de faixa de preço**
    (`price-range-bar.tsx`: menor–maior vendido, mediana e o custo de hoje); no celular os filtros ficam
    recolhidos (`analise-filters-open`). As vendas passadas vêm de **uma chamada só** (`getPastSalesBulk` →
    `usePastSalesBulk`, até 800 ids; mesma conta de `getLotPastSales`).
  - **Fase 3 (v0.160.0):** **cobertura da IA** (`coverage-bar.tsx`: % de lotes da janela com nota, calculado no
    cliente — `lot_ai` sem score conta como pendente; pode subestimar o que o servidor vai reavaliar por mudança
    de título/prompt) com **"Analisar pendentes"** (`useAnalyzeScope().analyzeDays`, `use-ai-actions.ts`: o mesmo
    laço de `analyzeOnDemand` da home — 25 lotes por chamada, provedor do topo, failover nos toasts — por dia, em
    sequência; escopo = dia escolhido, "Dias Futuros" ou, em "Todos", de hoje em diante). A home passou a usar o
    mesmo hook (`analyzeScope`). **Nota defasada**: pílula na linha quando `priceRoseSinceEval(eval_price,
preço atual)` (só com `eval_price` gravado) e botão **"Reavaliar defasadas"** (`useRepriceLots` →
    `repriceLotAi`, 10 por chamada; o servidor reconfere e respeita o modo "off"). **Horário e andamento do
    pregão** (`analise-time.ts`, `use-auction-progress.ts`): chip "começa em N min" (≤ 24 h; ≤ 30 min fica
    amarelo), "ao vivo · lote 41/120 · faltam 47", "já passou", "pregão encerrado" — o início vem do horário
    da casa (relógio `useNow`, 1 min) e o andamento de UMA consulta `getPresencialNow` por pregão de hoje já
    iniciado dentre os lotes visíveis (mesma chave `["presencial-now", url]` da home e da visão "Sem lance");
    casas fora da plataforma ficam sem andamento ("ao vivo" só nas 6 h seguintes ao início). Nova visão pronta
    **"Começando logo"** (começa em até 2 h ou começou há menos de 3 h).
  - **Fase 4 (v0.161.0):** **índice de garimpo** (experimental, `garimpoIndex` em `lot-score.ts`, testado): 0–100 =
    negócio 35 (custo ÷ mercado: ≤ 50% vale tudo, ≥ 115% zera) + nota da IA 25 + estado do disco 15 + procura
    (want ÷ have, 3× = máximo) 15 + semáforo da casa 10; parte sem dado fica neutra e marcada "sem dado"; disco já
    na Coleção vale metade. Aparece como pílula "Garimpo N" na linha, com as partes no painel "Por que esta nota",
    e como ordenação "Índice de garimpo" — NÃO substitui a nota da IA. **Aviso de pregão começando**
    (`watch-alerts.ts`/`.server.ts`, step `watchalert`, workflow `watch-alert.yml` a cada 15 min entre 8h e
    23h45 de Brasília, fora do grupo de concorrência das varreduras): Web Push quando o pregão de um lote
    **vigiado** começa em até 30 min (tolera 10 min de atraso do agendador), um aviso por pregão com os lotes,
    dedupe em `app_state.watch_start_notified` (`idLeilao|dia`, gravado só depois do envio); no-op sem VAPID_*
    ou sem aparelho inscrito.
  - **Valor real do lote, frete à parte (v0.162.0):** na Análise o lote vale o que se paga por ele — a conta
    (`lotEconomics`, `lot-score.ts`) NÃO soma o frete do leilão: o **valor do lote** aparece
    grande e o **frete estimado** (UF, painel de IA) logo abaixo, só informativo. O frete entra do lado do
    **Discogs**: referência = preço do disco (âncora da condição) **+ frete do vendedor** (vendedores embutem
    margem no frete); a faixa BR, que já é total com frete, não soma de novo. Tetos barato/justo, potencial,
    filtro "Valor do lote até", índice de garimpo e a barra de vendas passadas (valor do lote × valores de venda)
    usam o valor do lote. **Regra única (v0.167.0):** a mesma conta vale na home, nos e-mails/avisos, na calibração
    e no contexto do prompt da IA; a **comissão do leiloeiro** (sempre 5%) aparece à parte, como o frete, e não
    entra na conta.
  - **Dias, lotes que fazem sentido e possível lixo (v0.163.0):** a barra de dias da Análise tem a MESMA
    quantidade da home à frente — **hoje + 14 dias**, em páginas de 5 com setas, mais "Dias Futuros" (depois
    do último dia) — e **sem histórico** (`use-analise-lots.ts`: janela padrão da varredura + 2 páginas do banco + o
    que passa do último dia, com `beyond: true` em `getVinylLotsRange`, que não corta em hoje+14). Lotes
    **vigiados, com lance e do De olho entram sempre**, mesmo futuros e mesmo fora do banco (montados a partir
    da conta). Só aparecem lotes que **ainda fazem sentido**: saem — mesmo vigiados — os de dia anterior a hoje,
    lance com resultado final ("Vendido", "Vencedor", "Arrematado", "Não vendido"), pregão encerrado e
    pregão em andamento que já passou do lote (`lotIsClosed`, `analise-time.ts`; andamento do presencial de
    todas as casas de hoje, uma consulta por pregão); a nota "N lote(s) já encerrado(s)… mostrar" reexibe
    (`analise-show-closed`). **Possível lixo** (`possibleTrashMap`, `lot-exclusion.ts`, compartilhada com a home;
    parte de `useLotInsights`): pílula "⚠ possível lixo ✕" (clique = "não é lixo", ensina o modelo), evidência no
    painel, filtro "Ocultar possível lixo" e botão de **excluir** na linha (`ExcludeLotDialog` + `excludeLot`).
    "Analisar pendentes" só cobre os 5 primeiros dias (o servidor só enxerga a janela da varredura).
  - Teste local no navegador: `tools/local-tests/analise-seed.mjs` + `analise-e2e.mjs`.
- **`_authenticated/analise.tsx` (Análise, remodelada na v0.113.0):** dois **Top 30 por nota**
  recolhíveis — **vigiados** (`watchedIds`) e **restante** — sob a barra de filtros e a **barra
  de dias** (mesmo formato da home: passados âmbar, futuros azul, + "Todos"; contagem por dia
  sobre os filtros sem o dia). A visão "Por dia e casa de leilão" foi extinta. Cada linha do Top
  tem o botão ✨ **repassar a IA** (`ReevaluateIconButton` em `ai-score.tsx`, o MESMO `reevaluateLot` do
  ↻ do card (menu capa/texto/dica): reavalia forçado, com o preço atual — inclui meu lance vencendo —,
  regrava `lot_ai`/`eval_price` e atualiza o cache `lotAi` sem refetch). Dia salvo que saiu da
  janela cai em "Todos". Nota à esquerda com `HoverDetails` (painel via `createPortal`,
  `position:fixed`, abre à esquerda/no toque, Discogs clicável); título com
  (Barra de origem do card em Vigiados "Por artista": ★ verde/vermelha ao lado da casa = casa com lance vencendo/coberto, de `houseBidFlags`.)
  (Vigiados "Por casa", catálogo multi-dia: faixa grossa no topo do card com data · hora do lote — prop `dateBar` do `LotCard`.)
  (Vigiados "Por casa": lotes de um catálogo multi-dia ordenados por data crescente, depois nº do lote.)
  (Ao desvigiar, o toast "Vigia removida" fica 5 s com ação "Desfazer" que revigia o lote.)
  (v0.177.0: **sincronia entre dispositivos** — o acumulador de vigiados é por aparelho (`localStorage`); desvigiar pelo app grava o id em `app_state.watch_removed` (`setWatchRemoved`, TTL 4 dias, limpo ao revigiar) e `useWatchedQuery` o passa a `mergeWatchedAccum(…, removedIds)`, que apaga o item mesmo com o leilão em andamento. Desvigiar direto no site do LeilõesBR só some em outro aparelho antes do início do leilão. Vigiados/Lances relêem a conta ao focar o app após `staleTime` (5 min).)
  (v0.124.1: o toggle de vigia também atualiza o acumulador/cache de **lances** (`bid.watched`, que é o que o card da aba Lances lê) e, para lote fora da varredura geral, monta o `WatchedLot` a partir do lance — senão o botão ficava em "Vigiar" e o lote não entrava em Vigiados até recarregar.)
  raridade/oportunidade/motivo/tags + faixa Discogs; botão de vigiar + borda colorida por
  status. **Filtros** (valem p/ os dois Tops): busca, casa, faixa de nota, raridade,
  "Só sondagem", "Com lance" (dia = barra de dias; "Vigiando" saiu — virou o 1º Top). **Tags editáveis** (×/＋ no hover, `setLotTags` →
  `updateLotTags`, otimista, com toast; só em lotes com linha em `lot_ai`).
- **Página Ao vivo, botão e proxy `/api/live` — REMOVIDOS (v0.157.0).** A visão "Sem lance" de hoje e o
  badge/`LiveLotNow` da grade cobrem o acompanhamento; saíram `ao-vivo.tsx`, o botão do cabeçalho,
  o item do menu mobile, `openLiveAuction`/`getTodayAuctions`/`listTodayAuctions`, o proxy autenticado
  (`leiloesbr-live.server.ts`, `LIVE_PROXY_SECRET`, `getSessionCookieLenient`, `absorbSetCookie`).
  `isPublicHost` foi para `src/lib/public-host.ts`. O texto histórico da página/proxy abaixo não vale mais.
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
  (v0.153.2: `useDragAutoScroll` também em todo drag do De olho, na correlação da IA e em `useListDnd`.)
  `ConfirmMoveDialog` → mesma ação. Durante o arrastar, `useDragAutoScroll` rola a janela quando o
  ponteiro chega a ~90px do topo/rodapé (v0.98.1; o mesmo hook vale para arrastar venda → álbum
  no Analytics). Não há subgrupo de álbum em Vigiados.
- **Lote com lance aparece em Vigiados (v0.184.1):** dar lance não vigia o lote no LeilõesBR. `use-dashboard-data.tsx` expõe `watchedList` = `watched.data` ∪ lances fora da vigia (`withBidsAsWatched`, `watched-accum.ts`): dia do LEILÃO via `bidDayKey`, horário por `houseTimeByDayHouse`, só de hoje em diante (como a poda dos vigiados). Usado pela aba Vigiados, "Vigiados do dia", "Dias Futuros" e contadores; `watchedIds`/botão Vigiar seguem só com a vigia real (o lote aparece com "Vigiar").
- **Filtro dos contadores avisado na aba Vigiados (v0.195.3):** `statFilter` (badges verde/vermelho/amarelo de `HouseStatBadges`) é persistido no navegador e o amarelo "vigia" exclui lotes com lance; `watched-tab.tsx` mostra um aviso no topo ("Filtro dos contadores ativo — N lote(s) escondido(s)" + "Limpar filtro") enquanto houver filtro.
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
- **Vigiados: ocultar casa e acompanhar (v0.199.0):** `hiddenHouses` e `followedIds` (`Set` persistido em `use-dashboard-data.tsx`, chaves `watched-hidden-houses`/`watched-followed-lots`, **por aparelho**; expostos em `DashboardData` com `hideHouse/showHouse/showAllHouses/toggleFollow`). `watched-tab.tsx` tira as casas ocultas de `houses`/`visible`/artistas, mostra a faixa "Casas ocultas (n)" (Mostrar / Mostrar todas) e um botão "Ocultar" no cabeçalho da casa (visão por casa). A ★ do `LotCard` (desktop e `LotCardMobile`, só com `onToggleFollow`) marca o lote; o painel `FollowPanel` (`dashboard/follow-panel.tsx`) fica no topo da aba (a aba "Dias Futuros" mostra só os acompanhados de dias futuros, a principal os demais): um bloco por casa/catálogo (`catalogAuctionInfo`), duas cores alternando (stone/sky, fora das cores de status) com o nº da casa, semáforo/guarda (`HouseLight`), horário/status, "pregão ao vivo" e "ver catálogo"; com a casa ao vivo, barra e trilho (`usePresencialNowMap`, mesma queryKey `presencial-now` do resto do app) e uma linha por lote com capa pequena, valor/lance, **distância em lotes** (`lotDistance`, `followTone`: ≤3 vermelho, ≤15 amarelo, resto verde) e **estimativa em minutos** (`etaMinutes`: ritmo médio do pregão desde o início ÷ peças feitas; só com ≥5 peças e pregão do dia, senão omite). Faixa de pílulas no topo do painel (toque rola até o lote). Funções puras em `src/lib/follow.ts` (`tests/follow.test.ts`). **v0.201.1:** a ocultação é por dia (`watched-hidden-houses-by-day`: casa → dia, `hiddenByDayCodec`; `hiddenHouses` é derivado e só vale se o dia salvo = hoje; a chave antiga `watched-hidden-houses` é ignorada). Trilho do pregão: `timelineLayout` (`follow.ts`) posiciona cada item pela peça estimada (`peça atual + lote − lote atual`), com escala que cresce para itens de outro dia e marca de "fim de hoje" (antes `lote/total` empilhava tudo em 98%). **Sincronia entre aparelhos (v0.206.0):** `app_state.watched_prefs` = `{ followed: id→ISO, hidden: casa→dia }` (30 dias / 3 dias de prazo, `parseWatchedPrefs` em `watched-prefs.server.ts`). Cada mudança é UMA operação atômica (`changeWatchedPrefs`, `mutateAppState`; tipos e `applyPrefsOp` em `watched-prefs.ts`, client-safe) — celular e desktop não se sobrescrevem. O cliente (`use-dashboard-data.tsx`) mantém o `localStorage` como cache, aplica a mudança na hora e envia; `useWatchedPrefsQuery` relê ao voltar ao app (foco) e a cada 2 min, e o que vem do servidor substitui o cache (exceto com envio pendente). Cada aparelho sobe UMA vez o que já tinha guardado (flag `watched-prefs-migrated`, op `merge`: só soma, nunca apaga) e depois o servidor manda; erro de leitura mantém o cache local. **v0.206.1:** a borda de cada lote no painel segue a dos cards (`bidStatus`: verde vencendo, vermelho coberto/outro status, amarelo só vigiado); título `line-clamp-2` e linha de valor sem truncar. **v0.206.2:** cada lote do painel tem 3 linhas (artista; álbum sem o prefixo "Artista - "; `#lote · valor · status`) com a altura da caixa igual à da capa; botões ↗/★ estreitos. Pendente: alerta com o app fechado.
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
- **Casa com mais de um pregão no dia (v0.185.1):** a listagem principal do dia e "Vigiados do dia" usavam o 1º lote da casa (`houseAuctionInfo(day, lots[0])`) para horário/status/presencial/lote em pregão, e a Martini (dois pregões no mesmo dia) mostrava os dados de um só. `splitByAuction` (`grouping.ts`, testado) separa os lotes da casa por `idLeilao` (ordem: horário, depois nº); com 2+ pregões o cabeçalho ganha o selo "N catálogos" (sem status próprio) e cada pregão é um `AuctionSection` (`day-tab.tsx`: "Catálogo N", nº de lotes, data, `HouseStatBadges`, `AuctionStatusInline` com o lote em pregão, `PresencialLink`, "ver catálogo"; recolhível, chave `day|house|idLeilao` em `closedHouseSections`) — o mesmo desenho da aba Vigiados. A decisão "tem mais de um pregão" usa os lotes SEM filtro (a estrutura não muda ao filtrar por artista/preço). `useTodayUnsold` agora tem um alvo por pregão e a visão "Sem lance" rotula "Catálogo N" quando a casa aparece mais de uma vez. **v0.185.3 — mesma divisão nos outros lugares:** "Lotes sem lance" (`unsold-view.tsx`) agrupa as entradas de `useTodayUnsold` (uma por pregão) por casa — 2+ pregões = selo "N catálogos" + bloco recolhível "Catálogo N" (chaves `house|casa` / `cat|idLeilao`); `countUnsoldHouses` conta casas distintas nos contadores. `BidHouseSections` ("Lances do dia" e aba Lances) divide a casa por `idLeilao` do lance (o bloco reusa `isHouseOpen`/`onToggleHouse` com a chave composta `casa|idLeilao`, que os chamadores interpolam na chave de recolher) e cada bloco tem o próprio "ver catálogo". O horário de lance/vigiado herdado da varredura (`houseTimeFor`, `use-dashboard-data.tsx`) usa a chave `dia|casa|idLeilao` e cai em `dia|casa`. Já eram por pregão: "Acontecendo agora"/`/ao-vivo` (uma linha por `idLeilao` de `seen_auctions`), a faixa "Pregões envolvidos" da visão por artista e o andamento da Análise (uma consulta por pregão). Pendente: o status "Ao vivo agora" ainda é assumido quando o horário passou e o presencial não respondeu (`trackedAuctionStatus`), e o "Vendido" de vigiados da Martini não é detectado (formato do `peca.asp` não verificado; o site bloqueia o IP do ambiente de desenvolvimento).
- **"Dias Futuros" (v0.154.0):** último botão de todo seletor de dias, com `FUTURE_TAB`/`FUTURE_LABEL`/
  `isFutureDay` (`day-bar.ts`). Corte = último dia do seletor (barra da home: hoje+14; `/analise`: último
  dia da janela). **Home:** aba `future` (desktop `TabsTrigger` e chip "Dias Futuros" no mobile), conteúdo =
  `<WatchedTab futureOnly/>` + `<BidsTab futureOnly/>` (um chip/seção por dia); contador `futureCount`
  (`use-dashboard-data.tsx`, respeita a busca). **Vigiados:** os dias depois da barra viram UM chip final;
  **Lances:** uma seção final "Dias Futuros". Vigiado/lance nunca é podado por estar fora da faixa
  (`mergeWatchedAccum`) — só some o que a conta deixou de listar (teto de 100 páginas, `MAX_ACCOUNT_PAGES`).
- **Split do `index.tsx`:** lógica em `src/components/vinyl/` — `grouping.ts` (puros + tipos),
  `badges.tsx`, `filters.tsx`, `lot-card.tsx`, `bid-house-sections.tsx`, `live-auctions.tsx`,
  `ai-score.tsx` (UI) + `ai-score-utils.ts` (puros/client-safe — `parseAiAlbum`/`formatAiAlbum`,
  rarity legend, `LotMarket`/`toLotMarket`, `buildInterestMatcher`). Helpers puros/UI ficam em
  arquivos `.ts`/`.tsx` separados por causa do react-refresh (o especificador resolve `.ts`
  antes de `.tsx` — nomes não podem colidir).

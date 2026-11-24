# UI — Pregão ao vivo, lance superado e lotes sem lance

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Aviso de lance superado (v0.59.0)

- **Só client-side, só com o app aberto** — nenhuma mudança em cron/`/api/cron`/DB. Reaproveita
  o refetch já existente de `["vinyl-my-bids"]` (`staleTime` 5min + refresh manual) tanto em
  `index.tsx` quanto em `analise.tsx`.
- **Detecção:** `bidIsCovered(status)` (`vinyl-parse.ts`, regex `/cobert/i`) identifica "fui
  superado". O evento a avisar é a **transição** para coberto — não o estado em si — senão todo
  reload avisaria de novo de um lote já coberto numa sessão anterior.
- **`bid-alerts.tsx`** (`detectNewlyCoveredBids` + hook `useBidCoveredAlerts`): compara o `status`
  de cada `MyBid` contra um snapshot do último `status` visto por `id`, persistido em
  `localStorage` (`BID_STATUS_SNAPSHOT_KEY`) via os mesmos `loadAccum`/`saveAccum` genéricos de
  `watched-accum.ts` (chave compartilhada entre `index.tsx`/`analise.tsx`, igual ao acumulador de
  vigiados/lances). Quando há lote(s) recém-coberto(s), dispara `toast.warning` (`sonner`, já
  montado globalmente em `__root.tsx`) — um toast por lote, ou agrupado se vier mais de um na
  mesma leva. **v0.181.0:** o balão fica na tela até ser fechado (`duration: Infinity` + botão de fechar) e lista, por lote, "Lote N — Artista — Álbum", dia da semana + data, casa e nº do leilão (`formatCoveredWhere`, `lot-score.ts`) e o link "Ver lote no leiloeiro" (`lotOpenUrl`); o push do cron (`bid-notify.server.ts`) leva a mesma linha de dia/casa/leilão.
- **v0.100.0:** o toast **não some sozinho** (`duration: Infinity` + `closeButton`) e lista só
  `Lote N — Artista — Álbum` por lote (`formatCoveredLot`, `ai-score-utils.ts`; álbum resolvido
  via `albumById`, passado ao hook como `albumFor`; sem álbum cai no título do lance).
- **Badges como filtro (v0.101.0–v0.101.1):** `HouseStatBadges` recebe `active`/`onToggle` e vira botão (`aria-pressed`). O estado `statFilter` (`Set` de `vigia`|`green`|`red`, **seleção múltipla com OU** desde a v0.104.0; vazio = sem filtro, `matchesStatFilter`) é ÚNICO e mora em `use-dashboard-data.tsx` (hooks não cabem no `DayTab`, que retorna cedo em aba inativa); vale na aba Vigiados, na lista geral do dia e em "Vigiados do dia", via `houseStatKind` (mesma regra do `computeHouseStats`). Clicar de novo limpa; há "Limpar filtro (de status)" na barra e na mensagem de lista vazia. `BidStatBadges` (lances) segue só informativo.
- **Aba Vigiados — Atualizar + auto-refresh (v0.100.0):** botão "Atualizar" ao lado de
  "Por casa/Por artista" chama `refreshWatchedAndBids` (`use-dashboard-data.tsx`: refaz
  `watched` + `bids` juntos, com guarda contra chamadas concorrentes). Enquanto a aba está aberta
  (`tab === "watched"`) e a página visível, o mesmo refresh roda sozinho a cada 60 s
  (`AUTO_REFRESH_MS`, `watched-tab.tsx`), **silencioso** (sem toast) — o aviso de coberto continua
  disparando pelo `useBidCoveredAlerts`.
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

> **v0.112.2 — sem janela fixa de 3h (`auctionFinished` removida):** o status do pregão vem só do
> acompanhamento lote a lote. `useAuctionStatus` (`use-auction-status.ts`) + `trackedAuctionStatus`
> (`vinyl-parse.ts`): início pelo horário; peça < total → ao vivo; peça = total / marcação manual →
> encerrado; presencial que parou de responder depois de visto ao vivo (`auction-seen-live.ts`,
> `localStorage`, 48h) → encerrado; dia anterior (`auctionDayPassed`) → encerrado; sem nenhum
> sinal → ao vivo. **Marcar/desmarcar à mão:** bandeira (marcar) e "reabrir" (desmarcar, só quando
> marcado à mão), `useManuallyFinished`, sincronizado por evento entre componentes. Demais pontos:
> grade "esconder finalizados"/contagem dos dias = dia passado ou marcado à mão; "Acontecendo
> agora" some com peça = total, presencial mudo após visto ao vivo ou marcação manual; servidor
> (`captureFinishedSales`, `debugSales`, `listTodayAuctions`) só considera encerrado dia anterior;
> `watched-accum` poda vigia ausente só se o leilão ainda não começou; lookout não corta mais por
> horário. As menções a "3h" nas seções abaixo são histórico.

## Visão "Lotes sem lance" do dia de hoje (v0.156.0)

Substitui o antigo "lotes sem lance (N de M)" da linha da casa (seções abaixo, v0.89.x, ficam
como histórico). A linha da casa agora só tem `PresencialLink` (`presencial-link.tsx`): link
"pregão presencial" que **some** quando o pregão encerra (`useAuctionStatus`).

- **Ícone `PackageOpen` + contador** colado à aba **Hoje** da barra de dias (desktop,
  `dashboard-header.tsx`) e chip **"Sem lance (N)"** na faixa de visões do dia (mobile,
  `mobile-dashboard-header.tsx`). Só no dia corrente (dias passados/futuros não têm); N = casas de
  hoje com pelo menos 1 lote sem lance achado. Estado `unsoldViewDay`/`setUnsoldViewDay` em
  `use-dashboard-data.tsx` (só sessão), exclusivo com Vigiados/Lances do dia.
- **`useTodayUnsold(lots, todayKey)`** (`use-today-unsold.ts`): para cada casa de hoje já iniciada,
  status via `trackedAuctionStatus` (peça/total do presencial + "já visto ao vivo") e
  `getUnsoldLots`. Casa **encerrada** → tudo que não vendeu; casa **ao vivo** → só lotes que já
  passaram no pregão (`currentLote` = lote em pregão agora; `isLotePassed`, `vinyl-parse.ts`) e
  sem venda, refeito a cada 60 s, então a lista cresce conforme os lotes são achados. Casa "em
  breve" fica de fora. Mesmas `queryKey`s do polling do presencial e de `unsold-lots` (dedup entre
  cabeçalho e visão). Um lote recém-passado pode aparecer um instante antes de o catálogo
  marcá-lo vendido; some no refetch seguinte.
- **`UnsoldView`** (`dashboard/unsold-view.tsx`, renderizada no `DayTab` de hoje): botão "Voltar ao
  dia", busca, seção por casa/pregão e cards `UnsoldLotCard` (lote recém-achado ganha destaque verde
  por 3 s). **v0.195.0:** (1) as casas começam **fechadas**; o conjunto de abertas (`home-unsold-open`,
  chaves `dia|idLeilao` / `dia|house|casa` / `dia|cat|idLeilao`, só do dia atual), a busca
  (`home-unsold-query`) e o dia da visão (`home-unsold-view-day`, em `use-dashboard-data.tsx`) vão
  para o `localStorage` (`usePersistedState`); a rolagem já era salva por `usePersistedScroll`, agora
  só restaura depois de o dia da visão hidratar. (2) Clicar no card abre um `Dialog` com o
  `DashboardLotCard` (`dashboard/dashboard-lot-card.tsx`: o mesmo `LotCard` da grade do dia, ligado
  às ações da home); o lote completo vem de `lots.data` por `idLeilao|idPeca` e, sem ele, o card
  cai no link do lote. (3) O cabeçalho reusa `HouseUf`, `HouseLight`, `AuctionStore`,
  `HouseStatBadges` (filtro de status vale aqui também), `AuctionStatusInline` (`info` agora vem de
  `useTodayUnsold`) e `AuctionHeaderActions` (`dashboard/auction-header-actions.tsx`: lista +
  presencial + site/catálogo, também usado por Dia, Vigiados e `AuctionSection`).
- **Servidor:** `getUnsoldLots` ganha `currentLote` opcional (`unsold-lots.server.ts`; cache de 45 s
  quando informado, 5 min sem ele).
- **Falso "sem lance" em lote vendido (v0.185.2):** o `sold` do catálogo só é verdadeiro com valor de
  venda legível, então um lote vendido com valor vazio/escondido (pregão ao vivo, visto na RT Leilões e
  Artes) caía na lista. `fetchCatalogData` agora também devolve `mark` (`sold`/`unsold`, do
  `MOSTRABTN_CLASS` ou da classe `lotevendido` no HTML antigo) e `isUnsoldCatalogLot`
  (`leiloesbr-catalog.server.ts`, testada em `tests/unsold-catalog.test.ts`) decide: vendido (valor OU
  marca) → fora; `QTDLANCE` > 0 → fora; marca "não vendido" → dentro; sem marca → dentro só com
  `QTDLANCE` = 0 (ou sem nenhum sinal, fallback HTML). Com `currentLote` (ao vivo), `dropSoldOnPage`
  (`unsold-lots.server.ts`) ainda confere os candidatos na `peca.asp` de cada lote (`fetchLotDetails`,
  até 60 por rodada; "vendido" fica memorizado, "sem venda" vale 2 min). Sem a RT acessível daqui, a
  causa exata não foi reproduzida — se ainda aparecer lote vendido, olhar o JSON cru do catálogo dele.
- **Catálogo sem `QTDLANCE` (v0.186.1, RT Leilões e Artes):** a RT não manda a contagem de lances no catálogo (só a página do lote mostra "Histórico de lances: N lance(s)"), então `isUnsoldCatalogLot` via tudo como sem lance. `dropSoldOrBidOnPage` (`unsold-lots.server.ts`) confere na `peca.asp` (`parseBidCount`, `leiloesbr-lot-details.server.ts`) os candidatos sem `QTDLANCE` — fora do ao vivo (até 300) e no ao vivo (até 60, todos os candidatos) — e descarta venda OU lance. Casas que trazem `QTDLANCE` não geram requisições extras.
- **Removido:** override manual "marcar encerrado" (`manually-finished-auctions.ts`,
  `use-manually-finished.ts`, botões 🏁/"reabrir") — a lista não depende mais de sinal de fim, já
  vai aparecendo por casa. `trackedAuctionStatus` perdeu o sinal `manual`.

### Filtro "Sem lance" na listagem do dia — ícone verde (v0.186.0)

- **Ícone verde `ListFilter`** ao lado de CADA dia da barra (desktop, `dashboard-header.tsx`) e chip
  **"Só sem lance"** na faixa de visões (mobile). Não abre tela nova: liga/desliga o estado
  `noBidFilter` (`use-dashboard-data.tsx`, só sessão) que filtra a PRÓPRIA listagem do `DayTab`
  (mesmo agrupamento casa → pregão → artista, mesmos cards). Com o filtro ligado aparece o botão
  "Sem lance ✕" na barra do dia para remover.
- **`useDayNoBid(lots, dayKey, enabled)`** (`use-day-no-bid.ts`): um `getUnsoldLots` por pregão do dia,
  SEM `currentLote` (todo o catálogo sem lance, não só o que já passou), chave `["unsold-lots", idLeilao,
dia, "all"]`, cache de 5 min. Só consulta com o filtro ligado no dia aberto. "Sem lance" = a regra
  de `isUnsoldCatalogLot` (sem venda e `QTDLANCE` = 0), valendo para dia passado, hoje e futuro; pregão
  sem link de catálogo consultável fica de fora (aviso "N lote(s) … ficaram de fora").
- **Barra do topo compacta (v0.186.0, desktop):** `dashboard-header.tsx` junta botões de navegação, busca (`LotSearchBox`) e conta (e-mail, Sair, `PushToggle`) em uma linha; os dias usam `shortDayLabel` (`grouping.ts`, só `dd/mm`, "Hoje" com a palavra; `dayLabel` completo segue em títulos/aria); a barra de ferramentas do dia (`day-tab.tsx`) tem um único botão de atualizar vigiados + lances (`refreshWatchedAndBids`) e o aviso "Buscando lotes sem lance…" é um `toast` (id `no-bid-loading`). Sem rolagem lateral nova no desktop; o mobile não mudou. A aba Vigiados (`watched-tab.tsx`) segue o mesmo estilo: `chipClass`/`smallButtonClass` menores, dias com `shortDayLabel` (tooltip com o rótulo completo) e Visão/Atualizar + resumo + Analisar/Abrir/Fechar numa linha só.
- **Visão laranja (hoje):** o card (`UnsoldLotCard`) agora mostra o valor (`price` da tabela `lots`,
  devolvido por `getUnsoldLots`) e os lotes saem ordenados por nº do lote (`sortByLote`, `grouping.ts`).

### UF ao lado do nome da casa (v0.156.0)

`HouseUf` (`house-uf.tsx`) mostra "SP", "RJ"… ao lado do nome da casa em todas as telas (grade do
dia, Vigiados, Lances, cards de origem, Compras, Pregões, Análise, Ao vivo, De olho, calibração).
`uf` explícito (quando o item já traz) vence; senão vem de `getHouseUfs` → mapa `houseKey` → UF
(moda da UF por casa na tabela `lots`, `pickHouseUfs` em `house-uf.ts`), cacheado 1 h
(`useHouseUfsQuery`). Telas que já exibiam a UF por outro caminho (Ao vivo agora, detalhe do lote
mobile, card de compra) não foram duplicadas.

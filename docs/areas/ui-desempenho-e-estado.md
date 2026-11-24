# UI — Desempenho, estado lembrado e painel de casas

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Desempenho das telas (v0.155.0)

Oito mudanças para Dias (home), Vigiados e De olho abrirem mais rápido. O que mais pesava não era
desenhar a tela, e sim as leituras do site do LeilõesBR feitas ao abrir (conta com até 100 páginas
por lista, `peca.asp` por lote). Cada item abaixo diz **o que mudou**, **o que o usuário pode
notar** e **como voltar** se aparecer problema — os itens são independentes, dá para reverter um só.
Testes das partes puras: `tests/screen-speed.test.ts`.

1. **Contador do De olho sem valor ao vivo.** O contador do menu (cabeçalho, menu do celular, selo
   do ícone — `useLookoutOverviewQuery({ history: false })`) pedia o `computeLookout` com o valor
   ao vivo (`applyLivePrices`: até 200 `peca.asp`, 8 por vez) em toda tela com cabeçalho. Agora a
   versão "light" pede `live: false` (`getLookoutOverview` aceita `live`; padrão = `history`). O
   número não muda: `newCount` só depende do casamento e do "visto". A notificação do cron
   (`notifyLookoutMatches` → `computeLookout(false)`) segue com valor ao vivo.
   - Pode notar: nada no contador. O `/olho` não ganha mais o cache de preços aquecido pela home.
   - Voltar: em `useLookoutOverviewQuery` (`queries.ts`), mandar `live: true` também na versão light.
2. **Cache da conta no servidor (vigiados/lances).** `listWatchedFromSite`/`listMyBidsFromSite`
   passam por `createAccountCache` (`account-cache.server.ts`): leitura em andamento é sempre
   reaproveitada (chamadas simultâneas viram uma só) e, com `maxAgeMs`, a última leitura terminada
   vale por até `ACCOUNT_CACHE_MS` (60 s). Usam 60 s: `listWatched`/`listMyBids` (telas, exceto com
   `force: true`, mandado pelos botões "Atualizar" via `refetchFresh()` dos hooks) e
   `getAccountLots` (De olho, `reident`; o cache próprio de 60 s dele foi removido — agora erro de
   leitura não fica guardado). Cron, alertas de lance, compras e "Analisar" chamam sem `maxAgeMs`
   (sempre fresco). `toggleWatch` invalida os dois caches (senão o acumulador da tela traria de volta
   um lote recém-desvigiado).
   - Pode notar: mudança feita direto no site (vigiar/dar lance fora do app) leva até 60 s a mais
     para aparecer no auto-refresh; o "Atualizar" sempre lê na hora.
   - Voltar: trocar `ACCOUNT_CACHE_MS` por `0` em `account-cache.server.ts` (mantém só a
     deduplicação de chamadas simultâneas). Para tirar tudo, `listWatchedFromSite`/
     `listMyBidsFromSite` voltam a chamar direto `readWatchedFromSite`/`readMyBidsFromSite`.
3. **`/olho` em duas etapas + cache do valor ao vivo por dia.** A página lê as duas versões do
   overview: "light" (sem histórico e sem valor ao vivo — a mesma do contador, quase sempre já em
   cache) aparece primeiro; "full" (histórico + valor ao vivo) a substitui quando chega
   (`overview = full ?? light` em `olho.tsx`). Enquanto só a light está na tela aparece "Carregando
   valores ao vivo e aparições passadas…" (ou o aviso de falha, mantendo os valores da varredura).
   Patches otimistas e invalidações usam a chave base `lookoutOverview`, então atingem as duas. Em
   `lookout-matches.server.ts`, o valor ao vivo fica em cache 3 min para pregão de hoje
   (`LIVE_PRICE_TTL_TODAY_MS`) e 10 min para os dias seguintes (`LIVE_PRICE_TTL_LATER_MS`).
   - Pode notar: por alguns segundos, preços da varredura e cartões sem "aparições passadas"; valor
     ao vivo de leilão de amanhã em diante pode ter até 10 min.
   - Voltar: em `olho.tsx`, usar só `useLookoutOverviewQuery({ history: true })` como `query`
     (apagar `lightQuery`, o objeto `query` montado e o aviso `completing`); TTL: igualar as duas
     constantes a `3 * 60 * 1000`.
4. **Tabelas por lote em duas partes na home.** `getLotAi`, `getLotIdent`, `getLotMarket` e
   `getLotCondition` aceitam `scope` (`lot-scope.ts`): `core` = lotes de 2 dias atrás até o fim da
   janela padrão (hoje..+4); `rest` = o resto (histórico mais antigo, +5..+14, stubs da conta). O
   recorte é feito no servidor sobre a tabela inteira já em cache (`filterByLotScope`,
   `lot-scope.server.ts`; se a leitura dos ids falhar, `core` leva tudo e `rest` vem vazio). A home
   usa `useHomeLotAiQuery`/`useHomeLotIdentQuery`/`useHomeLotMarketQuery`/`useHomeLotConditionQuery`
   (`useScopedLotRows` em `queries.ts`): chaves `[...base, "core"]` e `[...base, "rest"]`, a
   segunda só depois da primeira; os dados são a união (dedupe por id). As outras telas seguem com a
   tabela inteira (`useLotAiQuery` etc., chave base; `useLotConditionQuery` novo, antes repetido em 3
   lugares). Por isso todo patch em `lotAi` virou `setQueriesData({ queryKey: queryKeys.lotAi })`
   (atinge partes e inteira).
   - Pode notar: ao abrir direto num dia do histórico antigo, em +5..+14 ou num vigiado distante,
     nota da IA/mercado/estado aparecem alguns instantes depois do card.
   - Voltar: em `use-dashboard-data.tsx`, trocar os quatro `useHome*Query()` por `useLotAiQuery()`,
     `useLotIdentQuery()`, `useLotMarketQuery()`, `useLotConditionQuery()`. O servidor sem `scope`
     já devolve tudo, nada mais precisa mudar.
5. **Auto-refresh da aba Vigiados mais leve.** Antes relia vigiados + lances da conta todo minuto.
   Agora (`watched-tab.tsx`) o tick de 1 min atualiza só valor atual/próximo lance/vendido
   (`refreshLotDetails` → invalida `lot-details` e `sold-lots`); a lista da conta é relida a cada
   `ACCOUNT_REFRESH_EVERY` (3) ticks, em silêncio e aceitando o cache do item 2.
   - Pode notar: lote vigiado/desvigiado direto no site leva até 3 min para entrar/sair sozinho.
   - Voltar: `ACCOUNT_REFRESH_EVERY = 1`.
6. **Abas fechadas não recalculam.** `WatchedTab` e `BidsTab` (duas instâncias cada: normal e
   "Dias Futuros") faziam filtro/agrupamento dentro do JSX a cada render da home, mesmo com outra
   aba aberta (o Radix só não monta). Agora devolvem `<TabsContent>` vazio quando não são a aba
   ativa, como o `DayTab` já fazia. No `WatchedTab` o retorno fica depois de todos os hooks.
   - Pode notar: nada.
   - Voltar: apagar o `if (!isActiveTab) return …` (`watched-tab.tsx`) e o `if (tab !== …) return …`
     (`bids-tab.tsx`).
7. **`/olho`: `active`/`archived` memorizados.** Eram recriados a cada render, anulando o
   `useMemo` de `groups` (`groupByArtist` rodava a cada tecla da busca). Agora são `useMemo`.
   - Pode notar: nada (busca mais fluida com muitos itens). Voltar: trocar por `items.filter(...)`.
8. **Vigiados/Lances abrem com o último estado.** `useWatchedQuery`/`useBidsQuery` (agora sobre
   `useAccountQuery`, `queries.ts`) usam como `placeholderData` o acumulador do `localStorage`
   (`accumSnapshot`, `watched-accum.ts`: só a poda por data, sem alterar o acumulador). É lido
   depois de montar (o SSR não tem o acumulado; ler no 1º render quebraria a hidratação). A poda
   por data foi extraída para `accumItemExpired`, usada também por `mergeWatchedAccum` (mesma regra).
   - Pode notar: ao abrir, por alguns segundos aparece a lista da última visita; um lote
     desvigiado em outro aparelho some quando a leitura da conta chega.
   - Voltar: tirar `placeholderData` (e o `useState`/`useEffect` do placeholder) de
     `useAccountQuery`.

## Estado lembrado entre sessões e "Atualizar relações" (v0.105.0; v0.105.1 cobre Vigiados / filtros da Análise / Coleção / Compras / Analytics)

- `src/lib/persisted-state.ts`: `usePersistedState(key, initial, codec?)` espelha o estado em
  `localStorage` (prefixo `ui-state:`); 1º render usa o valor inicial (SSR) e o salvo entra após
  montar. `usePersistedScroll(key, ready)` salva/restaura a rolagem (espera a lista crescer até ~8s;
  desiste se o usuário rolar). Home persiste aba, página da barra de dias (reapontada com
  `shiftSavedDayTab` se o dia virou), busca, filtros, casas abertas/fechadas, Vigiados/Lances do dia;
  Coleção (aba Cards/Títulos), Análise (dia) e rolagem de Compras/Ao vivo também.
  Analytics também lembra a ordenação dos álbuns e do detalhe; Análise lembra "mostrar adquiridos".
- "Atualizar relações" (rodapé da home): rebusca Coleção/vínculos/rejeições/termos negados (cache de
  1h) e o casamento é recalculado para todos os lotes; `resolveOwned` segue respeitando "não tenho".

- **Tracklist no card (v0.106.0):** `TracklistHover` (`tracklist-hover.tsx`) no canto direito do `LotCard`, logo abaixo do ícone da Coleção; dados de `LotAi.tracklist` (ver `ia.md`). Compras e Coleção usam `LotTracklistHover` (v0.106.2): busca a tracklist em `lot_ai` pelo `lot_id` (Coleção: `lotId ?? originLotId`) — itens manuais ou de lotes já podados (cascade apaga `lot_ai`) ficam com o ícone apagado.

## Painel flutuante de casas (v0.184.0)

`HouseNav` (`dashboard/house-nav.tsx`, montado em `_authenticated/index.tsx`, fora do `Tabs`; não
renderiza no mobile): `nav` fixo na margem esquerda do conteúdo (`max-w-6xl`), `hidden 2xl:flex` — só
há margem para ele a partir de 1536px. Lê do DOM (`MutationObserver` no contêiner do conteúdo +
scroll/resize, em `requestAnimationFrame`) as seções `[data-house-nav="<casa>"]`: grade do dia e
vigiados do dia (`day-tab.tsx`), Vigiados (`watched-tab.tsx`, visão por casa) e `BidHouseSections`
(Lances). Clicar faz `scrollIntoView` na seção (`scroll-mt-32` por causa do cabeçalho sticky); a casa
com topo acima de 200px é a ativa (`aria-current`). Só aparece com 2+ casas. Casa repetida na tela
ganha sufixo (`houseNavLabels`, `house-nav-utils.ts`, com teste). Nova seção de casa em outra tela →
basta pôr `data-house-nav` e `scroll-mt-32` no `<section>`.

# UI — telas descontinuadas ou substituídas (histórico)

> Movido de `docs/areas/ui.md` em 24/11/2026. Só para entender o porquê de algo antigo; não é leitura de início de sessão.

## Lotes sem lance ao fim do pregão + saída de "Acontecendo agora" (v0.89.0) — HISTÓRICO, substituído na v0.156.0

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

### Override manual — "marcar pregão como encerrado" (v0.89.4) — REMOVIDO na v0.156.0

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

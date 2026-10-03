# Scraping do LeilõesBR, catálogo, nº do lote, casas verificadas e cron

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Scraping do LeilõesBR

- **Varredura geral é PÚBLICA** (sem login) via `publicFetch` — evita o 500 que o site dá
  logado sob carga. Categoria fixada por `tp=|446973636F2064652076696E696C|` (hex de "Disco de
  vinil") → **todo lote já é vinil**; não exigir palavra-chave no título, só descartar CD/DVD/LD (Laser Disc)/K7
  (`looksNonVinyl`, em `vinyl-parse.ts`).
- **Login (`authFetch`)** só para a **conta**: env `LEILOESBR_EMAIL` / `LEILOESBR_SENHA`.
  - **Vigias**: `conta_site.asp?l=8` → `listWatchedFromSite` (cards `.oc-item`,
    `data-watch="idPeca,email,idLeilao,base"`, preço em `<b class="pb-1">`).
  - **Meus lances**: `conta_site.asp?l=4` → `listMyBidsFromSite` (mesmos `.oc-item`; **meu
    lance** em `.product-price b.pb-1`; **status** na classe/ícone `lstatus`:
    `Coberto`/`Vencendo`/`Vencedor`/`Coberto e Vendido`/`Não vendido`).
  - **Toggle vigia**: `POST vigiar_peca.asp` (`idpeca/idcliente/idleilao/base`, resposta `+`/`-`).
- **⚠️ Limite de taxa da listagem (v0.85.2):** a partir da 3ª requisição seguida a
  `busca_andamento.asp` responde **HTTP 200 com corpo VAZIO** (0 bytes) — não lança erro. Toda
  busca da listagem (`fetchPage`/`fetchPageSearch`) passa por `listingFetch`
  (`leiloesbr-scrape.server.ts`): fila única por processo, **1s** de intervalo mínimo entre
  requisições (0,8s e 2s testados OK em produção) e nova tentativa com espera de 4s/8s quando o
  corpo vier vazio. Com isso cada página custa ~3-4s: `chunk`/`galleryscan` têm orçamento de
  tempo (`CHUNK_BUDGET_MS` = 75s, abaixo dos 120s do `curl` do cron) e devolvem o cursor
  (`nextPage`/`nextOffset`) a partir do que foi de fato processado. **Ordem da listagem**
  (medida): página 1 = dia mais distante, última página = hoje. `galleryscan` para uma galeria
  depois de 2 páginas seguidas inteiras além da janela.
- Diagnóstico por página: `step=pagedebug&pages=1,2,last[&ga=][&tp=none][&cookie=1][&delayMs=]`
  (status HTTP, tamanho, cards, dias, casas, trecho do corpo), via `debug-cron.yml`. Ferramentas de diagnóstico (`findLot*`, `debugListingPages`) ficam em
  `leiloesbr-debug.server.ts`.
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
    lote), `lot-sales.server.ts` (histórico de vendas/Vinil Analytics), `unsold-lots.server.ts`
    (v0.89.0 — lotes SEM lance, o inverso do filtro de vendas: mesma fonte, sob DEMANDA do
    usuário quando o pregão termina, não pelo cron; cache em memória de 5 min evita bater o
    catálogo de novo ao abrir/fechar a lista na mesma sessão — ver `docs/areas/ui.md`).
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
- **Agenda:** 4×/dia (BRT 00:05/06:05/12:05/18:05); falha → `refresh-retry.yml` reexecuta `--failed` 1×. `enrich` tem orçamento de 60s/chamada e 25s/leilão (`deadline` em `fetchCatalogData` → catálogo parcial; devolve `nextOffset` parcial) e, no workflow, bloco com falha é pulado (soft).
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

- **Retenção de `lots` (v0.92.0):** a poda não apaga mais dias passados até 10 dias atrás, nem futuros até +14; `step=chunk|enrich&ext=1` cobre +5..+14 (cron 02:00 BRT).

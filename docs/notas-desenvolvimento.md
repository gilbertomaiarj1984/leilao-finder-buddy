# Notas de desenvolvimento — Garimpo de Vinil

> Arquivo de conhecimento para continuar o trabalho entre sessões. Registra a
> arquitetura, decisões e "pegadinhas" do ambiente. Complementa o `README.md`
> (que cobre stack, variáveis de ambiente, deploy, banco e cron).

_Última atualização: 2026-08-25._

## Visão geral

App que garimpa discos de vinil em leilões do **leiloesbr.com.br**. Faz varredura
dos lotes dos próximos ~5 dias, agrupa por dia / casa de leilão / artista e
sincroniza vigias e lances com a conta do usuário no site (via scraping
autenticado no servidor).

- **Stack:** TanStack Start (React 19 + SSR) · Supabase (Postgres + Auth) ·
  deploy Vercel (Nitro) · atualização periódica via GitHub Actions (`/api/cron`).
- **Gerenciador de pacotes:** Bun (`bun.lock`). Node 18+ também funciona.
- **Projeto conectado ao Lovable** — commits na branch conectada sincronizam de
  volta ao editor. **Não reescrever histórico já publicado** (nada de
  force-push / rebase / amend / squash de commits já enviados). Manter a branch
  sempre em estado funcional.

## Mapa da arquitetura

### Frontend (`src/`)
- `routes/_authenticated/index.tsx` — **página principal** (`VinylDashboard`).
  Abas por dia + aba **Vigiados** + aba **Lances**. Orquestra as queries e o
  estado; a maior parte da UI foi extraída para `components/vinyl/*`.
- `routes/_authenticated/dashboard.tsx` — painel de mudanças de preço/status
  (usa `getDashboardBaseline` + `listMyBids`).
- `routes/auth.tsx` — login (Supabase Auth). `routes/__root.tsx` — layout raiz.
- `components/vinyl/` — módulos de UI/lógica extraídos:
  - `grouping.ts` — helpers puros: `dayLabel`, `groupByArtist`, `groupByHouse`,
    `groupWatchedByHouse<T>` (genérico por `{house,houseUrl,lote}`),
    `computeHouseStats`, **`classifyBid`/`computeBidStats`** (lances),
    `artistOptions`, `matchesPriceRange`, `houseAnchor`, `watchedDateToKey`,
    `watchedMatchesSearch`, **`bidMatchesSearch`**. Tipos: `HouseGroup`,
    `ArtistGroup`, `HouseStats`, `BidState`, `BidStats`, `PRICE_OPTIONS`.
  - `badges.tsx` — `HouseStatBadges` (vigia/verde/vermelho) e
    **`BidStatBadges`** (vencendo/vencedor/coberto/perdido).
  - `bid-house-sections.tsx` — **`BidHouseSections`** + tipo **`BidCard`**:
    renderiza os lances agrupados por casa (usado na aba Lances e na visão
    "Lances do dia").
  - `lot-card.tsx` — `LotCard` + tipo `CardLot` (tem campo opcional `myBid`).
  - `filters.tsx` — `ArtistFilter`, `PriceFilter`.
  - `live-auctions.tsx` — `LiveAuctions` (leilões acontecendo agora).
- `components/ui/` — shadcn/ui.

### Backend / scraping (`src/lib/`)
- `leiloesbr-auth.server.ts` — login e `authFetch`/`BASE_URL` (sessão no site).
- `leiloesbr-scrape.server.ts` / `leiloesbr-auctions.server.ts` /
  `leiloesbr-catalog.server.ts` — varredura de lotes e enriquecimento (nº do lote).
- `leiloesbr-watch.server.ts` — vigias (`conta_site.asp?l=8`), tipo `WatchedLot`
  (tem `houseUrl`). `toggleWatchOnSite`.
- `leiloesbr-bids.server.ts` — **lances** (`conta_site.asp?l=4`), tipo `MyBid`.
  `listMyBidsFromSite()`. `MyBid` **não** traz `houseUrl` (casamos pelo nome da
  casa com os lotes/vigiados na UI).
- `leiloesbr.functions.ts` / `leiloesbr-watch.functions.ts` — `createServerFn`
  expostas ao cliente: `getVinylLots`, `listWatched`, **`listMyBids`**,
  `toggleWatch`, `scrapeVinylChunk`, `enrichLotes`, `getAccessStatus`,
  `getDashboardBaseline`.
- `vinyl-parse.ts` — utilidades de domínio: `bidIsWinning` (`/venc/i`),
  `parsePrice` (formato BR), `auctionFinished`, `normalizeForMatch`,
  `extractArtist`, `UNCLASSIFIED_LABEL`, tipo `VinylLot`.
- `access.server.ts` — `assertAllowed` (único e-mail autorizado, `LEILOESBR_EMAIL`).

### Dados
- Chave de casamento entre varredura/vigia/lance: **`idPeca`** (id `${idLeilao}-${idPeca}`).
- Datas do site vêm como `dd/mm/yyyy`; `watchedDateToKey` converte para `yyyy-mm-dd`
  (`dayKey`), usado no agrupamento por dia.

## Feature "Lances" (implementada nesta sessão)

Pedido: aba **"Lances"** na linha dos dias (após "Vigiados") mostrando todos os
lances dados, com status **vencendo / coberto / vencedor** (quando o leilão já
passou); agrupados por casa; e a mesma visão por dia dentro de cada aba de dia.

Entregue (PR #32, já mesclado no `main`):
- Aba **Lances** (`TabsTrigger value="bids"` + `TabsContent`), agrupando por dia
  e casa, com contadores por casa.
- Botão **"Lances do dia"** em cada aba de dia (espelha "Vigiados do dia");
  os dois modos são mutuamente exclusivos (`watchedViewDay` / `bidsViewDay`).
- `LotCard` ganhou o chip "Meu lance R$X" (campo `myBid` em `CardLot`).
- Classificação de status em `classifyBid`:
  - `won` → `/arremat|vencedor|arrebat/` (leilão encerrado, você levou) — 🏆 esmeralda
  - `winning` → `/venc/` (vencendo agora) — verde
  - `covered` → `/cobert/` (coberto) — vermelho
  - `lost` → demais (não vendido) — cinza
- A cor da borda do card segue `bidIsWinning` (`/venc/i` = verde; resto = vermelho).

**Importante:** depois do merge, o `main` **refatorou** essa lógica para os
módulos `components/vinyl/*` (o `index.tsx` original tinha ~1435 linhas). Ao mexer
em Lances, editar em `grouping.ts` / `badges.tsx` / `bid-house-sections.tsx`, não
mais inline no `index.tsx`.

## Comandos

```sh
bun install            # (ver pegadinha do proxy abaixo)
bun run dev            # http://localhost:3000
bun run build          # vite build (Nitro) — usado para validar
bun run lint           # eslint .
bun run format         # prettier --write .
npx tsc --noEmit -p tsconfig.json   # typecheck
```

## Pegadinhas do ambiente (aprendidas nesta sessão)

- **Prettier baseline "sujo":** o `index.tsx` do repo já falha ~191 regras
  `prettier/prettier` no ESLint, mesmo com a versão do prettier batendo com o
  lock. Não há CI de lint (o único workflow é `refresh.yml`). **Não rodar
  `prettier --write` no arquivo/projeto inteiro** só para "limpar" — gera diff
  gigante e polui o histórico sincronizado com o Lovable. Regra prática: manter
  **zero erros novos** em relação ao baseline; formatar apenas as linhas que você
  adiciona, no estilo do entorno.
- **`bun install` via proxy dá 403** em alguns pacotes
  (`domhandler`, `node-html-parser`). Fallback: `npm install` completa o restante.
  Se `npm install` gerar um **`package-lock.json`**, remover antes de commitar
  (o projeto usa `bun.lock`).
- **`tsc` exige node_modules instalado** (erro `Cannot find type definition file
  for 'vite/client'` quando não há deps).
- **Validação recomendada antes de commitar:** `tsc --noEmit` + `vite build`
  (ambos passaram na entrega da feature).

## Fluxo Git / PR

- Branch de desenvolvimento: **`claude/filtro-lances-por-dia-15k3uq`**.
- PR **#32** ("Adiciona aba e filtro Lances por dia e por casa") — **mesclado**
  (squash) no `main`.
- Como o PR foi mesclado, trabalho novo deve **reiniciar a branch a partir do
  `main` atualizado** (mesmo nome de branch) — não empilhar sobre histórico já
  mesclado. Rodão: `git fetch origin main && git checkout -B <branch> origin/main`.
- Atenção: o `main` avança rápido (vários PRs `claude/*` sendo mesclados);
  sempre partir do `origin/main` mais recente antes de começar.

## Próximos passos / ideias em aberto

- (nada bloqueante) Possível: distinguir visualmente "Vencedor" (leilão passado)
  da cor verde de "Vencendo" também na **borda** do `LotCard` — hoje ambos usam
  verde via `bidIsWinning`; só os badges/contadores separam os dois.
- Considerar alinhar o repo ao prettier em um commit isolado **de formatação**
  (se o mantenedor quiser), separado de features.

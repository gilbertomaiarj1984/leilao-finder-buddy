# Notas de desenvolvimento — Garimpo de Vinil

> Documento de continuidade entre sessões. Descreve **arquitetura, mecânica dos sites
> de leilão, decisões e pendências**. O código é refatorado com frequência (helpers
> mudam de arquivo); prefira **procurar por nome de função** (`grep`) a confiar em
> caminhos/linhas exatos.

## O que é o app

App que garimpa **discos de vinil** em leilão no **LeilõesBR** e casas parceiras,
agrupando por **dia → casa de leilão → artista**, com **vigia** e **lances**
sincronizados com a conta do usuário. Stack: **TanStack Start + React 19 + Supabase**,
deploy na **Vercel** (Nitro). _(Migrado do Lovable em 2026-08 — ver a última seção.)_

## Restrições do ambiente (importantes)

- **Não dá para testar scraping/lance daqui** (sem rede para os sites de leilão) —
  validar por análise estática + `bun -e` de funções puras; o **usuário** testa na
  prévia/produção.
- **`bun install` funciona** (npm público no `bunfig.toml`), então `bun run build`,
  `bunx tsc --noEmit` e `bun run lint` rodam localmente.
- **Migrações `.sql` do repo NÃO são auto-aplicadas** — o schema é recriado via
  `supabase/setup.sql` (SQL Editor ou `psql -f`). As tabelas (`lots`, `known_artists`,
  `app_state`, `seen_auctions`) já existem no projeto Supabase.
- **Git push HTTPS costuma funcionar**; quando não, usar os tools `mcp__github__*`.
  Fluxo: branch de trabalho → PR → merge.
- **Recriar a branch a partir de `origin/main`** antes de cada tarefa (a `main` pode
  receber commits de outras sessões/PRs).
- Ao interagir com o usuário: **responder em português**.

## Arquitetura de dados

- Leitura normal (abrir o app) **lê só do banco/cache** — NÃO varre o site (uma
  varredura completa estoura o tempo do servidor e deixava a tela vazia).
- **Popular** os dados é sob demanda / agendado, em **blocos** (chunks) para caber no
  tempo do servidor:
  - `scrapeVinylChunk(fromPage, size)` — varre um bloco de páginas da listagem geral.
  - `enrichMissingLotes(maxAuctions, offset)` — preenche nº de lote via catálogo (ver
    abaixo). Usa **cursor `offset`** sobre a lista **estável e ordenada** de todos os
    leilões da janela (não repete os primeiros); retorna `{updated, total, nextOffset, done}`.
- Camadas: `memCache` (módulo, garante a lista mesmo sem banco) + tabela **`lots`**
  (durável, upsert por `id`, merge — nunca apaga o que não veio) + `app_state`
  (baseline do painel “desde o último acesso”, chave `dashboard_baseline`).
- `id` do lote = `"${idLeilao}-${idPeca}"`. Janela = **5 dias** (`WINDOW_DAYS`).

## Painel de mudanças (`dashboard.tsx`) — mecânica do baseline

- **Baseline = snapshot global** de `{lotId: price}` em `app_state` (chave única
  `dashboard_baseline`, um registro para o app todo). `getBaseline`/`markSeen` usam o
  **service role** (`supabaseAdmin`, ignora RLS). A coluna “Últ. acesso” mostra o preço
  do snapshot; “Variação” = `computeDelta(atual, baseline[lot.id])` → `novo` quando a
  chave **não existe** no baseline.
- **Semente automática na 1ª visita** (`baselineSeeded` ref + `markSeen({silent:true})`):
  sem isso o baseline nasce vazio e **tudo aparece como “novo” e sem “último acesso”**.
  Na visita em que semeia, os itens ainda saem como “novo” e só depois viram “—”; a
  variação real aparece **a partir da visita seguinte**. O botão “Marcar como visto”
  (`silent:false`) reancora o baseline quando o usuário quiser.
- **Enrich no painel** (`enrichRan` ref): igual à listagem, ao abrir roda o laço
  `enrichLotes({max,offset})` **uma vez** quando há lote sem `lote`, em segundo plano,
  e ao terminar faz `setQueryData(["vinyl-lots"], fresh)`. Sem isso, só lotes com
  vigia/lance (overlay `loteById`) mostravam número — os demais ficavam “—”.
- `markSeen` (server, `app-state.server.ts`) **propaga** erro de gravação (antes engolia
  e retornava “sucesso”, mascarando baseline que nunca persistia).

## Como o LeilõesBR funciona (scraping)

- **Varredura geral é PÚBLICA** (sem login) via `publicFetch` — evita o 500 que o site
  dá em sessão logada sob carga. Categoria fixada por `tp=|446973636F2064652076696E696C|`
  (hex de “Disco de vinil”), então **todo lote já é vinil** → não exigir palavra-chave no
  título; só descartar CD/DVD/K7 (`looksNonVinyl`, em `vinyl-parse.ts`).
- **Login (`authFetch`)** só para a **conta**: credenciais em env `LEILOESBR_EMAIL` /
  `LEILOESBR_SENHA`. Endpoints da conta:
  - **Vigias**: `conta_site.asp?l=8` → `listWatchedFromSite` (cards `.oc-item`, `data-watch="idPeca,email,idLeilao,base"`, preço em `<b class="pb-1">`).
  - **Meus lances**: `conta_site.asp?l=4` → `listMyBidsFromSite` (mesmos `.oc-item`;
    **meu lance** em `.product-price b.pb-1`, **status** na classe/ícone `lstatus`:
    `Coberto`, `Vencendo`, `Vencedor`, `Coberto e Vendido`, `Não vendido`).
  - Toggle vigia: `POST vigiar_peca.asp` (`idpeca/idcliente/idleilao/base`, resposta `+`/`-`).

## Nº do lote (detalhe crítico)

- **A listagem geral NÃO traz o nº do lote** (confirmado). Ele só existe no **catálogo
  da casa**. O link de cada lote embute tudo:
  `abre_catalogo.asp?t=1|<domínio-da-casa>|<idLeilao>|<idPeca>` → `parseAuctionRef`
  extrai domínio + idLeilao (então **cada casa usa a própria URL**, automaticamente).
- `fetchLoteMap(domain, idLeilao)` busca **`<domínio>/catalogo.asp?Num=<idLeilao>`**
  (público) e cruza `idPeca → nº do lote`. **1 requisição por leilão**, não por lote.
- **Parser por posição** (`parseCatalogLotes`, em `leiloesbr-catalog.server.ts`): NÃO
  depende da classe do container (o catálogo completo tem `peca.asp?ID` + `LoteProd`
  fora de `.prod-box`, que só aparece nos “destaques” do `leilao.asp`). Para cada
  `peca.asp?ID=<idPeca>`, pega o `Lote: <n>` (bloco `LoteProd`) no trecho até a próxima
  `peca.asp`.
- **Casas fora da plataforma LeilõesBR** (ex.: `abreucolecionismo`,
  `arteseantiquariobenjamin`) renderizam o catálogo via JS → `peca.asp` não vem no HTML
  → **não rendem número** por esse caminho. Essas continuam cobertas pelo **overlay**:
  vigias (`l=8`) e lances (`l=4`) trazem o `lote`, sobreposto por `idPeca` no
  painel/cards (mapa `loteById`).
- Diagnóstico disponível: `GET /api/cron?step=catdebug&token=…` sonda os catálogos das
  casas dos primeiros leilões sem número (status/tamanho/contagem de cards/amostra).

## Cores (padrão do sistema)

- **Verde** = tenho lance e estou ganhando/arrematei (`bidIsWinning(status)` casa
  `venc|arremat|arrebat`). **Vermelho** = tenho lance mas coberto. **Amarelo** = só
  vigiado (sem lance). Precedência: lance vence vigia.
- Helpers de classificação/agrupamento ficam em `src/components/vinyl/grouping.ts`
  (`classifyBid`, `houseAnchor`, `computeHouseStats`, `watchedMatchesSearch`,
  `groupWatchedByHouse`, etc.) após refatoração.
- **Busca das abas de dia:** ranqueada por `searchRelevance` (identidade primeiro, casa/nº
  do lote como campos fracos); com busca ativa, vira **lista única por relevância** (ver
  sessão v0.13.0). **Vigiados/lances:** `watchedMatchesSearch(lot, searchNorm)` casa por
  **título/artista/casa/nº do lote** (casamento contíguo; ainda **sem** ranqueamento).
  `groupWatchedByHouse<T>(lots)` agrupa por casa e ordena por **nº do lote** (numérico
  primeiro, depois lexicográfico); é genérico e reutilizado para **vigiados** e **meus
  lances** (`bidsByHouse`). A aba **“Vigiados”** (ver todos) e a **“Vigiados do dia”**
  respeitam a busca e são apresentadas **por dia → casa** (mesmo layout das abas de dia,
  usando `dayLabel`); o contador da aba reflete o resultado da busca.
- **Badges por casa (ao lado do nome):** `HouseStatBadges` em
  `src/components/vinyl/badges.tsx`, alimentado por `computeHouseStats` (em
  `grouping.ts`, tipo `HouseStats = {vigia, green, red}`). As três contagens são
  **mutuamente exclusivas** e seguem a precedência de cor (lance verde/vermelho vence
  vigia). Usado em `index.tsx` nos três pontos onde o nome da casa aparece: chips de
  navegação, seções por casa e “Vigiados do dia”. Há também `BidStatBadges` +
  `computeBidStats` para a visão “Meus lances”.

## Valores do lote: atual / próximo / meu lance (conceito)

Três valores diferentes, de **fontes diferentes** — não confundir:

- **Valor atual** = `price`. Vem do `.venda-price` na listagem geral; nas páginas de
  conta vem em `<b class="pb-1">` (vigia `l=8` e lances `l=4`).
- **Meu lance** = `myBid`. Só existe na página **"Meus lances"** (`l=4`).
- **Próximo lance** = **NÃO existe na listagem nem nas páginas de conta.** Só está no
  **detalhe do lote** (`peca.asp`), que embute um JSON `loadData`: **`data[0].NOVO_VALOR`**
  é o próximo lance já calculado pelo site (e `VALOR_VALUE` = valor atual, `VENCENDO`,
  `MOSTRABTN_STATUS` = status, `LOTENUM` = nº do lote). **Só o lote ABERTO traz
  `NOVO_VALOR`** — os itens de `data.listalotes` (catálogo) têm `VALOR_VALUE` mas **não**
  `NOVO_VALOR` → é **1 requisição por lote**. Por isso o próximo lance é buscado só para
  **vigiados + lances** (conjunto pequeno), nunca para a listagem inteira.
  - Implementação: `src/lib/leiloesbr-lot-details.server.ts` (`fetchNextBids`, monta
    `<domínio>/peca.asp?id=<idPeca>` via `parseAuctionRef` ou a própria URL da peça,
    concorrência 8, teto 100, regex `"NOVO_VALOR":"(\d+)"` → BRL) → server fn
    `getNextBids` → query `["next-bids", key]` no `index.tsx` (só vigiados+lances,
    `staleTime` 3min) → mapa `nextBidById` sobreposto nos cards. Não persiste (o valor
    muda com os lances; busca ao vivo com cache curto).
  - **NÃO inferir o incremento** por conta própria: o texto de "Termos" da casa cita "5%
    em múltiplos de dez", mas o `NOVO_VALOR` real diverge disso (ex.: atual 20 → 25). O
    valor autoritativo é o `NOVO_VALOR` do próprio site.
- **`base`** (do `data-watch="idPeca,email,idLeilao,base"`) **NÃO é o incremento** — é a
  "base"/plataforma (nas queries de conta, `b=0` = base LeilõesBR). Não usar como próximo lance.
- **Regra de UI (card):** todo lote mostra **"Atual"**; **"Próximo"** quando houver
  `nextBid`; **"Meu lance"** quando houver `myBid` (numa linha **abaixo** do Atual/Próximo).
- **Correção do "Atual" quando estou VENCENDO:** a listagem pública traz o valor
  **defasado** (anterior ao meu lance vencedor). Como quem vence detém o maior lance, o
  valor atual **É o meu lance** → o `LotCard` usa `myBid` como "Atual" quando
  `bidIsWinning(status)`. Coberto continua com o valor da listagem (o lance que me cobriu).
  Por isso `myBid` é passado a **todos** os cards (abas de dia/vigiados também, via
  `myBidById`), não só em "Meus lances" — senão o mesmo lote apareceria com valor
  diferente entre abas.
- **"Meus lances" (`l=4`) não traz o valor atual** → casar por **`id`
  (`${idLeilao}-${idPeca}`)** com a varredura geral (`priceById` no `index.tsx`, mesma
  ideia de `loteById`/`houseUrlByName`) para exibir o "Atual" nesses cards.

### Referência: JSON `loadData` do `peca.asp` (fonte rica)

A página `<domínio-da-casa>/peca.asp?id=<idPeca>` (pública, o JSON vem mesmo deslogado)
embute `var loadData = { "data":[…], "listalotes":[…], "navinfo":[…] };`. Campos úteis:

- **`data[0]`** (o lote ABERTO):
  - `ID` (idPeca), `NUMLEILAO`/`ID_LEILAO` (idLeilao), **`LOTENUM`** (nº do lote),
    `PECA`/`DESCRICAO` (título).
  - **`VALOR_VALUE`** = valor atual · **`NOVO_VALOR`** = próximo lance (já calculado) ·
    `VALOR_LABEL` = `"Valor atual:"` ou `"Valor inicial:"` (sem lances ainda).
  - `VENCENDO` (bool) · `MOSTRABTN_STATUS` (`"Não vendido"`, etc.) · `QTDLANCE` (nº de
    lances) · `VALMAX` · `ULTIDCLI` (id do último cliente que lançou) · `VPASTA` (imagem).
- **`data[0].listalotes[]`** = o **catálogo INTEIRO** do leilão. Cada item traz `ID`,
  **`LOTENUM`**, `MINI_DESCRICAO`, **`VALOR_VALUE`** (atual), `VALMAX`, `QTDLANCE`,
  `ULTIDCLI`, `MOSTRABTN_STATUS` — mas **NÃO** `NOVO_VALOR`. → **fonte alternativa em
  massa** de nº de lote + valor atual (1 requisição pega o leilão todo); útil para casas
  cujo catálogo HTML é JS-rendered (onde `parseCatalogLotes` do `catalogo.asp` falha).
- **`data[0].navinfo[]`** = `{PREVID, NEXTID}` (navegação anterior/próximo lote).

> **Só `data[0]` tem `NOVO_VALOR`** — por isso o próximo lance é 1 req/lote. Mas se um dia
> precisar de nº de lote/valor atual em massa para casas JS-rendered, o `listalotes` de
> **um** `peca.asp` do leilão resolve o leilão inteiro.

## Casas verificadas: persistência (conceito)

- **"Marcar casa como verificada"** (chave `${dia}|${casa}`) agora **PERSISTE no
  servidor**: `app_state`, chave `verified_houses` (array global, mesmo modelo do
  baseline). Server fns `getVerifiedHouses` / `setVerifiedHouses` (em
  `app-state.server.ts` + `leiloesbr.functions.ts`).
- **Por que mudou:** antes ficava **só no `localStorage`** do navegador → perdia ao
  trocar de navegador/dispositivo, limpar dados do site ou usar a **URL de preview**
  (origem diferente da produção → outro `localStorage`). Foi assim que a marcação
  "sumiu numa atualização".
- **localStorage vira cache** (pinta a tela na hora); a fonte da verdade é o servidor.
  No 1º load há **migração única** localStorage → servidor (não perde o que já existia).

## Última atualização da lista (conceito)

- `getVinylLots` retorna **`updatedAt`** = maior `updated_at` da tabela `lots` na janela
  (o trigger `update_lots_updated_at` toca a coluna a cada upsert); fallback `memCache.at`.
  Exibido sob o botão **"Atualizar tudo"** (`formatUpdatedAt`, fuso São Paulo).

## Atualização em background (4x/dia)

- **Endpoint** `/api/cron` (tratado direto em `src/server.ts`, FORA das server functions
  → sem Supabase/CSRF), protegido pelo segredo **`CRON_TOKEN`** (lido de `process.env`;
  token pode vir no header `x-cron-token` ou na query `?token=`). Steps: `chunk` (varre
  bloco), `enrich` (com `offset`), `catdebug`.
- **GitHub Actions** `.github/workflows/refresh.yml`: `cron: "0 3,9,15,21 * * *"` (UTC =
  BRT 00/06/12/18h) + `workflow_dispatch`. Varre em blocos até `nextPage:null`, depois
  enriquece por `offset` até `done:true`.
- **Configuração (fora do código):** GitHub secrets `APP_URL`
  (`https://leilao-finder-buddy.vercel.app`) e `CRON_TOKEN`; e a env `CRON_TOKEN` na
  **Vercel** (mesmo valor). O `CRON_TOKEN` **não** está no repo.
- O **“Atualizar tudo”** manual na UI continua existindo (faz chunk + enrich por cursor).

## Ferramenta separada: lance no fechamento (missleiloes)

- `tools/missleiloes-sniper.user.js` — userscript (Tampermonkey/bookmarklet) que roda **na
  página do pregão ao vivo** do missleiloes (plataforma white-label; `@match
*/presencial/presencial.asp*`). NÃO faz parte do app.
- Mecânica descoberta: pregão **ao vivo com soft-close** (cada lance **reinicia** o
  cronômetro). Objeto global **`novoPresencial`**: polling (~1s) via `LePregao`
  (`defineLeRegistro` → `le_registro_pregao_cfbr_v1.asp`), estado em `statusatual`
  (P→X→1/2/3(VOU BATER)→4(FECHANDO)→F), `valorpecaatual` (próximo lance já calculado),
  `lancevencedor`; lance por **`Fazerlance()`** → `POST lote_fazerlance.asp`
  (`idpeca/valor/leilao`). O site **desabilita o botão no 4**; `Fazerlance` só bloqueia
  `'F'`. Incremento pela função global `incremento()`.
- v3 do script: **um lance único no status 4 (FECHANDO)**, com Turbo (polling próprio
  ~250ms) e confirmação pós-lance. Sniping clássico não existe no soft-close; a vantagem
  é reagir mais rápido que humanos no último instante.

## Feito recentemente

- **Revisão geral + refatoração pós-Lovable** — ✅ concluído (PRs #34, #36, #37;
  footer em #35). Passada de limpeza sobre o código herdado, em fases:
  - **Lint/format**: `prettier --write` em todo o repo (nunca havia passado pelo
    formatador → `bun run lint` tinha ~515 erros). `src/integrations/supabase/types.ts`
    (gerado) e `tools/` (userscript) passaram a ser **ignorados** no ESLint/Prettier
    (ver `eslint.config.js`/`.prettierignore`); 2 regex com escape inútil corrigidas.
    `bun run lint` fica verde (só 2 warnings de shadcn em `badge`/`button`).
  - **Remoção de morto**: −36 componentes shadcn não usados (sobraram os 10 em uso —
    badge, button, command, dialog, input, popover, select, skeleton, sonner, tabs) e o
    hook `use-mobile`; **−31 dependências** (`recharts`, `react-hook-form`, `zod`,
    `date-fns`, `@hookform/resolvers`, ~21 `@radix-ui/*`, etc.); removido o `.lovable/`.
  - **Dedup**: helper de fetch do Supabase (chave nova `sb_*`, remove o `Authorization`
    bearer e usa só `apikey`) extraído para `src/integrations/supabase/api-fetch.ts`
    (antes copiado em `client.ts`, `client.server.ts`, `auth-middleware.ts`).
  - **Cloudflare/Wrangler**: removidos resíduos do `.gitignore` e o fallback de
    `CRON_TOKEN` via binding `env` no `cron.server.ts` (alvo é só Vercel; token vem de
    `process.env`).
  - **Split do `index.tsx`** (1774 → ~1070 linhas): lógica movida para
    `src/components/vinyl/` — `grouping.ts` (helpers puros + tipos), `badges.tsx`,
    `filters.tsx`, `lot-card.tsx`, `bid-house-sections.tsx`, `live-auctions.tsx`. Sem
    mudança de comportamento. (É por isso que as seções de mecânica acima citam esses
    módulos.)
  - **Correções do code-review + security review** (limpo): ordenação de lote **vazio ao
    fim** (`Number("")` é 0, não NaN) em `groupWatchedByHouse`/`loteNum`; `houseAnchor`
    deduplicado (agora só em `grouping.ts`); e a cor de lotes **"Arrematados"** unificada
    em verde — `bidIsWinning` passou a casar `venc|arremat|arrebat` (igual ao
    `classifyBid`), com referência cruzada entre as duas funções (ver seção **Cores**).
- **Rodapé global + versão** — ✅ concluído (PR #35). `src/components/Footer.tsx` +
  `src/lib/version.ts` (`APP_VERSION`, fonte única; bump a cada release) no layout raiz
  (`__root.tsx`, `flex min-h-screen flex-col`). `package.json` ganhou o campo `version`.
- **Painel: baseline + nº de lote na 1ª visita** — ✅ concluído (PR #30). Corrigiu os
  três sintomas relatados: (a) nº do lote sumido para lotes **sem vigia/lance** →
  enrich passa a rodar também no painel; (b) “último acesso” vazio e (c) variação
  sempre “novo” → **semente automática** do baseline quando ainda não existe; e o
  `markSeen` deixou de mascarar erro de gravação. Detalhe na seção **Painel de
  mudanças**. (Merge trouxe também refino de `loteNum`/ordenação de lote vazio ao fim.)
- **Busca + vigiados por dia/casa** — ✅ concluído (PR #31, mesclado). A aba
  **“Vigiados”** (ver todos) passou a **respeitar a busca principal** e a ser
  apresentada **separada por dia e casa de leilão** (antes era uma grade plana), no mesmo
  layout das abas de dia. Extraídos `watchedMatchesSearch` e `groupWatchedByHouse`
  (ver seção **Cores**), depois movidos para `grouping.ts` e reutilizados também em
  “Meus lances”. (Merge via `mcp__github__merge_pull_request`.)
- **Badges por casa (UI)** — ✅ concluído (PR #29). Ao lado do nome da casa, além do
  nº de lotes, mostra **nº de vigia (amarelo)**, **nº com lance coberto (vermelho)** e
  **nº ganhando (verde)**, padronizado em todos os pontos onde o nome da casa aparece.
  Ver detalhe na seção **Cores** (`HouseStatBadges`/`computeHouseStats`).

## Pendências (próximas sessões)

0. **Próximo lance (`peca.asp`):** ✅ feito para **vigiados + lances** (via `NOVO_VALOR`
   do `peca.asp` — ver seção **Valores do lote**). Estender para "todos os lotes" segue
   inviável (1 req/lote); se um dia for necessário, precisaria de outra fonte em massa.
1. **Lance pelo sistema (leiloesbr):** avaliar/implementar dar lance pelo app. Regras do
   usuário: sempre o **próximo menor valor permitido**; após lançar, **verificar nos
   segundos seguintes se foi coberto** (o lance automático de outro pode cobrir) e,
   se for o caso, relançar. **Bloqueio atual:** não temos o **endpoint de lance do
   leiloesbr** nem a **regra de incremento** dele — precisa que o usuário **capture**
   (F12 → Network, num lote barato) a requisição de lance (URL/params/resposta) ou o JS
   que a dispara. Considerar que o leiloesbr provavelmente já tem “lance automático”
   nativo (pode ser mais seguro). ToS/edital costumam proibir automação — decisão/risco
   do usuário.
2. **Confirmar em produção** que o `enrich` por cursor passou a preencher os números
   (casas da plataforma, ex.: bruce) após o deploy — rodar o workflow e ver `updated>0`.
   Confirmar também no **painel** (que agora dispara enrich ao abrir) que os lotes sem
   vigia/lance passam a mostrar número.
3. **Validar o baseline do painel em produção** (PR #30): 1ª visita deve semear (todos
   “novo” só nessa visita) e a **2ª visita** já mostrar variação/“último acesso”. Se
   persistir tudo “novo”, o `markSeen` agora **lança** o erro real (toast) — investigar a
   gravação em `app_state` (era mascarada antes).

## Convenções de trabalho

- Branch de trabalho recriada de `origin/main` a cada tarefa (a `main` avança sozinha).
- Rodapé de atribuição em qualquer post no GitHub. Commits terminam com
  `Co-Authored-By: Claude ...`.
- Não colar páginas HTML inteiras no chat (consomem muito contexto/tokens) — pedir só o
  bloco relevante (um card) quando precisar de HTML de um site.

---

## Migração: saída do Lovable → Supabase próprio + Vercel (2026-08-25)

> Registro da migração para continuidade. A mecânica do app descrita nas seções
> acima (scraping, baseline, nº de lote, cores) continua válida.

### Build / Auth (detalhes de implementação)

- **Deploy agora é a Vercel**, não Cloudflare. O Nitro é um **plugin Vite separado**
  (`import { nitro } from 'nitro/vite'` no `vite.config.ts`) e **auto-detecta a Vercel**
  via `process.env.VERCEL` (preset forçável por `SERVER_PRESET`/`NITRO_PRESET`). O build
  gera `.vercel/output` (Build Output API v3). `vercel.json`: `bun run build`,
  `bun install`, `framework: null`.
- **`bun install` funciona** agora: `bunfig.toml` aponta para o **npm público**
  (`registry.npmjs.org`) e o `bun.lock` foi regenerado (a registry privada do Lovable
  dava 403). Logo, `bun run build` / `bunx tsc --noEmit` / `bun run lint` rodam local.
- **Auth é Supabase Auth nativo** (Google, **PKCE**) — saiu o broker
  `@lovable.dev/cloud-auth-js`. Fluxo em `src/routes/auth.tsx`: `signInWithOAuth`
  com `redirectTo: origin + '/auth'` → volta em `/auth?code=...` →
  `exchangeCodeForSession(code)`. Client com `flowType:'pkce'` e
  `detectSessionInUrl:false` (`src/integrations/supabase/client.ts`).
- **Schema**: consolidado em `supabase/setup.sql` (recria tabelas/triggers/RLS em um
  projeto novo). As migrations continuam não sendo auto-aplicadas — quem aplica agora é
  você (SQL Editor ou `psql -f`).
- **Registry/lint**: os erros `prettier/prettier` em massa eram dos arquivos gerados
  pelo Lovable (aspas simples); pré-existentes, não faziam parte da migração.

### Infra atual

- **Supabase**: projeto `rjqzzxhgcelixlgnfcic` (`https://rjqzzxhgcelixlgnfcic.supabase.co`).
  `supabase/config.toml` atualizado. RLS mantém tudo só para `service_role` (o front não
  lê o banco direto; server functions usam `supabaseAdmin`).
- **Vercel**: produção em `https://leilao-finder-buddy.vercel.app` (branch `main`).
  Previews de PR usam URL com hash que **muda a cada deploy**.
- **Auth (Supabase → Authentication → URL Configuration)**:
  - Site URL: `https://leilao-finder-buddy.vercel.app`
  - Redirect URLs: `https://leilao-finder-buddy.vercel.app/**`,
    `https://leilao-finder-buddy-*-gilbertomaiarj1984s-projects.vercel.app/**` (previews),
    `http://localhost:3000/**`.
  - Google OAuth configurado no Supabase (Providers → Google); no Google Cloud, o
    Authorized redirect URI é `https://rjqzzxhgcelixlgnfcic.supabase.co/auth/v1/callback`.
- **Env vars** (ver `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `LEILOESBR_EMAIL`, `LEILOESBR_SENHA`, `CRON_TOKEN`. Na Vercel devem estar em
  **Production**; mudar env exige **Redeploy**. O `.env` saiu do Git (gitignored).
- **Segredos rotacionados** após a migração: senha do banco e `service_role`
  (`sb_secret_`). A `publishable` (`sb_publishable_`) é **pública** por design.

### Como os dados foram migrados

- Export do Lovable = `.backup` (`pg_dump -Fc`, dump do banco inteiro).
- Recriamos só `public` com `setup.sql` e restauramos **só os dados**:
  `pg_restore --data-only --no-owner --no-privileges --schema=public -d <conn> arquivo.backup`.
- Usuários do `auth` **não** migrados (login refeito com Google; acesso gated por
  `LEILOESBR_EMAIL`).

### Pendências desta migração

- [x] Secrets do cron no GitHub (`APP_URL`, `CRON_TOKEN`) e validar 1ª execução do
      workflow `refresh.yml` — a atualização periódica 4×/dia está no ar (ver
      **Atualização em background**).
- [ ] (Opcional) Rotacionar o `CRON_TOKEN` (gerado em chat na migração).
- [x] (Opcional) Commit dedicado de formatação (prettier) nos arquivos herdados do
      Lovable — feito na revisão geral (PR #34, fase de lint/format).

---

## Sessão 2026-08-26 — Rodapé + versionamento do app

> Branch `claude/footer-versioning-4646i5` · PR
> [#35](https://github.com/gilbertomaiarj1984/leilao-finder-buddy/pull/35).

### O que foi feito

- **Fonte única da versão:** `src/lib/version.ts` exporta `APP_VERSION` (semver). É o
  **único** lugar para dar bump. Começou em `0.1.0`. `package.json` também recebeu
  `"version": "0.1.0"` para o campo ficar consistente.
- **Rodapé global:** `src/components/Footer.tsx` lê `APP_VERSION` e exibe `v{versão}`,
  usando os tokens de design (`border`/`muted-foreground`/`card`).
- **Montagem no root:** `<Footer />` foi adicionado ao `RootComponent` de
  `src/routes/__root.tsx`, dentro de um wrapper `flex min-h-screen flex-col` (conteúdo em
  `flex-1`) → aparece em **todas** as rotas via `<Outlet />` e fica sempre no fim da página.
- Validado: prettier, `bun run lint` (só os warnings pré-existentes em `ui/badge` e
  `ui/button`), `bunx tsc --noEmit` e `bun run build` — todos verdes.

### Convenção de versionamento (usar nos PRs)

- **Bump em `src/lib/version.ts` (`APP_VERSION`) + `package.json` em TODO PR**
  (obrigatório), seguindo semver: **PATCH** = correção; **MINOR** = nova funcionalidade
  compatível; **MAJOR** = mudança incompatível.
- **Enforço por CI:** `.github/workflows/version-bump.yml` roda em todo `pull_request`
  para a `main` e **falha** se `APP_VERSION` não for maior que a da base.
- **Colocar o número da versão no título do PR** (ex.: `v0.2.0 — filtro por casa`).
- O rodapé em produção mostra a versão no ar → confirma visualmente qual PR foi implantado.
- Versão atual: **v0.2.0** (subiu de 0.1.0 ao introduzir a regra + acumular as features
  recentes: valor atual/última atualização/casas verificadas).

### Observação de processo (aprendizado)

- Este arquivo **já existia na `main`**; a branch de trabalho tinha sido criada de uma
  base anterior à sua criação. Ao criar o arquivo "do zero" na branch, houve conflito
  add/add contra a `main`, resolvido mesclando `origin/main` e mantendo o conteúdo real +
  **acrescentando esta seção ao final**. Reforço da convenção já registrada: **recriar/
  atualizar a branch a partir de `origin/main` antes de cada tarefa** e, ao "mesclar
  notas", **fazer fetch da `main` e só então acrescentar ao final**.

### Ideias em aberto

- (Opcional) Acompanhar o PR #35: reagir a falhas de CI e comentários de review.
- (Opcional) Automatizar/validar o bump da versão em CI (garantir que `APP_VERSION` foi
  incrementado quando o PR muda código do app).
- (Opcional) Exibir também commit/data do build no rodapé, se ajudar a rastrear deploys.
- [x] Commit dedicado de formatação (prettier) nos arquivos herdados do Lovable — feito
      na revisão geral (PR #34, fase de lint/format).

---

## Sessão 2026-08-26 — IA de avaliação de lotes + página "Análise de Lotes" (v0.4.0)

> Branch `claude/ia-avaliacao-lps-dn0qkj`. Objetivo: uma IA **de baixo custo** avalia os
> lotes garimpados e sugere as melhores obras/oportunidades; página nova ranqueada por
> nota + nota no canto do card no site principal.

### Como funciona a IA (mecânica)

- **Modelo/custo:** `claude-haiku-4-5` (o Claude mais barato) via **Batches API** da
  Anthropic (~50% do preço, assíncrona). Chave em **`ANTHROPIC_API_KEY`** (`process.env`;
  secret no GitHub + env na Vercel). **Opcional:** sem a chave, tudo faz **no-op** e o app
  segue normal (só não mostra nota).
- **1 request de batch por lote** (`custom_id = lots.id`): o mapeamento resultado→lote fica
  trivial e robusto entre **submeter** e **coletar** (execuções diferentes do cron). Custo
  em **centavos** (single-user, poucas centenas de lotes).
- **Cache por título:** tabela **`lot_ai`** (`supabase/setup.sql`; RLS só service_role) com
  `title_hash` (djb2→base36 do título). Só entram lotes **sem avaliação ou com título
  mudado** (`selectLotsToEvaluate`) → rodadas seguintes custam ~zero. **Aplicar o
  `setup.sql` no Supabase** (não é auto-migrado); `types.ts` recebeu a tabela à mão.
- **Camada isolada** (ponto plugável): `src/lib/ai-eval.server.ts` (funções puras +
  `submitEvalBatch`/`collectEvalBatch`, SDK importado dinamicamente) e
  `src/lib/lot-ai.server.ts` (`getAllLotAi`/`upsertLotAi`). Saída por lote:
  `score`(0-100), `rarity`(comum→muito_raro), `deal`(caro/justo/barato/indefinido),
  `album` (identificação), `reason`, `tags[]`. Parsing tolerante a cercas (`parseEvalObject`).
- **Visão (capa):** quando o lote tem `image` http(s), ela vai como bloco `image`
  (source `url`, ANTES do texto) no request — o Haiku 4.5 usa a capa para **identificar** o
  disco (título do leilão costuma ser genérico) e devolve `album` (artista/álbum), exibido
  no overlay/coluna. `usableImage` descarta URLs não-http (ex.: `data:`). Sem imagem, é
  texto puro. Custo por imagem é pequeno (thumbnail), ainda em centavos no batch.
- **`matchesInterests` é do servidor/UI, NÃO da IA:** `buildInterestMatcher`
  (`ai-score-utils.ts`) casa a lista de interesses (`app_state` chave `user_interests`)
  com o título via `normalizeForMatch` — determinístico e barato, não gasta tokens.

### Cron (assíncrono)

- Novo **`step=aieval`** em `cron.server.ts` (mesmo `CRON_TOKEN`), idempotente: lê
  `app_state.ai_batch` (`{batchId, submittedAt, hashes}`); se há batch pendente **coleta**
  (grava `lot_ai` + limpa a chave); senão **submete** os lotes selecionados. Lê os lotes da
  janela via `scrapeVinylLots(false)` (banco/cache, sem varrer o site).
- **`.github/workflows/refresh.yml`:** após o `enrich`, laço curto de `aieval` (com `sleep`)
  para submeter e tentar coletar na mesma run; se o batch ainda processa, a execução
  6-horária seguinte coleta.

### UI

- **Nova rota `src/routes/_authenticated/analise.tsx`** (nos moldes do `dashboard.tsx`):
  **Top 100 por nota** no topo + abaixo **por dia → casa** ordenado por nota, com o mesmo
  **expandir/retrair** (nav sticky, `houseAnchor`) e apresentação de valores. Botão **"Meus
  interesses"** (dialog + textarea → `setUserInterests`). Link **"Análise"** no header do
  `index.tsx`.
- **Site principal inalterado**, só a **nota no canto superior direito do card**
  (`ScoreCorner`) com **overlay ao passar o mouse/focar** mostrando o que compõe a nota
  (raridade, oportunidade, match, motivo, tags). Componentes em
  `src/components/vinyl/ai-score.tsx`; helpers puros em `ai-score-utils.ts` (arquivos
  separados por causa do react-refresh, e o nome `.ts`/`.tsx` **não pode colidir** —
  o especificador resolve `.ts` antes de `.tsx`).
- Query `["lot-ai"]` + `["user-interests"]` no `index.tsx` e na Análise; `aiFor(lot)` junta
  a avaliação (por id) com o match de interesses (do título).

### Pendências desta feature

- [ ] **Configurar `ANTHROPIC_API_KEY`** (secret no GitHub + env na Vercel) e **aplicar o
      `lot_ai` do `setup.sql`** no Supabase; então disparar `refresh.yml` e conferir
      `submitted>0`/`collected>0` e a página Análise populada.

## Sessão 2026-08-26 — Âncora de mercado via Discogs (v0.5.0)

> Mesma branch. Adiciona preço/demanda **real** do Discogs para embasar a nota/oportunidade.

- **API Discogs** (`api.discogs.com`, grátis; rate limit **60 req/min com token**). Endpoints:
  `GET /database/search?type=release&q=…` (acha `release_id`), `GET /marketplace/stats/{id}?curr_abbr=BRL`
  (menor preço + nº à venda), `GET /marketplace/price_suggestions/{id}` (sugerido por condição,
  **exige token**), e `community.{have,want}` (demanda). ≤3 requisições por lote casado.
- **Env `DISCOGS_TOKEN`** (GitHub secret + Vercel). **Opcional:** sem ele, o passo faz no-op.
- **Camada** `src/lib/discogs.server.ts` (sem SDK; `fetch` + **throttle** ~1.1s respeitando o
  rate limit; parsing **defensivo**). Puras: `buildQuery` (usa o `album` da IA, limpa "lote…",
  ignora coletânea), `pickBestRelease` (overlap de tokens + vinil), `computeMarketDeal`,
  `pickSuggested`. Persistência `src/lib/lot-market.server.ts` (tabela **`lot_market`**, cache
  por `basis` = hash de album||título; `matched=false` não reconsulta).
- **Cron** novo `step=market` (chunked, `max` por rodada, no-op sem token) + laço no
  `refresh.yml` após o `aieval`. Lê os lotes via `scrapeVinylLots(false)`.
- **Matching é best-effort:** só casa lotes de 1 disco identificável (a capa/`album` ajuda);
  coletâneas/"lote com N" ficam `matched=false`.
- **UI:** `getLotMarket` server fn + query `["lot-market"]`; `LotMarket`/`marketDeal`/`fmtMoney`/
  `toLotMarket` em `ai-score-utils.ts`. O overlay do card e a coluna da Análise mostram
  **menor preço à venda, sugerido (condição), procura/oferta** e um chip **barato/justo/caro vs.
  mercado** (recalculado no cliente com o preço ao vivo); o Top 100 mostra o chip de mercado.
- **Pendência:** aplicar `lot_market` do `setup.sql` no Supabase; cadastrar `DISCOGS_TOKEN`;
  disparar `refresh.yml` e conferir `step=market` com `updated>0`.

## Sessão 2026-08-26 — Sondagem (wantlist) + filtros da Análise (v0.6.0)

> Branch `claude/wantlist-items-setup-lsdx4w`. Sobre a base da Análise (PR #51, já mesclada
> na `main`). Objetivo: subir um rascunho de obras que estou caçando (a "sondagem"), usá-lo
> como input extra da análise e dar filtros à página.

### Sondagem (wantlist_items)

- **Tabela `wantlist_items`** (`supabase/setup.sql`; RLS só service_role, igual às demais):
  `raw` (linha original), `work` (obra), `year` (int, opcional), `note` (observação),
  `norm` (obra normalizada p/ casar com os títulos dos lotes), `acquired` (já adquiri),
  `position` (ordem) + `created_at`/`updated_at` (trigger). **Aplicar o `setup.sql` no
  Supabase** (não é auto-migrado); `types.ts` recebeu a tabela à mão.
- **Parser puro** `src/lib/wantlist-parse.ts` (`parseWantlistText`): uma obra por linha,
  tolerante a numeração ("01."), parênteses de ano/nota ("(1975 - Fase Cult/Rara)",
  `(1976 - "Rodésia")`) e colchetes com rótulo (`[Bônus/Cult: ...]` → nota "Bônus/Cult").
  Dedup por obra normalizada + ano. Client-safe (usado no preview do diálogo).
- **CRUD** `src/lib/wantlist.server.ts` (`getAllWantlist`/`importWantlistText`/
  `addWantlistItem`/`updateWantlistItem`/`deleteWantlistItem`); `importWantlistText`
  **acrescenta** (não apaga) e ignora duplicatas contra a lista atual.
- **Server fns** em `leiloesbr.functions.ts`: `getWantlist`, `importWantlist`,
  `addWantlistItem`, `updateWantlistItem`, `deleteWantlistItem`.
- **Diálogo "Sondagem"** no header da Análise: colar texto (com contagem de obras
  reconhecidas), pesquisar, editar inline, marcar **adquirido** (sai do radar) e remover.

### Casamento com os lotes (input extra da análise)

- **Casamento probabilístico** em `src/lib/wantlist-match.ts` (puro, determinístico, sem
  IA). Substituiu o substring simples do `buildInterestMatcher` (v0.6.1) porque o título do
  lote raramente vem escrito igual à obra.
- **Como pontua** (`scoreWant` → 0..1): compara por **tokens** (palavras normalizadas, sem
  acento/pontuação; mantém números curtos como o "1"/"2" de "Vol. 1"). `coverage` = fração
  dos tokens da obra presentes na **identidade do lote** (`lotIdentity`), que junta
  **título + artista extraído + `album` da IA + `release_title` do Discogs**. **Porta do
  artista**: se nenhum dos 1–2 primeiros tokens (o nome) aparece, corta forte (×0.4).
  **Ano**: +0.15 se bate, +0.05 se ±1, **−0.25 se o lote tem ano diferente** (desambigua
  anos/regravações do mesmo artista); neutro quando o lote não informa ano. Anos vêm do
  texto (regex) e do `lot_market.year`. Fuzzy leve: token conta como presente por
  igualdade, substring, ou ~1 typo de distância (`withinOneEdit`).
- **Limiar 80%** (`WANT_MATCH_THRESHOLD`): só marca casamento quando a **melhor** obra
  (`bestWantForLot`) passa de 0,8. Os lotes que casam ganham **🎯** ao lado do título (com
  tooltip "Sondagem: obra (ano) · NN%") e alimentam o filtro **"Só sondagem"**.
- **Exposto o `year` do mercado** na UI (`LotMarket`/`toLotMarket` em `ai-score-utils.ts`) —
  já vinha de `getAllLotMarket`, mas era descartado; agora reforça o casamento por ano.

### Filtros da Análise (valem para o Top 100 E o por dia/casa)

- Estado de filtro único → `filtered` (base do Top 100 e da visão por dia). Campos:
  **busca por título** (normalizada), **dia** (select), **casa** (select), **faixa de nota**
  (mín–máx 0–100) e **só sondagem**. Botão **Limpar** quando há filtro ativo; rodapé com
  contagem ("N lotes no filtro / M casam com a sondagem").
- **Top 100 recolhível** (chevron no título) e marcado como "filtrado" quando há filtro.
- As abas por dia passaram a ser **controladas** (`value=dayKey`) para casar com o filtro de
  dia; contagem de cada aba já reflete o `filtered`.

### Pendências desta feature

- [x] **Aplicar o `wantlist_items` do `setup.sql`** no Supabase — **aplicado em produção**
      (2026-09-03); a importação/edição da sondagem grava sem erro.
- [x] Merge da sondagem (PR #52, v0.6.0) + deploy na Vercel.
- [x] Merge do casamento probabilístico (PR #53, v0.6.1) + deploy na Vercel.
- [ ] Importar o rascunho real pela UI e conferir o 🎯/tooltip de % e o filtro "Só sondagem".
      Se o casamento pegar demais/de menos, ajustar `WANT_MATCH_THRESHOLD`/pesos em
      `wantlist-match.ts`.

### v0.6.1 — casamento probabilístico (artista + disco + ano, ≥80%)

- Novo `src/lib/wantlist-match.ts` (ver "Casamento com os lotes" acima). A Análise passou a
  confrontar cada lote com todas as obras não adquiridas via `bestWantForLot` (mapa
  `wantByLot` memoizado por lote) em vez do substring. `LotTitle` recebe `want` (obra + %).

## Sessão 2026-08-27 — Refino da Análise: leitura, hover da nota e filtros (v0.7.0)

> Branch `claude/analise-filtros-top-100-l7x7nv`. Ajustes de UX pedidos na Análise.

- **Caixa de filtro ilegível (fundo/letra brancos):** a paleta padrão (`:root`) é escura,
  mas faltava `color-scheme: dark`, então o dropdown nativo do `<select>` renderizava em tema
  claro (fundo branco) com o texto claro em cima. Corrigido com `color-scheme: dark` no `:root`
  (`src/styles.css`) — vale para todos os controles nativos (select, opções, scrollbar).
- **Hover da nota abrindo À ESQUERDA, sem ser cortado:** novo `HoverDetails` em
  `src/components/vinyl/ai-score.tsx` renderiza o painel de detalhes via **portal**
  (`createPortal`, `position: fixed`) para escapar do `overflow` (tabela com scroll horizontal
  e `overflow-hidden` do card). Abre à esquerda do gatilho; sem espaço, cai para baixo. É
  **interativo** (o mouse entra no painel) → o link do Discogs dentro dele fica clicável. Só
  monta no cliente (estilo começa `null`, sem SSR do portal). `ScoreBadge` (novo, coluna "Nota"
  das tabelas) e `ScoreCorner` (canto do card) usam o mesmo `HoverDetails`.
- **Top 100 e tabela por casa reestruturados:** coluna **Nota** à esquerda (selo + hover),
  **Título** ao centro, e abaixo dele `LotSummary` (raridade, oportunidade, deal vs. mercado +
  **link Discogs**, motivo da IA e **tags**). Após o "Atual", **botão de vigiar** (`WatchButton`)
  e **borda esquerda colorida** por status (`rowStatusTone`: verde ganhando / vermelho coberto /
  amarelo vigiado) — mesmo padrão do `LotCard`. "Atual" corrigido para o `myBid` quando estou
  vencendo (igual à página principal).
- **Legenda de raridade:** `RarityLegend` (comum → interessante → raro → muito_raro; menor →
  maior) no rodapé dos filtros. Ordem/labels em `RARITY_ORDER`/`RARITY_LEGEND` (`ai-score-utils`).
- **Tags da IA em todo lugar:** `LotTags` reutilizável — no front do `LotCard` (site principal)
  e no `LotSummary` das tabelas. (Ideia futura: filtro por tag.)
- **Filtros no formato da página principal:** carreguei `listWatched`/`listMyBids` na Análise e
  adicionei os chips **Vigiando** e **Com lance** (além de "Só sondagem", agora também chip), no
  mesmo estilo dos botões de dia do `index.tsx` (`filterChipClass`). O botão de vigiar da tabela
  usa a mutação `toggleWatch` e invalida `["vinyl-watched"]`.
- Validado: `bunx tsc --noEmit`, `bun run lint` (só os 2 warnings pré-existentes de shadcn) e
  `bun run build` — verdes.

## Sessão 2026-08-27 (2) — Faixa Discogs BR, "Lances do dia" e tags editáveis (v0.8.0)

> Mesma branch `claude/analise-filtros-top-100-l7x7nv` (PR #54 já mesclado; branch recriada de
> `origin/main`).

### Faixa de preço do Discogs (só Brasil, preço + frete)

- **Por quê:** a API oficial do Discogs **não** dá faixa (só `lowest_price` via `stats`), nem
  país do vendedor, nem frete. Para "De R$X a R$Y, vendedores BR, com frete", a única fonte é a
  **página pública de venda** — então fazemos scraping dela.
- `src/lib/discogs.server.ts`: `fetchBrListings(releaseId)` busca
  `www.discogs.com/sell/release/<id>?ships_from=Brazil&currency=BRL&sort=price,asc&limit=100`
  (sem token; UA + `Accept-Language: pt-BR`). Parser puro `parseSellPage` varre as células
  `.item_price`, lê `.price` e `.item_shipping` (preferindo `data-pricevalue`, caindo no texto
  pt-BR via `parseBrMoney`) e soma **preço + frete** por anúncio (frete sem valor fixo = 0, ex.:
  "calculado no checkout"). `summarizeListings` → menor/maior total + contagem. Testável com
  `bun -e`. Best-effort: se a página não vier/parsear, os campos ficam nulos e a UI cai no `stats`.
- **Novos campos** `priceLowBr`/`priceHighBr`/`numForSaleBr` em `MarketData` (discogs), na linha
  `lot_market` (`price_low_br`/`price_high_br`/`num_for_sale_br` — `setup.sql` com `CREATE` +
  `ALTER ADD COLUMN IF NOT EXISTS`; `types.ts` à mão; select de `getAllLotMarket`; gravação no
  cron `step=market`), no tipo UI `LotMarket`/`toLotMarket`. O `marketDeal` (UI) passou a ancorar
  em `priceLowBr` (→ `lowestPrice` → sugerido). UI: `MarketBlock` mostra "Brasil (c/ frete): De X
  a Y · N à venda" e o `LotSummary` da Análise mostra "Discogs BR: X–Y".
- **Pendência:** aplicar o `setup.sql` no Supabase (novas colunas) e rodar `refresh.yml`
  (`step=market`) para popular a faixa. **Risco:** se o Discogs bloquear/alterar o HTML da página
  de venda, a faixa some (fallback no `stats`). O frete exibido depende do país do comprador na
  ausência de login — best-effort.

### "Lances do dia" por dia do LEILÃO (bug)

- A página "Meus lances" (`l=4`) traz a **data do lance** (quando lancei), não a data em que o
  lote vai a pregão → os "Lances do dia"/aba Lances agrupavam pelo dia errado. Corrigido em
  `index.tsx`: `dayKeyByLotId` (id → `dayKey` da varredura geral) e `bidDayKey(bid)` usado nos dois
  agrupamentos (toggle do dia + aba Lances), com fallback para `watchedDateToKey(bid.date)`.

### Tags da IA editáveis (add/remove ao passar o mouse)

- `updateLotTags(id, tags)` (`lot-ai.server.ts`, normaliza/dedup/limita a 20) + server fn
  `setLotTags`. `LotTags` ganhou modo **editável** quando recebe `onEdit`: × por tag (aparece no
  hover) e "+ tag" para adicionar (Enter confirma, Esc cancela). Ligado nas tabelas da Análise
  (`LotSummary` → `saveTagsMut`) e nos cards do site principal (`LotCard.onEditTags` →
  `editTags(lot.id)`), com atualização otimista do cache `["lot-ai"]`. Só afeta lotes que já têm
  linha em `lot_ai` (é onde há tags).

### v0.8.1 — raridade colorida pela escala

- A raridade tem **4 valores fixos** vindos da IA (`RARITIES` em `ai-eval.server.ts`):
  `comum`/`interessante`/`raro`/`muito_raro` (menor → maior; não é editável, é gerada junto da
  nota). Novo componente `RarityLabel` (`ai-score.tsx`) colore pela escala: **comum=vermelho**,
  **interessante=amarelo**, **raro=metade amarelo/metade verde** (palavra dividida ao meio) e
  **muito_raro=verde**. Usado na `RarityLegend`, no `ScoreDetails` (hover) e no `LotSummary` das
  tabelas.

### v0.9.0 — filtro por raridade + feedback na edição de tags

- **Filtro por raridade** na Análise: `<select>` "Raridade" (Todas + os 4 valores via
  `RARITY_LEGEND`), entra em `filtered`/`filtersActive`/`resetFilters` (estado `rarityFilter`).
- **Edição de tags — validação/feedback:** `updateLotTags` passou a usar `.select("tags")` →
  **erro claro** quando o lote não tem linha em `lot_ai` ("ainda não avaliado pela IA") e
  **devolve as tags realmente gravadas** (jsonb), não o array computado. As mutações de tags (na
  Análise e no `index.tsx`) ganharam **toast de sucesso** ("Tags atualizadas") além do de erro —
  antes a gravação era silenciosa, então uma falha (ou um lote sem avaliação) não dava sinal.

### v0.9.1 — jank na edição de tags, resiliência do `lot_market` e hover da nota

- **INP/jank (~1s) ao editar tag (Análise):** o update otimista do cache `["lot-ai"]` fazia o
  casamento pesado com a sondagem (`wantByLot`, O(lotes × obras)) recomputar, mesmo tags não o
  afetando. Criado `albumById` com **identidade estável** (memo por assinatura `id:album`,
  `aiAlbumSig`); `wantByLot` passou a depender dele em vez de `aiById` → editar tag não dispara
  mais o recálculo.
- **`step=market` dava 500** quando o banco ainda não tinha as colunas BR (`price_low_br` etc.;
  schema não é auto-aplicado). `getAllLotMarket`/`upsertLotMarket` agora **detectam coluna
  inexistente** (`isMissingColumn`: código `42703`/`PGRST204` ou nome da coluna na mensagem) e
  caem para as colunas base — grava/lê sem a faixa BR em vez de derrubar o cron. Aplicar o
  `setup.sql` (os 3 `ALTER ADD COLUMN IF NOT EXISTS`) habilita a faixa.
- **Hover da nota mais robusto/descoberto:** `HoverDetails` agora abre também no **clique/toque**
  (`onClick`) e com `cursor-help` no selo — cobre toque (sem `mouseenter`) e deixa claro que é
  interativo. Continua abrindo no hover/foco e via portal (não é cortado).

### v0.10.0 — casamento do Discogs por artista+álbum+ano (precisão)

- **Problema:** mesmo com a IA identificando certo (ex.: "The Beatles - Let It Be (1970)"), o
  match caía numa coletânea ("The Beatles/1967-1970"). Causa: busca por **texto livre** com
  `per_page=5` + score que premiava só sobreposição de tokens (o nome do artista + ano bastavam
  pra uma coletânea pontuar).
- **Correção (`discogs.server.ts`):**
  - `parseAlbum` quebra o `album` da IA em **{artista, título, ano}** (separa no travessão/hífen;
    remove "(ano)"); `extractYear` pega o ano do texto do lote como reforço.
  - `fetchMarket(album, title)` faz **busca estruturada** no Discogs
    (`artist=…&release_title=…&format=Vinyl&per_page=25`) e só cai para texto livre se não achar.
  - `pickBestRelease(target, results)` reescrito: pontua por **cobertura dos tokens do álbum**
    (peso maior) + cobertura do artista + **ano** (bônus/penalidade) + vinil, com **penalidade
    para coletâneas** (faixa de anos "1967-1970", "greatest hits", "best of"…). **Rejeita (null)**
    quando o álbum/artista não cobrem o mínimo — melhor não casar do que casar errado.
  - Cron `step=market` passa `album`+`title` direto ao `fetchMarket` (buildQuery virou interno).
- **Reprocessar:** o `basis` (hash de album|título) não muda, então os matches ERRADOS já
  gravados **não** são reconsultados sozinhos. Para refazer, limpar as linhas de `lot_market`
  (ex.: `DELETE FROM lot_market;` ou só as `matched=false`/suspeitas) e rodar o `refresh.yml`.

### Resumo da sessão de 27/08 (Análise: leitura, Discogs BR, tags, matching) — v0.7.0 → v0.10.0

> Índice consolidado do que esta sessão entregou (detalhes nas subseções acima).

- **Legibilidade dos filtros (v0.7.0):** `color-scheme: dark` no `:root` — dropdown nativo do
  `<select>` deixou de ficar branco-no-branco.
- **Top 100 e tabela por casa (v0.7.0):** nota à esquerda com explicação no hover (`HoverDetails`
  via portal, abre à esquerda/no toque, Discogs clicável), título ao centro com
  raridade/oportunidade/motivo/tags + faixa Discogs abaixo, botão de vigiar e **borda colorida**
  por status. Legenda de raridade + filtros no formato da página principal (Vigiando/Com lance).
- **"Lances do dia" (v0.8.0):** passou a agrupar pelo **dia do leilão** do lote, não pela data
  do lance.
- **Faixa Discogs BR (v0.8.0):** scraping da página de venda (só vendedores BR, **preço + frete**)
  → "De R$X a R$Y"; colunas `price_low_br`/`price_high_br`/`num_for_sale_br` (com
  `getAllLotMarket`/`upsertLotMarket` tolerantes à ausência das colunas, v0.9.1).
- **Tags editáveis (v0.8.0):** ×/＋ no hover, nas tabelas da Análise e nos cards; `setLotTags` +
  `updateLotTags` (v0.9.0/0.9.1 endureceram feedback e validação).
- **Raridade colorida (v0.8.1)** e **filtro por raridade (v0.9.0)**.
- **Performance (v0.9.1):** editar tag não recomputa mais o casamento pesado com a sondagem
  (`albumById` com identidade estável).
- **Matching do Discogs por artista+álbum+ano (v0.10.0):** busca estruturada + `pickBestRelease`
  reescrito (penaliza coletânea, rejeita sem cobertura mínima). Vale para lotes novos daqui pra
  frente (os antigos não são reprocessados por decisão do usuário).

## Sessão 2026-09-03 — Cards do lote + identificação simplificada da IA (v0.12.0)

> Branch `claude/lote-card-improvements-5vygov`. Três ajustes de UX nos cards + uma
> **camada nova de identificação** para priorizar o artista/álbum da IA em toda a base.

### UI dos cards (itens pedidos)

1. **Marcar casa como verificada agora FECHA a casa.** `toggleVerified` (`index.tsx`)
   remove a chave de `openHouses` ao **marcar** (não mexe ao desmarcar). A casa continua
   migrando para a seção "Já verificadas".
2. **Nº do lote no canto superior ESQUERDO do card**, espelhando a nota da IA (canto
   direito). Selo neutro `absolute left-2 top-2 z-10` no `LotCard`; o chip "Lote N" saiu
   do rodapé (não duplicar). Visão padrão de todos os cards (o `LotCard` é o único).
3. **Artista/álbum da IA acima do título, priorizado.** O `album` da IA (campo único
   "Artista - Álbum") é exibido em destaque acima do título (que vira linha secundária),
   entra na **busca** e no **filtro/agrupamento por artista**.

### Helpers de formato padrão (`ai-score-utils.ts`, puros/client-safe)

- `parseAiAlbum(album) → {artist, album, year}` — espelha `parseAlbum`/`extractYear` de
  `discogs.server.ts` (que é server-only e não pode ser importado no cliente): separa no
  1º `-`/`–`/`:`/`/` (a barra entrou depois — ver sessão v0.13.0), extrai
  `(19xx|20xx)`; **artista só quando houve separação real**.
- `formatAiAlbum(album, fallbackYear?)` — formato PADRÃO **`Artista — Álbum (Ano)`**
  (`titleCase` no artista; usa `market.year` como fallback do ano). Usado no `LotCard` e
  no `LotTitle` da Análise.

### Busca + filtro por artista da IA

- **Álbum resolvido por lote** = `lot_ai.album` (avaliação completa) **??** `lot_ident.album`
  (identificação simples). Em `index.tsx`/`analise.tsx`: mapas `albumById` (memoizado por
  assinatura estável, para não disparar o casamento pesado da sondagem ao editar tag).
- Busca: `matchesSearch` (dia), `watchedMatchesSearch`/`bidMatchesSearch` (param opcional
  `album` novo em `grouping.ts`) e o `filtered` da Análise concatenam o álbum resolvido.
- Filtro por artista: `effectiveArtist(lot) = parseAiAlbum(albumResolvido).artist ||
lot.artist`, aplicado como override de `artist` ao montar `rawDay` — `groupByHouse`/
  `groupByArtist`/`artistOptions` e os predicados de filtro passam a usar o artista da IA
  **sem alterar `grouping.ts`** (que continua puro/por-lote).

### Camada de identificação simplificada (nova) — `lot_ident`

- **Por quê:** a avaliação completa (`lot_ai`: nota/raridade/oportunidade) segue **gated
  pelo modo** (padrão: vigiados + lances). Para ter artista/álbum em **todos** os cards,
  uma passada **barata** identifica só artista/álbum/ano da base inteira, sem rodar a
  avaliação completa.
- **Tabela `lot_ident`** (`supabase/setup.sql` + `types.ts` à mão; RLS só service_role):
  `id` (= lots.id), `title_hash`, `album`, `year`, `confidence` (`alta|media|baixa`),
  `source` (`title|image`), `model`, `evaluated_at`. **Aplicar o `setup.sql`** (não é
  auto-migrado).
- **IA** (`ai-eval.server.ts`, isolado da avaliação completa): `buildIdentUserPrompt`/
  `buildIdentParams` (max_tokens ~120), `parseIdentObject` ({album,year,confidence}),
  `selectLotsToIdentify` (sem linha ou título mudado → passada **título**),
  `selectLotsToReident` (`source='title'` + `confidence='baixa'` + tem imagem → passada
  **capa**), `submitIdentBatch`/`collectIdentBatch` (Batches API, gravam em `lot_ident`).
  **Escalonamento título→capa "apenas quando necessário"** (baixa confiança).
- **Persistência** `src/lib/lot-ident.server.ts` (`getAllLotIdent`/`upsertLotIdent`);
  server fn `getLotIdent` (`leiloesbr.functions.ts`) → query `["lot-ident"]` na UI.
- **Cron** novo `step=aiident` (SEM gate de modo; estado próprio `app_state.ai_ident_batch`
  via `getPendingAiIdentBatch`/`setPendingAiIdentBatch`): coleta pendente → título →
  reident por capa. Laço `aiident` no `refresh.yml` **antes** do `market`.
- **Discogs usa o identificado:** `step=market` mescla álbum de `lot_ai` (preferido) +
  `lot_ident`; `selectLotsForMarket` passou a receber a lista de álbuns mesclada
  (`{id, album}[]`) — antes só `aiRows`. Assim o Discogs casa também lotes só identificados.

### Validação

- `bunx tsc --noEmit`, `bun run lint` (só os 2 warnings pré-existentes de shadcn),
  `bun run build` — verdes. Funções puras testadas com `bun -e` (`parseAiAlbum`/
  `formatAiAlbum`, `parseIdentObject`, `selectLotsToIdentify`/`selectLotsToReident`).

### Pendências de config (rodar no Supabase / GitHub)

- **Aplicar o `setup.sql`** para criar a tabela `lot_ident` (o schema não é auto-migrado).
  O `setup.sql` é re-executável (tudo `IF NOT EXISTS`); ou rodar só o bloco da tabela:
  ```sql
  CREATE TABLE IF NOT EXISTS public.lot_ident (
    id text PRIMARY KEY, title_hash text NOT NULL, album text, year integer,
    confidence text, source text, model text,
    evaluated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.lot_ident ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.lot_ident FROM anon, authenticated;
  GRANT ALL ON public.lot_ident TO service_role;
  ```
- Depois **disparar o `refresh.yml`** (Actions → Run workflow) para popular `lot_ident`
  (`step=aiident`) e conferir o `step=market` casando lotes só identificados. Requer
  `ANTHROPIC_API_KEY` já configurado (senão o passo faz no-op).

## Sessão 2026-09-03 (2) — Fix classificação IA + categoria "Lote" + busca por relevância (v0.13.0)

> Branch `claude/lote-classification-ai-title-7b44oz`. Três ajustes na classificação/busca
> da listagem por dia. Tudo em funções puras/client-safe (`vinyl-parse.ts`,
> `ai-score-utils.ts`, `discogs.server.ts`, `grouping.ts`) + o consumo em `index.tsx`.
> **Sem migração de banco** e **sem re-varredura/re-IA**: o artista é recalculado do
> título/álbum na UI, então o reagrupamento vale na hora.

### 1. Lotes caíam no grupo espúrio "Artista" (PR #63)

- **Sintoma:** lotes com título de IA **correto** (ex.: `a-ha / Hunting High and Low`)
  agrupados sob "Artista".
- **Causa:** o prompt pede `"Artista - Álbum"` (com `-`), mas o modelo às vezes devolve
  `"Artista / Álbum"` (com `/`). `parseAiAlbum` (`ai-score-utils.ts`) e `parseAlbum`
  (`discogs.server.ts`) só separavam em `-–—:`, então não isolavam o artista → o
  `effectiveArtist` caía no heurístico do título `"LP: Artista: X | Album: Y"`, que extraía
  o **literal "Artista"**.
- **Fix:** `/` (com espaços) agora conta como separador nas duas funções — regex
  `/\s[-–—:/]\s/`. `AC/DC` não é afetado (barra sem espaços). Defesa extra: `extractArtist`
  descarta candidatos que são só rótulos de campo (`LABEL_WORDS`: `artista`/`album`/…).

### 2. Categoria "Lote" para conjuntos de discos

- **`isDiscBundle(title)` em `vinyl-parse.ts`**: true quando o título é um **conjunto de
  vários discos** — `"lote com/de …"`, `"kit com/de …"`, `"coleção de discos"`, quantidade
  **3+** de discos (`"30 LPs"`), ou `"diversos/vários"` + palavra de disco (`DISC_WORD`).
  Discos duplos/triplos do **mesmo** álbum (`"2 LPs"`) **não** contam.
- **`extractArtist` devolve `LOTE_LABEL` ("Lote")** para bundles (antes de cair no
  UNCLASSIFIED). Em `index.tsx`, `effectiveArtist` checa `isDiscBundle(lot.title)` **antes**
  do álbum da IA → o conjunto agrupa em "Lote" mesmo que a IA tenha arriscado um álbum.
- **Ordem dos grupos** (`grouping.ts`, `artistRank`): artistas reais (alfabético) →
  `"Lote"` → `UNCLASSIFIED_LABEL`. Aplicado em `groupByArtist` e `artistOptions`.

### 3. Busca "mais exato primeiro, parecidos depois"

- **Sintoma:** a busca trazia coisas muito diferentes do digitado (casava o termo em
  campos fracos, ex.: nome da casa) e sem ordenação.
- **`searchRelevance(identity, extra, queryNorm)` em `vinyl-parse.ts`** pontua por camadas:
  5 = identidade começa com o termo · 4 = contém o termo · 3 = todos os termos na
  identidade · 2 = termo em qualquer campo (casa/nº do lote) · 1 = todos os termos em
  qualquer campo · 0 = não corresponde. `identity` = `álbum IA + artista + título`;
  `extra` = `casa + nº do lote`.
- Em `index.tsx`: `searchScore(lot)` alimenta `matchesSearch` (`> 0`). **Com busca ativa**,
  a listagem do dia deixa de agrupar por casa e vira **lista única ordenada por relevância**
  (`[...visibleLots].sort((a,b) => searchScore(b) - searchScore(a))`). Sem busca, mantém o
  agrupamento por casa → artista de sempre.
- **Escopo:** só a busca das abas de **dia**. Vigiados/Lances (`watchedMatchesSearch`/
  `bidMatchesSearch`, `grouping.ts`) seguem com o casamento contíguo antigo.

### Validação

- `bunx tsc --noEmit` e `bun run lint` verdes. Funções puras (`isDiscBundle`,
  `searchRelevance`, `parseAiAlbum`) testadas com `node`/`bun -e`: bundles vs. álbuns
  simples ok; busca `"clara nunes"` põe os discos dela no topo (5), match só-na-casa no
  fim (2) e itens sem relação fora (0).

### Observação de processo

- Os PRs #63 e #64 foram mesclados **sem bump de `APP_VERSION`** (merge via API não barrou
  no `version-bump.yml`). Este PR consolida em **v0.13.0** o fix + as duas features.

## Sessão 2026-09-03 (3) — Página "Leilões ao vivo" (pregão presencial por casa) (v0.14.0)

> Branch `claude/live-auctions-page-tljpox`. Nova página no menu superior (ao lado de
> "Análise") para **acompanhar ao vivo** o pregão presencial das casas com leilão de vinil
> **do dia**. **Sem migração de banco e sem novo scraping** — a URL do pregão é derivada do
> que já está em `seen_auctions`.
>
> _Obs.: a feature foi mesclada primeiro no PR #66 (na v0.13.0, sem bump); este registro +
> o bump para v0.14.0 vêm em seguida (o `version-bump.yml` não barra merge via API)._

### Nova rota `/ao-vivo` (`src/routes/_authenticated/ao-vivo.tsx`)

- Item de menu **"Ao vivo"** (ícone `Radio`) em `index.tsx`, ao lado de "Análise".
- Lista os leilões de vinil **do dia** (data de hoje em `America/Sao_Paulo`), **um card por
  casa**, com **badge de status** derivado do horário: `upcoming` (Em breve) / `live`
  (Ao vivo agora, com ponto pulsante) / `ended` (Encerrado). `useQuery` com
  `refetchInterval` de 60s para o status virar sozinho.
- Ações por card: **"Acompanhar ao vivo"** abre `presencialUrl ?? entryUrl ?? houseUrl` em
  nova aba; **"Abrir aqui"** (só quando há `presencialUrl`) alterna uma **prévia em
  `<iframe>`** com aviso + link de fallback (sites presenciais costumam bloquear via
  X-Frame-Options/CSP). Estado vazio amigável quando não há pregão no dia.

### Como a URL do pregão presencial é montada (sem dado novo)

- Padrão pedido: `<dominio-da-casa>/presencial/presencial.asp?Num=<idLeilao>` (ex.:
  `https://www.leiloesdisco78.com.br/presencial/presencial.asp?Num=64449`).
- `seen_auctions` já guarda `entry_url` (o `abre_catalogo.asp?t=1|<dominio>|<idLeilao>|...`
  do lote). **Reuso de `parseAuctionRef`** (`leiloesbr-catalog.server.ts`) para extrair
  `{domain, idLeilao}`; normaliza `http:`→`https:` e monta a URL. `null` quando o link não
  casa o padrão (casas **fora** da plataforma LeilõesBR, ex.: `abreucolecionismo`) → o
  botão cai para o link da casa e a prévia iframe não é oferecida.

### Server (`leiloesbr-auctions.server.ts` + `leiloesbr.functions.ts`)

- Tipo `PresencialAuction = LiveAuction & { presencialUrl: string | null; status }`.
- `listTodayAuctions()`: consulta `seen_auctions` por `day_key = <hoje>` (São Paulo, via
  `Intl.DateTimeFormat("en-CA", …)`), ordena por `starts_at`, reusa `toAuction` e deriva
  `status` com `auctionStarted`/`auctionFinished` (`vinyl-parse.ts`). Best-effort: `[]` em
  erro (mesmo padrão de `listLiveAuctions`).
- Server fn **`getTodayAuctions`** (GET, `requireSupabaseAuth` → `assertAllowed`),
  espelhando `getLiveAuctions`. A seção "Acontecendo agora" da home (`live-auctions.tsx`,
  janela de ~3h) segue intacta — a página nova é o painel do dia inteiro.

### Validação

- `bun run build` verde (rota `/ao-vivo` no `routeTree.gen.ts`, sem erro de tipo);
  `eslint` e `prettier --check` limpos nos arquivos alterados. Import do tipo
  `PresencialAuction` no cliente é **`import type`** (apagado no bundle; não puxa o
  `.server`).

### Sem pendência de config

- Não cria/altera tabela nem depende de secret novo. A lista só aparece preenchida se o
  cron de scraping já tiver gravado leilões **do dia** em `seen_auctions` (com `entry_url`).

## Sessão 2026-09-03 — Controle da IA: liga/desliga por modo + análise sob demanda (v0.11.0)

> Feature entregue na **v0.11.0** (PR #61, mesclado); nota registrada depois. Objetivo:
> controlar o **gasto de créditos** da avaliação por IA e permitir disparar a análise **na
> hora**, por dia ou casa, sem esperar a rodada automática do cron.

### Modo da IA automática (nova chave `ai_mode` em `app_state`)

- `getAiMode`/`setAiMode` em `src/lib/app-state.server.ts` (mesmo modelo de
  `verified_houses`/`user_interests`). Tipo `AiMode = "off" | "all" | "watched"`,
  **padrão `"watched"`** (`DEFAULT_AI_MODE`); leitura tolerante (valor inválido → padrão).
  **Sem mudança de schema** — só mais uma chave na tabela `app_state` que já existe.
- Filtro no **cron** (`cron.server.ts`, `step=aieval`): o modo é lido logo após
  `aiConfigured()`.
  - `"off"` → `json({ skipped: "IA desligada", mode })` — não coleta nem submete (a
    coleta de um batch pendente também espera religar).
  - `"all"` → comportamento histórico (candidatos = todos os `snapshot.lots`).
  - `"watched"` → só lotes que o usuário **vigia ∪ deu lance**. Os ids vêm de
    `listWatchedFromSite()` + `listMyBidsFromSite()` (leitura **server-side** com a sessão
    de credenciais de ambiente; best-effort em try/catch), casando com `VinylLot.id` (ambos
    `${idLeilao}-${idPeca}`), **antes** de `selectLotsToEvaluate`.

### Análise sob demanda (síncrona, botões por dia/casa)

- `evalLotsSync(lots)` em `src/lib/ai-eval.server.ts`: usa a **Messages API síncrona**
  (`client.messages.create`, concorrência 4, best-effort por lote) — distinta da **Batches
  API** assíncrona do cron, porque aqui o usuário espera o resultado na hora. Reusa
  `buildLotParams`/`parseEvalObject`/`titleHash`; `messageText` virou export.
- Server fn **`analyzeOnDemand({ day, house?, max })`** em `leiloesbr.functions.ts`
  (`requireSupabaseAuth` → `assertAllowed`; erro claro sem `ANTHROPIC_API_KEY`): recorta o
  dia (e a casa, quando dada), seleciona **só os não avaliados** (`selectLotsToEvaluate`,
  cache por título), avalia até `max` (25) e devolve `{ evaluated, remaining }` para o
  cliente repetir em laço. Roda **em qualquer modo**, inclusive com a IA desligada.

### UI (`index.tsx`)

- `Select` de modo no header (query `["ai-mode"]`, gravação otimista com toast) — opções
  "IA: desligada / tudo / vigiados + lances".
- Botões **"Analisar dia"** (barra do dia) e **"Analisar"** (cabeçalho da casa) chamam
  `analyzeOnDemand` em laço até `remaining===0` **ou** `evaluated===0` (evita laço infinito
  em lotes que falham sempre), depois revalidam `["lot-ai"]`. Estado único `analyzing`
  (chave = `day` para o dia, `${day}|${casa}` para a casa; desabilita os demais botões
  enquanto roda). Texto da página Análise cita esses botões.

### Decisão consciente

- O **padrão passou a ser `"watched"`** (econômico): após o deploy a IA automática deixa de
  avaliar todo lote novo. "IA: tudo" restaura o comportamento antigo.

### Pendências (validar em produção)

- Persistência do modo (`app_state.ai_mode`); cron em `off` → `{skipped:"IA desligada"}`;
  cron em `watched` submetendo só vigiados/lances; e os botões "Analisar" populando as notas
  (`["lot-ai"]`) sem passar pela Batches API.

## Sessão 2026-08-27 (3) — Revisão geral: endurecimento do cron, retry e DRY (v0.10.2)

> Branch `claude/revisao-simplificada-geral-ajk97l` · PRs
> [#60](https://github.com/gilbertomaiarj1984/leilao-finder-buddy/pull/60) (mesclado).
> Revisão simplificada porém geral do código. Nenhum bug sério; ajustes de
> segurança/robustez e de qualidade (DRY), sem mudança de comportamento.

### Correções (v0.10.1)

- **Cron mais seguro** (`cron.server.ts`): `/api/cron` passou a exigir o header
  `x-cron-token` (removido o fallback `?token=` da querystring, que vaza em logs de acesso)
  e a comparar o token em **tempo constante** (`tokensMatch`, evita timing attack). O
  workflow `refresh.yml` já usava só o header — nada quebrou.
- **Sem retry inútil em 4xx** (`leiloesbr-auth.server.ts`): `fetchWithRetry` passou a falhar
  de imediato em 404/403 (definitivos, via `LeiloesBrHttpError` com status) e manteve o
  backoff só para 5xx/rede/timeout.
- **Regex de diacríticos unificada** (`vinyl-parse.ts`): `normalizeForMatch` passou a usar
  `/[̀-ͯ]/g` (mesma forma escapada de `normalize()`), no lugar dos combinantes
  crus — mais legível e robusto a edições.

### Limpeza / DRY (v0.10.2)

- `grouping.ts` ganhou `groupByHouseSimple` + tipo `SimpleHouseGroup` (forma enxuta
  `{house, houseUrl, lots}`) e passou a exportar `loteNum` (ordenação por nº de lote, vazio
  ao fim), reusado internamente por `groupWatchedByHouse`. `dashboard.tsx` e `analise.tsx`
  deixaram de declarar cópias byte-idênticas de `groupByHouse`/`loteNum` e passaram a
  importar de `grouping.ts`.

> Observação: quando esta sessão rodou, a `main` estava em v0.10.0; ela avançou depois
> (v0.11–v0.14) com features de outras sessões (controle de modo da IA, `lot_ident`,
> categoria "Lote", leilões ao vivo). Os itens acima já estão na `main` atual.

---

## Sessão 2026-09-03 — Confirmação da sondagem em produção (handoff)

> Continuidade da sessão que criou a sondagem. Sem código novo aqui: consolida o estado e
> atualiza pendências. As mecânicas estão em "Sessão 2026-08-26 — Sondagem (wantlist) +
> filtros da Análise" (v0.6.0/v0.6.1) acima.

- **`wantlist_items` aplicada no Supabase** (SQL rodado pelo usuário) — importar/editar/
  marcar adquirido e o casamento com os lotes gravam sem erro em produção. As pendências de
  migração e de merge (PRs #52 e #53) ficaram **concluídas**.
- **Estado do casamento:** probabilístico por **artista + disco + ano** (`wantlist-match.ts`,
  limiar `WANT_MATCH_THRESHOLD = 0.8`); o 🎯 no título traz o tooltip
  "Sondagem: obra (ano) · NN%". O `lotIdentity` junta título + artista + **álbum
  identificado** (hoje vindo do `lot_ident`, via `albumById` na Análise) + `release_title`
  do Discogs; os anos vêm do texto (regex) e do `lot_market.year`.
- **Nota:** a sondagem **não pesa na nota da IA** — é destaque + filtro ("Só sondagem"),
  como os interesses (⭐). Dar peso real na nota (bônus determinístico no ranking, ou mandar
  a lista pro prompt da IA) segue em aberto, caso se queira.
- **Recomendação:** rodar o `refresh.yml` mais vezes (passos `aieval`/`ident`/`market`)
  melhora a precisão do casamento ao longo do tempo — quanto mais lotes com `album`/ano
  identificados, mais sinais o `lotIdentity` tem para comparar.

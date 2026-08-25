# Notas de desenvolvimento — Garimpo de Vinil

> Documento de continuidade entre sessões. Descreve **arquitetura, mecânica dos sites
> de leilão, decisões e pendências**. O código é refatorado com frequência (helpers
> mudam de arquivo); prefira **procurar por nome de função** (`grep`) a confiar em
> caminhos/linhas exatos.

## O que é o app
App que garimpa **discos de vinil** em leilão no **LeilõesBR** e casas parceiras,
agrupando por **dia → casa de leilão → artista**, com **vigia** e **lances**
sincronizados com a conta do usuário. Stack: **TanStack Start + React 19 + Supabase**,
construído no **Lovable**, deploy alvo **Cloudflare** (via nitro).

## Restrições do ambiente (importantes)
- **Sandbox sem rede para os sites** (`leiloesbr.com.br`, CDNs, domínios das casas,
  e a própria URL `*.lovable.app`): egress bloqueado. Não dá para testar scraping/lance
  daqui — validar por análise estática + `bun -e` de funções puras, e o **usuário**
  testa na prévia/produção.
- **Sem `bun install`** no sandbox (registry privado da Lovable dá 403). `node_modules`
  existe, então `node_modules/.bin/tsc --noEmit` funciona para typecheck.
- **Migrações `.sql` do repo NÃO são aplicadas** — mudanças de schema são feitas pelo
  **Lovable** (foi assim que surgiram as tabelas `lots`, `known_artists`, `app_state`).
- **Git push HTTPS costuma funcionar**; quando não, usar os tools `mcp__github__*`.
  Fluxo: branch de trabalho → PR → **merge commit** (`merge_method:"merge"`, nunca
  squash/rebase) para preservar o histórico sincronizado com o Lovable.
- **Lovable auto-commita na `main`** (autor `gpt-engineer-app[bot]`) — não reescrever
  histórico publicado; sempre **recriar a branch a partir de `origin/main`** antes de
  trabalhar (a `main` anda sozinha).
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
- **Busca principal + agrupamento dos vigiados/lances:** `watchedMatchesSearch(lot,
  searchNorm)` casa por **título/artista/casa/nº do lote** (mesma regra das abas de dia).
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

## Atualização em background (4x/dia)
- **Endpoint** `/api/cron` (tratado direto em `src/server.ts`, FORA das server functions
  → sem Supabase/CSRF), protegido pelo segredo **`CRON_TOKEN`** (lido de `process.env`
  **ou** do binding `env` do Cloudflare; token pode vir no header `x-cron-token` ou na
  query `?token=`). Steps: `chunk` (varre bloco), `enrich` (com `offset`), `catdebug`.
- **GitHub Actions** `.github/workflows/refresh.yml`: `cron: "0 3,9,15,21 * * *"` (UTC =
  BRT 00/06/12/18h) + `workflow_dispatch`. Varre em blocos até `nextPage:null`, depois
  enriquece por `offset` até `done:true`.
- **Configuração (fora do código):** GitHub secrets `APP_URL`
  (`https://leilao-finder-buddy.lovable.app`) e `CRON_TOKEN`; e a env `CRON_TOKEN` no
  **Lovable** (mesmo valor). O `CRON_TOKEN` foi rotacionado pelo usuário; **não** está no
  repo.
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
- **Busca + vigiados por dia/casa** — ✅ concluído (PR #31, mesclado). A aba
  **“Vigiados”** (ver todos) passou a **respeitar a busca principal** e a ser
  apresentada **separada por dia e casa de leilão** (antes era uma grade plana), no mesmo
  layout das abas de dia. Extraídos `watchedMatchesSearch` e `groupWatchedByHouse`
  (ver seção **Cores**), depois movidos para `grouping.ts` e reutilizados também em
  “Meus lances”. Nota de ambiente: nesta sessão o `bun install` falhou (registry privado
  Lovable, 403) e o `node_modules` **não existia**, então o typecheck local não rodou —
  validação por revisão estática; o merge foi feito via `mcp__github__merge_pull_request`.
- **Badges por casa (UI)** — ✅ concluído (PR #29). Ao lado do nome da casa, além do
  nº de lotes, mostra **nº de vigia (amarelo)**, **nº com lance coberto (vermelho)** e
  **nº ganhando (verde)**, padronizado em todos os pontos onde o nome da casa aparece.
  Ver detalhe na seção **Cores** (`HouseStatBadges`/`computeHouseStats`).

## Pendências (próximas sessões)
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

## Convenções de trabalho
- Branch de trabalho recriada de `origin/main` a cada tarefa (a `main` avança sozinha).
- Rodapé de atribuição em qualquer post no GitHub. Commits terminam com
  `Co-Authored-By: Claude ...`.
- Não colar páginas HTML inteiras no chat (consomem muito contexto/tokens) — pedir só o
  bloco relevante (um card) quando precisar de HTML de um site.

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

## Valores do lote: atual / próximo / meu lance (conceito)

Três valores diferentes, de **fontes diferentes** — não confundir:

- **Valor atual** = `price`. Vem do `.venda-price` na listagem geral; nas páginas de
  conta vem em `<b class="pb-1">` (vigia `l=8` e lances `l=4`).
- **Meu lance** = `myBid`. Só existe na página **"Meus lances"** (`l=4`).
- **Próximo lance** = **NÃO existe na listagem nem nas páginas de conta.** Só está no
  **detalhe do lote** (`peca.asp`) e no **pregão ao vivo** (`novoPresencial.valorpecaatual`,
  calculado pelo JS do site — usado só no userscript do missleiloes). Decisão: buscar
  por lote via `peca.asp` (1 requisição por lote → background/chunk, como o enrich de
  nº de lote). **Pendente:** amostra do bloco de preço do `peca.asp` para escrever o
  parser (não há rede para o site daqui). O card (`lot-card.tsx`) já tem o campo
  `nextBid` e mostra "Próximo" quando presente.
- **`base`** (do `data-watch="idPeca,email,idLeilao,base"`) **NÃO é o incremento** — é a
  "base"/plataforma (nas queries de conta, `b=0` = base LeilõesBR). Não usar como próximo lance.
- **Regra de UI (card):** todo lote mostra **"Atual"**; **"Próximo"** quando houver
  `nextBid`; **"Meu lance"** quando houver `myBid`.
- **"Meus lances" (`l=4`) não traz o valor atual** → casar por **`id`
  (`${idLeilao}-${idPeca}`)** com a varredura geral (`priceById` no `index.tsx`, mesma
  ideia de `loteById`/`houseUrlByName`) para exibir o "Atual" nesses cards.

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

0. **Próximo lance (`peca.asp`):** exibir o "próximo lance" em todos os lotes. Decidido
   buscar por lote no detalhe (`peca.asp`), em background/chunk como o enrich de nº de
   lote, persistindo no banco. **Bloqueio:** falta uma **amostra do bloco de preço do
   `peca.asp`** (não há rede para o site daqui) para escrever o parser. UI já pronta
   (`nextBid` no card). Ver seção **Valores do lote**.
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

- **Bump em `src/lib/version.ts` a cada release**, seguindo semver: **PATCH** = correção;
  **MINOR** = nova funcionalidade compatível; **MAJOR** = mudança incompatível.
- **Colocar o número da versão no título do PR** (ex.: `v0.2.0 — filtro por casa`).
- O rodapé em produção mostra a versão no ar → confirma visualmente qual PR foi implantado.
- Versão atual ao fim desta sessão: **v0.1.0**.

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

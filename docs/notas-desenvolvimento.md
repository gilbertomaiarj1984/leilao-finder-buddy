# Notas de desenvolvimento — Garimpo de Vinil

> Documento de continuidade entre sessões: **arquitetura, mecânica dos sites de leilão,
> decisões e pendências**. O código é refatorado com frequência (helpers mudam de arquivo);
> prefira **procurar por nome de função** (`grep`) a confiar em caminhos/linhas exatos.
>
> ⚠️ **Atualize este documento ANTES de mesclar qualquer PR.** Toda mudança de
> arquitetura/mecânica entra na seção correspondente; toda entrega ganha uma linha no
> **Histórico de versões**; pendências resolvidas saem da lista. Manter isto em dia é o que
> torna a próxima sessão produtiva. (Como o arquivo já vive na `main`, ao "mesclar notas"
> faça fetch de `origin/main` e acrescente/edite a partir dele para evitar conflito add/add.)

## O que é o app

Garimpa **discos de vinil** em leilão no **LeilõesBR** e casas parceiras, agrupando por
**dia → casa de leilão → artista**, com **vigia** e **lances** sincronizados com a conta do
usuário, avaliação por **IA** e âncora de preço do **Discogs**. Stack: **TanStack Start +
React 19 (SSR) + Supabase**, deploy na **Vercel** (Nitro). Migrado do Lovable em 2026-08.

## Convenções de trabalho (ler primeiro)

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa** (a `main`
  recebe commits de outras sessões/PRs). Fluxo: branch → PR → merge.
- **Atualizar ESTE documento antes de mesclar o PR** (ver aviso no topo).
- **Bump de versão em TODO PR:** `APP_VERSION` em `src/lib/version.ts` **e** `version` no
  `package.json`, semver (PATCH=correção, MINOR=nova função, MAJOR=quebra). É o número no
  rodapé em produção. **Obrigatório:** o CI `.github/workflows/version-bump.yml` falha o PR
  se a versão não subir (⚠️ merge via API do GitHub **não** barra — não confie só no CI).
  Colocar a versão no título do PR (ex.: `v0.2.0 — filtro por casa`).
- **Rodapé de atribuição** em qualquer post no GitHub; commits terminam com `Co-Authored-By:`.
- **Não colar páginas HTML inteiras no chat** (consomem contexto) — pedir só o bloco
  relevante (um card) quando precisar do HTML de um site.

## Restrições do ambiente

- **Não dá para testar scraping/lance daqui** (sem rede aos sites de leilão) — validar por
  análise estática + `bun -e` de funções puras; o **usuário** testa na prévia/produção.
- **`bun install` funciona** (`bunfig.toml` → npm público), então `bun run build`,
  `bunx tsc --noEmit` e `bun run lint` rodam localmente. Lint verde salvo 2 warnings
  pré-existentes de shadcn (`ui/badge`, `ui/button`).
- **Migrações `.sql` NÃO são auto-aplicadas** — o schema é (re)criado via `supabase/setup.sql`
  (SQL Editor ou `psql -f`), re-executável (tudo `IF NOT EXISTS`). Ao criar tabela/coluna,
  editar `setup.sql` **e** `src/integrations/supabase/types.ts` à mão. Tabelas: `lots`,
  `known_artists`, `app_state`, `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`,
  `wantlist_items`.
- **Git push HTTPS costuma funcionar**; quando não, usar os tools `mcp__github__*`.

## Arquitetura de dados

- Abrir o app **lê só do banco/cache** — NÃO varre o site (varredura completa estoura o tempo
  do servidor e deixa a tela vazia).
- **Popular** é sob demanda / agendado, em **blocos** (chunks) para caber no tempo do servidor:
  - `scrapeVinylChunk(fromPage, size)` — varre um bloco da listagem geral.
  - `enrichMissingLotes(maxAuctions, offset)` — preenche nº de lote via catálogo. Usa **cursor
    `offset`** sobre a lista estável/ordenada dos leilões da janela; retorna
    `{updated, total, nextOffset, done}`.
- Camadas: `memCache` (módulo, garante a lista sem banco) + tabela **`lots`** (durável, upsert
  por `id`, **merge** — nunca apaga o que não veio) + `app_state` (chaves globais: baseline,
  casas verificadas, interesses, modo de IA, batches pendentes).
- `id` do lote = `"${idLeilao}-${idPeca}"`. Janela = **5 dias** (`WINDOW_DAYS`).
- **Última atualização:** `getVinylLots` retorna `updatedAt` = maior `updated_at` de `lots` na
  janela (trigger `update_lots_updated_at` toca a coluna no upsert); exibido sob "Atualizar
  tudo" (`formatUpdatedAt`, fuso São Paulo).

## Scraping do LeilõesBR

- **Varredura geral é PÚBLICA** (sem login) via `publicFetch` — evita o 500 que o site dá
  logado sob carga. Categoria fixada por `tp=|446973636F2064652076696E696C|` (hex de "Disco de
  vinil") → **todo lote já é vinil**; não exigir palavra-chave no título, só descartar CD/DVD/K7
  (`looksNonVinyl`, em `vinyl-parse.ts`).
- **Login (`authFetch`)** só para a **conta**: env `LEILOESBR_EMAIL` / `LEILOESBR_SENHA`.
  - **Vigias**: `conta_site.asp?l=8` → `listWatchedFromSite` (cards `.oc-item`,
    `data-watch="idPeca,email,idLeilao,base"`, preço em `<b class="pb-1">`).
  - **Meus lances**: `conta_site.asp?l=4` → `listMyBidsFromSite` (mesmos `.oc-item`; **meu
    lance** em `.product-price b.pb-1`; **status** na classe/ícone `lstatus`:
    `Coberto`/`Vencendo`/`Vencedor`/`Coberto e Vendido`/`Não vendido`).
  - **Toggle vigia**: `POST vigiar_peca.asp` (`idpeca/idcliente/idleilao/base`, resposta `+`/`-`).
- **`fetchWithRetry`** (`leiloesbr-auth.server.ts`) falha de imediato em 404/403 (via
  `LeiloesBrHttpError`) e faz backoff só para 5xx/rede/timeout.

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

## Cores, badges e busca

- **Verde** = tenho lance e estou ganhando/arrematei (`bidIsWinning(status)` casa
  `venc|arremat|arrebat`). **Vermelho** = tenho lance mas coberto. **Amarelo** = só vigiado.
  Precedência: **lance vence vigia**.
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
  IA + artista + título; `extra` = casa + nº do lote. **Com busca ativa**, a listagem do dia
  vira **lista única ordenada por relevância** (não agrupa por casa). Vigiados/Lances usam
  casamento contíguo (`watchedMatchesSearch`/`bidMatchesSearch`), sem ranqueamento.

## Valores do lote: atual / próximo / meu lance

Três valores de **fontes diferentes** — não confundir:

- **Valor atual** = `price` (`.venda-price` na listagem; `<b class="pb-1">` nas páginas de conta).
- **Meu lance** = `myBid` (só na página "Meus lances", `l=4`).
- **Próximo lance** = **NÃO** existe na listagem nem nas páginas de conta. Só no **detalhe do
  lote** (`peca.asp`, JSON `loadData`): **`data[0].NOVO_VALOR`** (já calculado pelo site). **Só
  o lote ABERTO traz `NOVO_VALOR`** → **1 requisição por lote** → buscado só para
  **vigiados + lances** (conjunto pequeno), nunca a listagem inteira. Implementação:
  `leiloesbr-lot-details.server.ts` (`fetchNextBids`, concorrência 8, teto 100, regex
  `"NOVO_VALOR":"(\d+)"`) → `getNextBids` → query `["next-bids"]` (`staleTime` 3min). Não
  persiste (busca ao vivo, cache curto).
- **NÃO inferir o incremento** — o `NOVO_VALOR` real diverge dos "termos" da casa; ele é
  autoritativo. **`base`** (do `data-watch`) NÃO é o incremento (é a base/plataforma).
- **Regra de UI (card):** sempre "Atual"; "Próximo" quando há `nextBid`; "Meu lance" quando há
  `myBid` (linha abaixo). **Correção do "Atual" quando VENCENDO:** a listagem pública traz
  valor defasado → o `LotCard` usa `myBid` como "Atual" quando `bidIsWinning(status)`; por isso
  `myBid` é passado a **todos** os cards (`myBidById`). "Meus lances" (`l=4`) não traz o atual →
  casar por `id` com a varredura geral (`priceById`).

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

## Painel de mudanças (`dashboard.tsx`)

- **Baseline = snapshot global** `{lotId: price}` em `app_state` (chave `dashboard_baseline`,
  um registro para o app). `getBaseline`/`markSeen` usam **service role** (`supabaseAdmin`,
  ignora RLS). "Variação" = `computeDelta(atual, baseline[lot.id])` → `novo` quando a chave
  **não existe** no baseline.
- **Semente automática na 1ª visita** (`baselineSeeded` + `markSeen({silent:true})`): sem isso
  tudo nasce "novo"/sem "último acesso". Na visita que semeia ainda sai "novo"; a variação real
  aparece **a partir da visita seguinte**. Botão "Marcar como visto" reancora.
- **Enrich no painel** (`enrichRan`): ao abrir roda `enrichLotes` uma vez se há lote sem
  número, em background, e faz `setQueryData(["vinyl-lots"], fresh)`.
- `markSeen` (server, `app-state.server.ts`) **propaga** erro de gravação (antes mascarava).

## Casas verificadas

- "Marcar casa como verificada" (chave `${dia}|${casa}`) **PERSISTE no servidor**: `app_state`
  chave `verified_houses` (array global). `getVerifiedHouses`/`setVerifiedHouses`. **Marcar
  também FECHA a casa** (`toggleVerified` remove de `openHouses`) e migra para "Já verificadas".
- **localStorage vira só cache** (pinta a tela na hora); fonte da verdade é o servidor. No 1º
  load há **migração única** localStorage → servidor. (Antes ficava só no localStorage → sumia
  ao trocar de navegador/dispositivo ou usar a URL de preview, de origem diferente.)

## Atualização em background (cron 4×/dia)

- **Endpoint** `/api/cron` (tratado direto em `src/server.ts`, FORA das server functions → sem
  Supabase/CSRF), protegido pelo segredo **`CRON_TOKEN`** (header `x-cron-token`; o fallback
  `?token=` foi removido — vazava em logs; comparação em tempo constante, `tokensMatch`).
- **Steps:** `chunk` (varre bloco), `enrich` (nº de lote por `offset`), `aiident`
  (identificação IA), `aieval` (avaliação IA), `market` (Discogs), `catdebug` (diagnóstico).
- **GitHub Actions** `.github/workflows/refresh.yml`: `cron: "0 3,9,15,21 * * *"` (UTC = BRT
  00/06/12/18h) + `workflow_dispatch`. Varre em blocos até `nextPage:null`, enriquece por
  `offset` até `done:true`, depois laços curtos de `aiident` → `aieval` → `market`.
- O **"Atualizar tudo"** manual na UI continua (chunk + enrich por cursor).

## IA (avaliação, identificação, modo)

Modelo **`claude-haiku-4-5`** (o mais barato) via Anthropic. Chave **`ANTHROPIC_API_KEY`**
(`process.env`). **Opcional:** sem a chave tudo faz **no-op** e o app segue normal.

- **Avaliação completa — `lot_ai`** (`ai-eval.server.ts` + `lot-ai.server.ts`): via **Batches
  API** (~50% do preço, assíncrona), **1 request por lote** (`custom_id = lots.id`). Cache por
  título (`title_hash` djb2→base36; só reavalia lote sem linha ou com título mudado,
  `selectLotsToEvaluate`). Saída: `score`(0-100), `rarity`(`comum`/`interessante`/`raro`/
  `muito_raro`), `deal`, `album` ("Artista - Álbum"), `reason`, `tags[]` (`parseEvalObject`,
  tolerante a cercas). **Visão:** capa http(s) vai como bloco `image` (antes do texto) para
  identificar o disco (`usableImage` descarta `data:`).
- **Identificação simples — `lot_ident`** (isolada da avaliação, **sem gate de modo**): passada
  **barata** que preenche só artista/álbum/ano em **toda a base**. Tabela `lot_ident` (`id`,
  `title_hash`, `album`, `year`, `confidence`, `source`, `model`). `buildIdentUserPrompt`/
  `parseIdentObject`; `selectLotsToIdentify` (passada por título), `selectLotsToReident` (baixa
  confiança + tem imagem → **escala para a capa**). Persistência `lot-ident.server.ts`; estado
  próprio `app_state.ai_ident_batch`. **Discogs usa o álbum mesclado** `lot_ai` (preferido) +
  `lot_ident`.
- **Modo automático — chave `ai_mode`** (`getAiMode`/`setAiMode`): `"off" | "all" | "watched"`,
  **padrão `"watched"`** (econômico). No `step=aieval`: `off` não coleta/submete; `all` = todos
  os lotes; `watched` = só lotes vigiados ∪ com lance (ids de `listWatchedFromSite` +
  `listMyBidsFromSite`).
- **Análise sob demanda** (síncrona): `evalLotsSync` usa a **Messages API** (`messages.create`,
  concorrência 4) — não a Batches. Server fn `analyzeOnDemand({day, house?, max})` avalia só os
  não avaliados (até `max`=25) e devolve `{evaluated, remaining}` para o cliente repetir em
  laço. Roda **em qualquer modo**, inclusive com a IA desligada. UI: botões "Analisar dia" /
  "Analisar" (casa) + `Select` de modo no header.
- **`matchesInterests` é da UI, NÃO da IA:** `buildInterestMatcher` (`ai-score-utils.ts`) casa
  a lista `app_state.user_interests` com o título via `normalizeForMatch` (determinístico,
  não gasta tokens); destaca com ⭐.

## Discogs / preço de mercado (`lot_market`)

- **API Discogs** (`api.discogs.com`, grátis; 60 req/min **com token** `DISCOGS_TOKEN`,
  opcional → no-op sem ele). `discogs.server.ts` sem SDK, `fetch` + **throttle ~1.1s**, parsing
  defensivo.
- **Casamento estruturado:** `parseAlbum` quebra o `album` da IA em `{artista, título, ano}`;
  `fetchMarket(album, title)` busca `artist=…&release_title=…&format=Vinyl&per_page=25` (cai
  para texto livre só se não achar); `pickBestRelease` pontua cobertura do álbum + artista +
  ano + vinil, **penaliza coletâneas** ("1967-1970"/"greatest hits") e **rejeita (null)** sem
  cobertura mínima (melhor não casar que casar errado).
- **Faixa BR (preço + frete):** a API oficial não dá faixa nem país/frete → **scraping da
  página de venda** `www.discogs.com/sell/release/<id>?ships_from=Brazil&currency=BRL&sort=price,asc`
  (`fetchBrListings` + `parseSellPage`, soma preço + frete por anúncio; `summarizeListings` →
  menor/maior total + contagem). Best-effort: se o HTML mudar, a faixa some (fallback no
  `stats`).
- **Persistência** `lot-market.server.ts`, tabela `lot_market`, cache por `basis`
  (hash `album||título`; `matched=false` não reconsulta). Colunas BR
  `price_low_br`/`price_high_br`/`num_for_sale_br`; `getAllLotMarket`/`upsertLotMarket`
  **toleram coluna ausente** (`isMissingColumn`, código `42703`/`PGRST204`) e caem para as
  colunas base. Cron `step=market`.
- **Reprocessar:** o `basis` não muda, então matches errados já gravados **não** são
  reconsultados sozinhos → `DELETE FROM lot_market` (ou só os suspeitos) e rodar o `refresh.yml`.

## Sondagem — obras caçadas (`wantlist_items`)

- Rascunho de obras que o usuário procura, usado como sinal extra e filtro. Tabela
  `wantlist_items` (`raw`, `work`, `year`, `note`, `norm`, `acquired`, `position`). Parser puro
  `parseWantlistText` (`wantlist-parse.ts`, uma obra/linha, tolerante a numeração/ano/nota;
  client-safe). CRUD `wantlist.server.ts` (`importWantlistText` **acrescenta**, ignora
  duplicatas). Diálogo "Sondagem" no header da Análise (colar/pesquisar/editar/marcar
  adquirido/remover).
- **Casamento probabilístico** `wantlist-match.ts` (puro, sem IA): `scoreWant → 0..1` compara
  **tokens** da obra contra `lotIdentity` (título + artista + `album` da IA/`lot_ident` +
  `release_title` do Discogs). **Porta do artista** (nome ausente ×0.4), **ano** (+0.15 casa /
  −0.25 diferente), fuzzy leve (`withinOneEdit`). Limiar **`WANT_MATCH_THRESHOLD = 0.8`**
  (`bestWantForLot`) → marca **🎯** no título (tooltip "Sondagem: obra (ano) · NN%") e alimenta
  o filtro "Só sondagem".
- **Não pesa na nota da IA** — é só destaque + filtro (como os interesses ⭐). Dar peso real
  segue em aberto.

## Páginas / UI

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
- **Split do `index.tsx`:** lógica em `src/components/vinyl/` — `grouping.ts` (puros + tipos),
  `badges.tsx`, `filters.tsx`, `lot-card.tsx`, `bid-house-sections.tsx`, `live-auctions.tsx`,
  `ai-score.tsx` (UI) + `ai-score-utils.ts` (puros/client-safe — `parseAiAlbum`/`formatAiAlbum`,
  rarity legend, `LotMarket`/`toLotMarket`, `buildInterestMatcher`). Helpers puros/UI ficam em
  arquivos `.ts`/`.tsx` separados por causa do react-refresh (o especificador resolve `.ts`
  antes de `.tsx` — nomes não podem colidir).

## Ferramenta separada: `tools/missleiloes-sniper.user.js`

Userscript (Tampermonkey/bookmarklet) que roda **na página do pregão ao vivo** do missleiloes
(`@match */presencial/presencial.asp*`). **NÃO faz parte do app.** Pregão **soft-close** (cada
lance reinicia o cronômetro). Objeto global `novoPresencial`: polling (~1s) via `LePregao`,
estado em `statusatual` (P→X→1/2/3→4 FECHANDO→F), `valorpecaatual` (próximo lance),
`lancevencedor`; lance por `Fazerlance()` → `POST lote_fazerlance.asp`. v3: **um lance no
status 4 (FECHANDO)**, Turbo (polling ~250ms) + confirmação. Sniping clássico não existe no
soft-close; a vantagem é reagir mais rápido no último instante. (`tools/` é ignorado no
ESLint/Prettier.)

## Infra (migração Lovable → Supabase próprio + Vercel, 2026-08)

- **Deploy Vercel** (não mais Cloudflare). Nitro é plugin Vite (`import { nitro } from
  'nitro/vite'`), **auto-detecta a Vercel** por `process.env.VERCEL`; build gera
  `.vercel/output` (Build Output API v3). `vercel.json`: `bun run build` / `bun install` /
  `framework: null`. `bunfig.toml` → npm público; `bun.lock` regenerado.
- **Auth Supabase nativo** (Google, **PKCE**). Fluxo em `src/routes/auth.tsx`:
  `signInWithOAuth({redirectTo: origin + '/auth'})` → `/auth?code=…` →
  `exchangeCodeForSession(code)`. Client com `flowType:'pkce'`, `detectSessionInUrl:false`.
  Acesso restrito ao e-mail `LEILOESBR_EMAIL` (`src/lib/access.server.ts`).
- **Supabase**: projeto `rjqzzxhgcelixlgnfcic`. RLS mantém tudo só para `service_role` (o front
  não lê o banco direto; server functions usam `supabaseAdmin`).
- **Produção**: `https://leilao-finder-buddy.vercel.app` (branch `main`). Previews de PR usam
  URL com hash que **muda a cada deploy** (o rodapé mostra a `APP_VERSION` no ar).
- **Auth URLs (Supabase → Authentication → URL Configuration):** Site URL de produção; Redirect
  URLs incluem `…vercel.app/**`, o padrão de preview `…-gilbertomaiarj1984s-projects.vercel.app/**`
  e `http://localhost:3000/**`. Google OAuth: redirect URI
  `https://rjqzzxhgcelixlgnfcic.supabase.co/auth/v1/callback`.
- **Env vars** (`.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LEILOESBR_EMAIL`,
  `LEILOESBR_SENHA`, `CRON_TOKEN`, `ANTHROPIC_API_KEY`, `DISCOGS_TOKEN`. Na Vercel devem estar
  em **Production**; mudar env exige **Redeploy**. `.env` é gitignored. A `publishable`
  (`sb_publishable_`) é pública por design; senha do banco e `service_role` foram rotacionadas
  após a migração. Dados migrados via `pg_restore --data-only` (usuários do `auth` **não**
  migrados — login refeito com Google).

## Histórico de versões

Fonte única da versão em `src/lib/version.ts` (`APP_VERSION`) + `package.json`. Bump em todo PR.

| Versão | Entrega | PR |
| --- | --- | --- |
| v0.1.0 | Rodapé global + versionamento (`Footer.tsx`, `version.ts`) | #35 |
| v0.2.0 | Regra de bump obrigatório + features acumuladas (valor atual, última atualização, casas verificadas) | — |
| v0.4.0 | IA de avaliação (`lot_ai`, Batches) + página **Análise** | #51 |
| v0.5.0 | Âncora de mercado Discogs (`lot_market`) | — |
| v0.6.0 | **Sondagem** (`wantlist_items`) + filtros da Análise | #52 |
| v0.6.1 | Casamento probabilístico da sondagem (`wantlist-match.ts`, ≥80%) | #53 |
| v0.7.0 | Refino Análise: `color-scheme:dark`, Top 100 + tabela por casa, hover via portal | #54 |
| v0.8.0 | Faixa Discogs BR (scraping), "Lances do dia" por dia do leilão, tags editáveis | — |
| v0.8.1 | Raridade colorida pela escala (`RarityLabel`) | — |
| v0.9.0 | Filtro por raridade + feedback/validação na edição de tags | — |
| v0.9.1 | Jank ao editar tag (`albumById` estável) + resiliência do `lot_market` + hover no toque | — |
| v0.10.0 | Casamento Discogs por artista+álbum+ano (busca estruturada, `pickBestRelease`) | — |
| v0.10.1–0.10.2 | Endurecimento do cron (header-only, timing-safe), sem retry em 4xx, DRY em `grouping.ts` | #60 |
| v0.11.0 | Controle da IA: modo `ai_mode` (off/all/watched) + análise sob demanda | #61 |
| v0.12.0 | Cards (casa verificada fecha, nº no canto esquerdo, álbum acima do título) + `lot_ident` | — |
| v0.13.0 | Fix classificação IA (separador `/`) + categoria "Lote" + busca por relevância | #63/#64 |
| v0.14.0 | Página **Ao vivo** (pregão presencial por casa) | #66 |

> Observação: PRs #63/#64/#66 foram mesclados via API **sem** bump; a versão foi consolidada
> depois. O `version-bump.yml` só barra merge pela UI — reforça a convenção de sempre bumpar.

## Pendências

**Produto / código**

1. **Lance pelo app (leiloesbr):** avaliar/implementar dar lance pelo app (regra do usuário:
   sempre o próximo menor valor; após lançar, verificar em segundos se foi coberto e relançar).
   **Bloqueio:** falta o **endpoint de lance** e a **regra de incremento** do leiloesbr — o
   usuário precisa **capturar** (F12 → Network, lote barato) a requisição de lance. Considerar
   que o site talvez já tenha "lance automático" nativo; ToS/edital costumam proibir automação
   (risco/decisão do usuário).
2. **Sondagem não pesa na nota** — hoje é só destaque + filtro. Dar peso real (bônus
   determinístico no ranking, ou mandar a lista ao prompt) segue em aberto, se desejado.
3. **Importar o rascunho real da sondagem** pela UI e conferir o 🎯/tooltip e o filtro "Só
   sondagem"; ajustar `WANT_MATCH_THRESHOLD`/pesos em `wantlist-match.ts` se pegar demais/de menos.

**Validar em produção (não dá para testar daqui)**

4. **Aplicar o `setup.sql`** para as tabelas/colunas mais recentes (`lot_ident`, colunas BR de
   `lot_market`) caso ainda não tenham sido aplicadas; garantir `ANTHROPIC_API_KEY` e
   `DISCOGS_TOKEN` configurados (GitHub secret + env Vercel).
5. **Rodar o `refresh.yml`** (Actions → Run workflow) e conferir cada passo: `enrich`
   (`updated>0`, nº de lote preenchendo), `aiident`/`aieval` (`submitted`/`collected>0`),
   `market` (`updated>0`, inclusive lotes só identificados). Rodar mais vezes melhora o
   casamento da sondagem (mais `album`/ano → mais sinais no `lotIdentity`).
6. **Baseline do painel:** 1ª visita semeia (tudo "novo"), 2ª já mostra variação/"último
   acesso". Se persistir tudo "novo", o `markSeen` agora **lança** o erro real (toast) —
   investigar a gravação em `app_state`.

**Concluído recentemente:** `wantlist_items` aplicada em produção (2026-09-03; importar/editar/
marcar adquirido gravam sem erro). Secrets do cron (`APP_URL`, `CRON_TOKEN`) e 1ª execução do
`refresh.yml` no ar. Revisão/refatoração pós-Lovable (lint/format, remoção de morto, DRY).

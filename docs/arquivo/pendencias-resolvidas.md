# Pendências resolvidas (arquivo)

> Histórico de investigações já encerradas, movido da lista de pendências. Útil só para
> entender o porquê de um fix antigo — não é leitura de início de sessão.

- **✅ RESOLVIDO (v0.85.2) — Listagem geral só rendia lote em 1-2 páginas por chamada (achado
  v0.85.1, casa "Miss leilões" ausente).** Limite de taxa da LeilõesBR: da 3ª requisição
  seguida em diante, HTTP 200 com corpo vazio. Resolvido com `listingFetch` (intervalo mínimo +
  retry em corpo vazio) e orçamento de tempo nos steps chunked — ver changelog v0.85.2 e a seção
  "Scraping do LeilõesBR". Acompanhar no log do cron: `failedPages`/`emptyPages` devem ficar
  vazios; se voltarem a aparecer, aumentar `LISTING_MIN_GAP_MS`.

- **✅ RESOLVIDO (v0.76.2) — Causa raiz do 500 em `step=aiident`/`reident` (achado v0.74.1, run
  `#160` do `refresh.yml`, 2026-09-22).** Confirmada por log direto da VPS (`docker compose
  logs app`) numa recorrência (runs `#161`/`#162`, mesmo dia): `upsertLotIdent` explodia com
  violação de FK (`lot_ident_id_fkey`, código `23503`) quando o `lot_id` não existia mais em
  `lots` (lote podado ou excluído manualmente entre a seleção do batch e a gravação). Ver
  changelog v0.76.2 para o fix.

- **✅ RESOLVIDO (v0.73.5) — Itens não-disco reincidentes da "Alberto Lopes - Leiloeiro
  Público" (aberto desde v0.69.42/43, reforçado em v0.71.1).** Essa casa generalista rendeu 4
  rodadas de achados do usuário (joalheria, depois livro/quadro/lata/brinquedo via
  `galleryscan` sem categoria travada, depois prataria/salva/bandeja, por fim bijuteria de
  novo em 2026-09-22 com "ANELÃO MASCULINO ANTI STRESS" — título sem nenhum termo bloqueável)
  mesmo após rodadas de `step=cleannonvinyl` limpar o que já tinha entrado — confirmando que a
  PRÓPRIA LeilõesBR marca itens fora de disco na categoria "Disco de Vinil" pra essa casa
  específica, não só o gap do `galleryscan` (já corrigido em v0.69.43). Ampliar
  `NON_MEDIA_COLLECTIBLE_RE` termo a termo não escala — adotada a alternativa já cogitada aqui:
  a casa inteira agora é bloqueada (`BLOCKED_HOUSES` em `leiloesbr-scrape.server.ts`, hardcoded
  — não é um toggle de UI como `verified_houses`) em todos os pontos de entrada da varredura, e
  `pruneNonVinylLots`/`step=cleannonvinyl` apaga retroativamente os lotes já persistidos dela.

- **✅ RESOLVIDO DE VEZ (v0.69.27/29, validado em produção 2026-09-21) — `step=aieval` voltando
  500 "Missing DATABASE_URL" (aberto desde v0.69.15).** Causa raiz: **dois secrets do GitHub
  Actions nunca foram atualizados pro VPS no cutover da Fase 6** — `APP_URL` apontava pra Vercel
  (`leilao-finder-buddy.vercel.app`, corrigido v0.69.27) e, uma vez corrigido esse, apareceu o
  segundo em paralelo: `CRON_TOKEN` também divergente entre o secret do GitHub e o `.env` do
  VPS (401 Unauthorized, achado/corrigido v0.69.29). A Vercel nunca parou de receber auto-deploy
  deste repo, então rodava o código atual — só que sem `DATABASE_URL` (env exclusiva do VPS).
  Confirmado resolvido de vez na run `#144` (todos os steps do `refresh.yml` com sucesso,
  `aieval` com `conn-info` direto pro VPS) e reconfirmado nas runs `#151`/`#152` (2026-09-21,
  já sem a instrumentação de diagnóstico precisar de nada especial — ver Histórico de versões,
  v0.69.27–29, pra investigação completa).
  - Mitigação que fica valendo: `/api/health` (`src/lib/health.server.ts`) + `health_uri` ativo
    no Caddy (v0.69.21) — proteção estrutural de baixo custo, útil independente da causa.
  - Instrumentação temporária de diagnóstico **removida** (v0.69.33): header `X-Debug-Upstream`
    no `Caddyfile` e `-v`/`-D` na chamada do `aieval`/`prune` em `refresh.yml` (v0.69.4/21/26) —
    nenhum dos dois é mais necessário, o tráfego já vai pro VPS de verdade.

- **✅ FEITO (v0.69.33) — remoção de TODAS as referências ativas à Vercel do código/docs**,
  pedido explícito do usuário assim que o bug do `aieval` foi confirmado resolvido. Removidos:
  `vercel.json`, entrada `.vercel` em `.gitignore`/`.dockerignore`, menção a `vercel.app` no
  User-Agent do Discogs (`discogs.server.ts`), comentários citando Vercel em
  `vite.config.ts`/`leiloesbr-scrape.server.ts`/`lot-ai.server.ts`/`lot-ident.server.ts`/
  `lot-sales.server.ts`, instruções desatualizadas em `.env.example` (chaves de IA/Discogs
  agora documentadas como lidas do `.env` do VPS, não mais "Environment Variables da Vercel"),
  e o parágrafo do `CLAUDE.md` que ainda dizia "falta a Fase 6" (cutover já concluído desde
  v0.69.13). Mantido de propósito o registro **histórico** da migração (`README.md`,
  `docs/economia-fase-2-vps-unico.md`, `docs/economia-migracao.md`,
  `docs/economia-fase-1-egress-e-cpu.md`) — essas menções não são instrução ativa, são o
  porquê da arquitetura atual (VPS único). Usuário confirmou nesta janela que também já
  desconectou o auto-deploy da Vercel pra este repo (Vercel → Project Settings → Git) e removeu
  a Authorized redirect URI antiga (Google Cloud Console) — ambas ações fora do alcance de
  qualquer sessão. **Fase 6 (cutover) totalmente encerrada, sem pendências restantes.**

- **✅ RESOLVIDO (achado em v0.69.28, decorrente do bug acima) — o cron vinha PERDENDO lotes desde o
  cutover da Fase 6, não só falhando o `aieval`.** Causa raiz de UM NÍVEL MAIS FUNDO do que
  parecia: o shim `db-query.server.ts` (`createDbQueryClient`/`QueryBuilder.execute`) tem
  contrato explícito de **nunca lançar** — todo erro do Postgres (`DATABASE_URL` ausente,
  conexão recusada, o que for) vira `{ data: null, error }` resolvido normalmente, igual ao
  PostgREST. `persistLots` (`leiloesbr-scrape.server.ts`, usado por `scrapeVinylChunk` e
  `enrichMissingLotes`) fazia `await supabaseAdmin.from("lots").upsert(rows, ...)` **sem checar
  `error`** — então o `try/catch` ao redor nunca disparava (não havia o que capturar: a promise
  sempre resolvia "com sucesso", só que sem gravar nada) e o `console.error` de diagnóstico
  nunca rodava. `scrapeVinylChunk`/`enrichMissingLotes` devolviam **HTTP 200 normal**, com
  `scraped`/`updated` contando o que foi RASPADO do site (parse do HTML), não o que foi GRAVADO
  no banco. Combinado com o bug do `APP_URL`/Vercel acima (sem `DATABASE_URL` lá), toda rodada
  de cron desde o cutover da Fase 6 raspou o site normalmente mas **não gravou nada de novo** na
  tabela `lots` real (a do VPS) — o app ficou servindo só o snapshot congelado de antes da
  migração, cada vez mais defasado da contagem real do LeilõesBR, sem nenhum log ou sintoma
  visível (diferente do `aieval`, que usa `ai-eval.server.ts`/outros módulos que SEMPRE checam
  `error` e relançam — por isso só ele estourava 500 e abortava o `refresh.yml`, mascarando que
  `chunk`/`enrich`, rodando antes dele no laço, já não estavam gravando nada). **Corrigido em
  v0.69.28**: `persistLots` agora checa `{ error }` do `.upsert()` e relança (removido o
  `try/catch` que envolvia essa chamada — ela nunca lançava mesmo, então o bloco só escondia o
  problema; o histórico de leilões via `recordAuctions`, best-effort à parte, continua
  silencioso de propósito). `scrapeVinylChunk`/`enrichMissingLotes` devolvem `persisted: boolean`
  (`false` quando o erro relançado foi pego pelo `try/catch` que já existia nelas) e `refresh.yml`
  aborta a run (+ ping de falha no healthchecks.io) assim que vir `persisted:false`, em vez de
  seguir o laço até o fim fingindo que terminou. **Isso não troca o secret `APP_URL` sozinho** —
  só transforma a perda silenciosa em falha ruidosa, visível no log da Action/healthchecks.io,
  até o item acima ser corrigido pelo usuário. Depois de trocar o secret e confirmar rodadas
  verdes: (1) considerar rodar `chunk`/`enrich` manualmente (botão "Atualizar tudo") pra
  recuperar o atraso acumulado mais rápido que esperar os 2 ciclos diários; (2) varrer o resto
  do arquivo por outros `.upsert()`/`.insert()`/`.update()`/`.delete()` que não checam `error`
  (`pruneOutOfWindow` aqui mesmo é um candidato — não corrigido agora por ser limpeza, não
  causa de perda, mas mesma classe de risco) — não é garantido que este seja o único lugar.
  **Confirmado em produção**: as runs `#151`/`#152` (2026-09-21, após o usuário trocar o
  `APP_URL`) mostram `chunk`/`enrich` com `persisted:true` em toda chamada — a gravação no
  banco do VPS está funcionando de verdade.

- **✅ RESOLVIDO (achado em 2026-09-21, INDEPENDENTE da migração — ver nota abaixo) — dia
  inteiro sumindo da listagem (ex.: quinta 24/9 com 0 lotes, cercado por 21/9=1194, 22/9=344,
  23/9=563, 25/9=615).** Depois de confirmar a persistência (item acima), o usuário ainda achou
  lotes de vinil reais sumindo — não só o caso do dia 24 zerado, mas também a casa **Abreu
  Colecionismo** trazendo só 125 dos 198 lotes do dia 22 que aparecem no catálogo dela mesma.
  Causa raiz: `scrapePages`/`scrapeVinylChunk` (`leiloesbr-scrape.server.ts`) caminhavam pelas
  páginas da listagem geral (`busca_andamento.asp`) de trás pra frente e **paravam assim que
  encontravam uma página cujo dia mínimo já tinha passado do fim da janela** (`passedWindow`),
  assumindo que a ordenação é estritamente monotônica por data ("os dias mais próximos ficam
  nas últimas páginas"). Na prática os leilões vêm intercalados (não ordenados só por data) —
  uma página "fora da janela" não garante que as páginas seguintes (números menores) também
  estejam; leilões inteiros com lotes dentro da janela (confirmados pelo usuário: "Peça Única
  Colecionismo" e "Livros Universo - Livros Raros e Antiguidades" com vinil pro dia 24; "RT
  Leilões e Artes", casa já com histórico normal na base) ficavam permanentemente fora do
  alcance da varredura, sem nenhum log. **Achado reproduzível/determinístico**: duas rodadas
  completas do cron (`#151`, `#152`) pararam exatamente no mesmo intervalo de páginas (93→34),
  nunca alcançando as páginas 33→1 em nenhuma das duas — não era questão de dado ainda não
  publicado. **Corrigido em v0.69.30**: removido o corte antecipado por `minDay` em
  `scrapePages` (usada por `scrapeVinylLots`/`refreshVinylDay`) e em `scrapeVinylChunk` (usada
  pelo cron); agora a varredura sempre vai até `MAX_PAGES`/`page=1`, e só o filtro por `dayKey`
  item a item decide o que entra na janela — mais requisições por rodada (hoje ~93 páginas
  completas em vez de parar em ~60), mas dentro do orçamento já existente (`MAX_PAGES=150` na
  leitura ao vivo; laço de 80 chamadas × 15 páginas no `refresh.yml`).
  ⚠️ **Nota de atribuição**: diferente do bug de persistência acima, este é **mais antigo que a
  migração pra VPS** — a lógica `passedWindow` já existia no código em 10/09 (v0.44.x),
  bem antes da Fase 1 da migração (v0.62.0). Não é um efeito colateral do cutover; só não tinha
  sido percebido porque, até a persistência ser corrigida, o app servia um retrato congelado
  de dados antigos e ninguém conferia a distribuição por dia de uma varredura fresca dia a dia.

**Leilão de casa multi-dia sumia de um dia específico (resolvido em v0.69.41)**

- Usuário reportou: leilão 64791 (Robson Gini Leilões/Trem das 7, `tremdas7.com.br`, catálogo
  com "1º DIA" 21/9 e "2º DIA" 22/9) não aparecia na ferramenta no dia 1 (hoje), mesmo validado
  pelo usuário no catálogo da própria casa. Dias 22/23/24 (outros leilões da mesma casa)
  apareciam normalmente; dia 25 também estava faltando no momento do report.
- Diagnóstico (`step=findlot&q=64791`, 92 páginas da categoria "Disco de Vinil"): o leilão
  **é descoberto normalmente** (não é o gap de categorização das outras pendências) — mas
  **todos** os lotes achados vinham com `dayKey: 2026-09-22`, nenhum com `2026-09-21`. Causa:
  a listagem geral da LeilõesBR (`busca_andamento.asp`) **para de listar os lotes de um leilão
  assim que ele fica "ao vivo"** (comportamento já documentado em "Scraping do LeilõesBR",
  v0.51.4 — mesmo efeito que fazia vigiados "sumirem" ao terminar o leilão). O pregão do dia 1
  começava às 15h; a varredura das 14:10 (BRT) não pegou a tempo (catálogo publicado tarde
  demais pela casa) e, depois das 15h, o leilão simplesmente não aparece mais na fonte — não
  tem como redescobrir depois.
- ⚠️ **Não é remoção do nosso lado**: o upsert (`persistLots`) nunca apaga o que já foi
  capturado; um lote só some da janela por `pruneOutOfWindow` (fora dos dias da janela). O
  problema é 100% de **descoberta** — se o cron não escaneou o leilão antes dele ficar ao
  vivo, o lote nunca chega a entrar no banco (não há nada pra "manter visível").
- **Fix (v0.69.41)**: cron 2x/dia → **3x/dia, de 8 em 8h** (`refresh.yml`, `10 3,17 * * *` →
  `10 3,11,19 * * *`, BRT 00:10/08:10/16:10) — reduz a janela entre execuções, diminuindo a
  chance de um catálogo publicado perto do horário do pregão passar batido. Não elimina o gap
  por completo (uma casa pode publicar e já ficar ao vivo dentro do intervalo de 8h), mas é a
  mitigação direta sem reescrever a arquitetura de descoberta (que dependeria de saber o
  horário de cada pregão com antecedência, informação que só vem depois de já ter descoberto o
  leilão). Investigação encerrada a pedido do usuário — mitigação aplicada, sem necessidade de
  aprofundar mais.

  _(Itens mais antigos desta seção — lance pelo app, upload de foto em massa, peso da sondagem
  na nota e imagem pelo CDN do catálogo — foram **cancelados/descartados**.)_

**Validar em produção**

- ✅ **Validações confirmadas** — `setup.sql` aplicado (tabelas/colunas mais recentes), env da
  Vercel (`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`DISCOGS_TOKEN`) e cron `refresh.yml` (incl.
  `condition`, `sales`, `reident`, `market`) conferidos em produção; v0.41.0 (seletor de IA,
  "Reidentificar (IA)", header sticky, failover do Gemini e visão/capa) verificada.

## Investigação encerrada — lote da "Coisa Antiga Leilões" ausente (v0.69.31–v0.69.43)

- **🔎 EM INVESTIGAÇÃO (2026-09-21, v0.69.31/32/34/35) — mesmo após o fix de paginação acima,
  usuário reportou um lote específico do dia 24/9 ainda ausente da ferramenta**: casa "Coisa
  Antiga Leilões", `https://www.coisaantigaleiloes.com.br/catalogo.asp?Num=65152` (idLeilao
  65152). A run `#153` (v0.69.30, pós-fix) já varreu a listagem geral até o fim (93→3→null,
  cobrindo o intervalo antes pulado), então o caso muda de natureza: não é mais o corte
  antecipado por página. **Ferramenta de diagnóstico nível 1** (`findLotDebug`,
  `leiloesbr-scrape.server.ts`, `step=findlot&q=<idLeilao ou casa/URL>` em `cron.server.ts`;
  chamada avulsa via novo workflow `debug-cron.yml`, `workflow_dispatch` com input
  `querystring`, sem rodar a cadeia pesada do `refresh.yml`) rodada em produção
  (`step=findlot&q=65152`): varreu as 93 páginas da categoria "Disco de Vinil" da LeilõesBR de
  ponta a ponta e **não achou NENHUMA ocorrência** do leilão 65152 (`matches: []`) — descarta
  bug nosso (paginação/`looksNonVinyl`/parse de `dayKey`) pra esse caso: o item simplesmente não
  está na categoria vinil da LeilõesBR.
  ⚠️ **Achado do usuário que reabriu a investigação**: no catálogo PRÓPRIO da casa
  (`coisaantigaleiloes.com.br/catalogo.asp?Num=65152`), o leilão tem 401 itens, dos quais **319
  categorizados como "Disco de vinil"** (e 82 como "Música") pelos filtros do site DELA.
  **Ferramenta nível 2** (`findLotSearch`, `step=findlot2&idLeilao=<...>&pesquisa=<termo>&
  lockToVinyl=0|1`): busca por texto livre (`pesquisa`, filtrado no SERVIDOR — mantém o total
  de páginas viável mesmo sem travar categoria), rodada com `pesquisa=Ray Charles&
  lockToVinyl=0` — **achou de primeira** (1 página só, o texto já filtra bem no servidor):
  o item 65152/32420758 ("Os Cantores de Ray Charles") está lá, `dayKey: "2026-09-24"` (correto),
  `wouldKeep: true` (passaria no nosso filtro). **Confirma**: o item existe e está saudável na
  listagem geral da LeilõesBR, só não está marcado com `tp="Disco de vinil"` — categorização
  entre a casa e a plataforma não bate, fora do nosso scraper.
  ⚠️ **Pista nova do usuário**: no catálogo da CASA, marcar o filtro "Disco de vinil" grava
  `tipo=|129|` na URL — um CÓDIGO NUMÉRICO local, bem diferente do `tp=|446973636F2064652076696E696C|`
  (texto "Disco de vinil" em hex) que a LeilõesBR usa na busca geral. Podem ser esquemas de
  categoria DIFERENTES (numérico por casa vs. texto/hex da plataforma). **Ferramenta nível 4**
  (`findLotByCategory`, `step=findlotcat&idLeilao=<...>&tp=<...>&pesquisa=<termo>`): testa
  qualquer `tp=` CRU (ex.: `|129|`) direto na busca geral da LeilõesBR — rodada com
  `tp=|129|&pesquisa=Ray Charles`, **não achou nada** (`matches: []`): o código numérico da
  casa NÃO é reconhecido como categoria pela busca geral da LeilõesBR (esquemas mesmo
  diferentes, confirmado). Também adicionada **ferramenta nível 3** (`findLotRawCard`,
  `step=findlotraw&idLeilao=<...>&pesquisa=<termo>&lockToVinyl=0|1`): devolve o HTML bruto do
  card que bate o idLeilao (truncado), útil se alguma hipótese futura exigir inspecionar o
  markup em vez de só os campos já extraídos por `parseCard` (que hoje não captura NENHUM
  campo de categoria) — ainda não usada.
  💡 **Saída encontrada pelo usuário (v0.69.35, plano em `docs/notas-desenvolvimento.md`
  aprovado)**: ao navegar `busca_andamento.asp?tp=<vinil>` sem `pesquisa`, a página mostra uma
  seção **"GALERIAS"** — checkboxes com CADA CASA que tem itens na categoria filtrada, cada
  uma com um código `ga=<n>` que filtra `busca_andamento.asp?ga=<n>&tp=<vinil>` só pra aquela
  casa. Isolando o problema: o gap é PURAMENTE de descoberta — `fetchCatalogData(domain,
  idLeilao)` (`leiloesbr-catalog.server.ts`, já existente, usada por `enrich`/`condition`/
  `sales`) já busca o catálogo INTEIRO de um leilão conhecido tentando `Tipo=129` (o mesmo
  "129" que a casa usa!) e caindo pro catálogo completo se vier vazio (v0.34.0) — ou seja, uma
  vez que a gente SAIBA que o leilão 65152 existe, o pipeline de extração já funciona; só falta
  descobrir o `idLeilao` quando a categoria da LeilõesBR não bate. Adicionadas duas ferramentas
  de diagnóstico (Fase 1 do plano, ainda não validadas contra produção): `listGalleries(tp)` /
  `step=galleries[&tp=<...>|tp=none]` — tenta extrair a seção GALERIAS (best-effort, a
  estrutura exata do HTML nunca foi inspecionada neste ambiente sem rede; sempre devolve
  também um `rawSnippet` do HTML bruto ao redor da palavra "galeria" pra ajustar o parser com
  dado real) — e `step=catalogdebug&domain=<...>&idLeilao=<...>`, que chama
  `fetchCatalogData` direto com parâmetros arbitrários (isola "descoberta" de "extração": se
  `catalogdebug` pro leilão 65152 trouxer os ~319 itens certos, confirma que só falta a
  descoberta). Próximo passo: rodar `step=galleries&tp=|446973636F2064652076696E696C|` em
  produção, ler o `rawSnippet`, confirmar/ajustar o parser e checar se "Coisa Antiga Leilões"
  aparece na lista — reportar ao usuário e AGUARDAR antes de implementar a Fase 2 (enumeração
  por galeria).
  ✅ **Rodado em produção (v0.69.35)**: `galleries: []` (parser heurístico por regex não achou
  NADA), mas o `rawSnippet` devolvido confirmou a estrutura REAL do HTML — um
  `<ul id="comboGalerias">` com um `<li class="lista-subcats-item">` por galeria, cada um com
  `<input type="checkbox" class="ga" value="<código>" name="gaval" id="ga<n>">` e um
  `<label for="ga<n>">Nome da Casa</label>` num `<div>` IRMÃO (não aninhado dentro do mesmo
  elemento do checkbox) — por isso o regex antigo, que só olhava o primeiro `>texto<` logo
  após o `<input>`, sempre batia em espaço em branco entre tags e descartava todas as
  galerias. Lista alfabética confirmada visível no trecho: Abreu Colecionismo (546), Alberto
  Lopes - Leiloeiro Público (199), Antiguera Leilões (610), Antiques MP (886), Bastos Leilões
  (536), Baú das Antiguidades (1032), Baú do Gordo (1093), Bolorini Leilões (166), Brechó Chic
  Leilões (306), Bruce Angeiras Leilões (299), Catavento Discos (662)... — "Coisa Antiga
  Leilões" ainda não apareceu no trecho de 6000 chars devolvido (a lista é alfabética e o corte
  ficou na letra C antes de chegar em "Coisa"), não confirma ausência.
  🔧 **v0.69.36**: `listGalleries` reescrita pra usar `node-html-parser`
  (`querySelectorAll`/`querySelector`, o mesmo parser já usado por `parseCard`/`parseCards`
  neste arquivo) em vez de regex — busca `#comboGalerias li` (com fallback pra
  `.lista-subcats-item` caso o id mude), extrai `input[type="checkbox"][value]` e `label` de
  cada item, independente de espaço/ordem de atributos entre os dois. `rawSnippet` aumentado
  para 8000 chars. Ainda não validado em produção — próximo passo: rodar
  `step=galleries&tp=|446973636F2064652076696E696C|` de novo e conferir se agora vem a lista
  completa de galerias com "Coisa Antiga Leilões" nela.
  ✅ **Rodado em produção (v0.69.36)**: parser DOM funcionou — **68 galerias** extraídas, e
  **"Coisa Antiga Leilões" está na lista, código `356`** (`ga=356`). Confirma a hipótese sem
  precisar cair pra `tp=none`: mesmo com a categoria "Disco de Vinil" travada, a seção
  GALERIAS lista essa casa (o mismatch de categorização é só nos ITENS dela, não na
  listagem de galerias em si).
  🔧 **v0.69.37 (Fase 2 — enumeração por galeria)**: ao planejar a extração pós-descoberta,
  achado que `fetchCatalogData` (a função original pensada pra isso) NÃO serve — devolve
  `Map<idPeca, CatalogLot>` sem `image`/`price`/`dayKey`/`artist` (foi desenhada só pra
  ENRIQUECER lotes já existentes com nº de lote e dados de venda, não pra criar `VinylLot`s
  novos do zero). Abordagem mais inteligente adotada: reaproveitar `fetchPageSearch`/
  `parseCards` (a MESMA função da listagem geral) paginando por `busca_andamento.asp?ga=<código>`
  em vez de por `tp=<categoria>` — devolve `VinylLot`s já completos, filtrados por TÍTULO
  (`looksNonVinyl`, mesmo critério de `scrapeVinylChunk`) em vez de por tag da plataforma,
  sidestepando o gap de categorização por completo. Adicionado:
  - `listUrlSearch`/`fetchPageSearch` ganham parâmetro opcional `ga` (`leiloesbr-scrape.server.ts`).
  - `listGalleryAuctions(galleryCode)`: pagina `ga=<código>` (sem travar `tp=`), filtra por
    `looksNonVinyl` + janela de dias, devolve `VinylLot[]` prontos pra `persistLots`.
  - `scanGalleries(offset, count, tp?)`/`step=galleryscan&offset=<n>&count=<n>[&tp=<...>|tp=none]`:
    chunked como `step=chunk`/`step=enrich` (cursor `offset` no servidor), varre `count`
    galerias por chamada, persiste os lotes achados a cada bloco (`persistLots`, merge/upsert
    de sempre). Ainda não testado em produção.
  Próximo passo: testar `step=galleryscan` isolado (via `debug-cron.yml`) contra a galeria da
  "Coisa Antiga Leilões" (`ga=356`) especificamente, conferindo se o leilão 65152 aparece com
  ~319 lotes e campos completos — só depois disso considerar adicionar ao `refresh.yml`.
  ✅ **Teste isolado rodado em produção (v0.69.37)**: `step=galleryscan&offset=14&count=1`
  (índice 14 = "Coisa Antiga Leilões", confirmado estável entre duas chamadas de
  `step=galleries`) achou **323 lotes** dessa casa — bate com os ~319 que o usuário viu
  marcados "Disco de vinil" no catálogo dela — com `persisted:true`. `step=findlot2` no
  leilão 65152 (o caso original) confirma o item saudável. Descoberta por galeria validada
  fim a fim.
  🏁 **v0.69.40 — integrado ao `refresh.yml`**: nova seção `step=galleryscan` (chunked,
  `offset`/`count=3`, mesmo padrão de `chunk`/`enrich`) adicionada ao `refresh.yml`, logo
  APÓS "Varredura em blocos" e ANTES de "Preenchimento de nº de lote" — os lotes descobertos
  por galeria entram na mesma passada de `enrich`/`sales`/`condition` que já roda depois, sem
  lógica nova ali. Passa a rodar junto com o resto do cron. 🔄 **v0.69.41**: `workflow_dispatch`
  completo disparado manualmente em produção pra validar o ciclo real (rodando no momento deste
  commit) — investigação considerada **encerrada** a pedido do usuário; se essa run acusar
  `persisted:false` em `galleryscan`, reabrir.
  🔁 **Reaberta em v0.69.43**: usuário achou item de OUTRA categoria (miniatura de coleção, via
  a casa "Alberto Lopes - Leiloeiro Público") entrando pelo `galleryscan` num leilão sem
  NENHUM item de disco no catálogo da própria casa — a validação de v0.69.40 só tinha testado
  contra uma casa DEDICADA a vinil (Coisa Antiga Leilões), nunca contra uma casa generalista
  ("leiloeiro de tudo"), que é justamente o caso em que a falta de trava de categoria (`tp=`)
  nesse caminho dói. Fix: `listGalleryAuctions` trocou `looksNonVinyl` (lista de bloqueio,
  permissiva) por `isVinylTitle` (exige palavra de vinil no título) — ver linha da tabela de
  versões (v0.69.43) para o detalhe completo do porquê.

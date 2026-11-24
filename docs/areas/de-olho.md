# De olho (`lookout_items`) e perfil do colecionador

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## De olho — "ficar de olho" (`lookout_items`, v0.107.0)

- **O que é:** o usuário marca um lote (ícone de binóculos na linha de ações do `LotCard`, ao lado
  de Vigiar/abrir/excluir) como **compra muito em vista**. Quando o MESMO disco reaparecer em
  outro lote futuro, o card é destacado e a página **De olho** (`/olho`, botão no header da home
  com contador de novos) lista os matches. **Não usa a vigia**: ela vive na conta do LeilõesBR e
  não persiste nada local — por isso tabela própria.
- **Tabela `lookout_items`** (`setup.sql` + `migrations/20261005120000_lookout.sql`): `lot_id`
  (UNIQUE, lote de origem), snapshot (`artist`, `album`, `year`, `title`, `house`, `image`, `url`,
  `day_key`), `max_price` (teto, opcional), `note`, `status` (`active`/`acquired`/`dismissed`).
  **Sem FK para `lots`** — `pruneOutOfWindow` apaga lotes antigos e o marcador sobrevive pelo
  snapshot. CRUD em `lookout.server.ts` (`addLookoutFromLot` idempotente por `lot_id`: reativa sem
  sobrescrever teto/nota) exposto por `lookout.functions.ts` (`toggleLookout`, `updateLookout`,
  `deleteLookout`, `setLookoutLink`, `markLookoutSeen`, `getLookoutOverview`, …).
- **Estado em `app_state`:** `lookout_links` (`lotId → itemId | false`: ✓ confirma / ✕ descarta UM
  lote), `lookout_seen` (chaves `lotId|itemId` já vistas na página → "novo"/contador) e
  `lookout_notified` (dedupe do aviso externo). Listas limitadas às 2000 mais recentes.
- **Casamento** (`lookout-match.ts`, puro/client-safe): reusa o motor da Coleção
  (`ownedCandidate`/`ownedScore` de `wantlist-match.ts`) — artista×artista e álbum×álbum, não
  palavras soltas; apelidos de artista do Analytics (`resolveArtistAlias`). O item faz o papel do
  "disco da coleção". `matchLookoutForLot` ignora o lote de origem, respeita `lookout_links` e
  aceita score ≥ 0,6 (`LOOKOUT_MATCH_MIN`); ≥ 0,8 (`LOOKOUT_CONFIDENT_MIN`) ou confirmado = selo
  cheio e elegível a aviso, abaixo = "?" com ✓/✕. Só itens `active` com artista real e álbum
  viram candidatos (buckets "Lote"/"Coletâneas" e item sem álbum não casam — a UI avisa e a
  página tem lápis para corrigir artista/álbum/ano). `buildLotIdentity` replica a identidade da
  home (artista efetivo + álbum IA + release Discogs).
- **Destaque no card:** prop `lookout` do `LotCard` (`{on, hit, maxPrice}`; fiação em
  `use-dashboard-data.tsx` → `lookoutProps(lot)` espalhado nos cards de `day-tab.tsx` e
  `watched-tab.tsx`; a seção de lances não recebe). Borda **fúcsia**; precedência
  **lance > vigia > de olho**. Selo "De olho · NN%" (+ "abaixo/acima do teto" vs. valor atual).
  O lote marcado também fica fúcsia, com o botão preenchido.
- **Visão Expandida:** disco ativo sem lote por vir usa `LookoutSummaryRow compact` (uma linha, só artista — álbum). **Página `/olho`:** `getLookoutOverview` → `computeLookout` (`lookout-matches.server.ts`, fonte
  única da página, do contador e do aviso): lotes de hoje até +14 dias (retenção de `lots`) que
  ainda não terminaram, com IA/Discogs; por item mostra teto/nota editáveis, matches **por vir**
  (Vigiar via `toggleWatch`, abrir, ✓/✕, "novo") e **aparições anteriores** = vendas arquivadas
  em `lot_sales` (≥ 80%, sem kits) com faixa de preço vendido. **Desde a v0.109.0 soma também o
  Analytics** (`lookout-analytics.ts`, puro): `buildAnalytics` agrega as vendas (IA, correção por
  venda, apelidos, exclusões, kits fora, singular/plural) e cada álbum agregado que casa (≥ 80%)
  com o item contribui com suas vendas; união por `lot_id` (em duplicata vale a linha do
  Analytics), vendas ocultadas no Analytics (`excludedSales`) não contam, o lote de origem e os
  lotes descartados (✕) ficam de fora; mostra Disco/Capa, link e média. Chave-mestra
  `LOOKOUT_HISTORY_FROM_ANALYTICS` em `lookout-matches.server.ts` (`false` = comportamento
  anterior). Limite: títulos ruidosos ("Profana (RCA)") viram álbum separado no Analytics e não
  casam (precisão antes de cobertura) — a correção por venda no Analytics resolve. Abrir a página marca os matches
  como vistos (zera o contador do menu; o selo "novo" daquela visita permanece). O contador do
  menu usa a versão leve (`history: false`, staleTime 15 min).
- **Disco de nome genérico → validação por ANO (v0.111.0):** quando o nome do álbum é o do próprio
  artista (homônimo — `selfTitled`) ou só tem termos genéricos ("Ao Vivo"), o nome não distingue
  (o artista tem vários discos assim), então só o ano distingue (`yearVerdict`,
  `lookout-match.ts`): o lote/venda cita o ano do item → ok; cita só outro(s) ano(s) → rejeita; não
  informa ano (ou o item não tem ano) → **"a validar"** (score limitado a 0,7: nunca confiante, nunca
  avisa por ntfy). Anos considerados: texto do título/álbum/release, `lot_ident.year`
  (`knownYear`) e Discogs. No histórico, as pendentes ficam numa lista própria (✓ confirma =
  `lookout_links[lotId]=itemId`, ✕ descarta = `false`, "Descartar todas" via
  `setLookoutLinksBatch`) e **não entram na contagem nem na média**; para as pendentes o servidor
  ainda olha o descritivo completo (`lot_sales.orig_text`, só dos pendentes, até 300) e confirma
  se ele cita o ano do item (nunca rejeita por aí). No Analytics o ano é conferido venda a venda
  (o álbum agregado junta vários anos). Vale também para lotes futuros ("?" + dica no tooltip).
- **Sem repetição e "Juntar" (v0.117.0):** `addLookoutFromLot` reaproveita o item existente quando o lote
  (de origem de um item/álbum juntado) ou o artista+álbum normalizado já está cadastrado
  (`lookoutIdentityKey`; reativa se estava arquivado). **Origem × arrastar (v0.183.0):** toda linha "por vir" é `draggable` (sem isso o arrasto subia ao cartão e juntava o disco inteiro); a origem do próprio disco cancela o arrasto (`mainOrigin`). **✕ e + em toda linha:** na origem, ✕ = `dismissLookoutLot` (álbum juntado sai de `merged`; origem do disco vira `manual-…`; vínculo `false`) e + = `splitLookoutLot` (juntado vira disco próprio via `unmergeLookoutItem`; origem do disco passa a um disco novo). **Mover lote (v0.153.0):** arrastar uma linha de "Por vir" (não a de origem) sobre outro cartão/linha — ou, desde a v0.183.0, o botão ⇄ "Mover só este lote para outro disco" da linha (seletor com os outros discos ativos, `onMoveLotTo`) — chama `moveLookoutLot` (origem de álbum juntado: sai de `merged` do disco de origem e entra no destino; a origem do próprio disco não move) → `lookout_links[lotId]=destino` + `lot_ident` (`source/model='manual'`, `"Artista - Álbum"`+ano do destino, confiança alta; só se o lote existe em `lots`). **Juntar** (`mergeLookout` →
  `mergeLookoutItems`): o item absorvido vira snapshot em `lookout_items.merged` (jsonb) do destino
  e é apagado; `lookoutCandidates` expande cada álbum juntado em candidato extra com o MESMO id do
  item (casa com qualquer um dos nomes). UI: arrastar o cartão sobre outro ou botão "Juntar"
  (seletor); ✕ no chip "Juntado com" separa (`unmergeLookout`). **Binóculos na home:** `lookout.on` =
  lote de origem (inclui os dos álbuns juntados) OU casamento confiante; desmarcar um lote que só
  casa = "não é este disco" (`lookout_links`). **Por vir não tem teto de hoje+14** (v0.140.4: lê até +365 dias com `readLotsRange(..., beyondWindow)`, para lote da conta além da janela) e **procura também nos vigiados/lances da conta** (`getAccountLots`, v0.140.5; o de `lots` vence) e **inclui o lote de origem**
  (`includeOrigin` → `isOrigin`: score 1, selo "origem", nunca "novo" nem aviso ntfy). **Página:**
  grupos por artista (A→Z, "sem artista" por último), busca por artista (botão/Enter) e combo com
  nº de álbuns por artista. **Adquirido** = `status acquired` no item (leva todos os álbuns
  juntados) + remove a vigia real de todos os lotes dele (`acquireItem` em `olho.tsx`).
- **"Invariant failed" em `/olho` (v0.184.1):** em produção o cliente das server functions do TanStack lança `Invariant failed` (sem detalhe) quando a resposta chega sem `content-type` — 5xx vazio do Caddy, timeout, conexão cortada. É erro de TRANSPORTE: o servidor pode ter gravado a ação. `transient-error.ts` (`isTransientTransportError`, `errorMessage`, `retryTransient`): as mutações idempotentes com patch otimista de `olho.tsx` (`updateMut`, `deleteMut`, `moveLotMut`, `dismissPendingMut`, `resolveMut`) repetem até 2× só nesse erro; se falhar, `rollback` desfaz o otimismo e chama `refresh()` (relê o servidor). Mesclar/separar/criar NÃO repetem (não idempotentes). Se continuar frequente, investigar a causa na borda (health check do Caddy `/api/health` derrubando o upstream sob carga do `computeLookout`, `mem_limit` do `app`).
- **Palavras para agrupar (v0.118.0):** `lookout_items.terms` (jsonb, até 20 frases de 80 caracteres). Em
  `matchLookoutForLot`, `termScore`: lote cujo ARTISTA casa (`ownedArtistLevel`: confirmado → 0,92;
  só citado no título → 0,8) e cujo texto normalizado contém alguma frase inteira do usuário casa com o
  item, sem passar pelo filtro de ano de disco genérico. Vale em lotes por vir, vendas anteriores e
  home (mesmo motor); "Juntar" soma as palavras. UI: campo "Palavras p/ agrupar" no cartão (chips com ✕).
- **Lote de origem em "Por vir" (v0.151.5):** com `includeOrigin`, `matchLookoutForLot` casa a origem ANTES dos
  vínculos (`lookout_links`), então ✕/confirmação antiga não a esconde; ela aparece com o selo "origem".
- **Pergunta "novo ou existente" (v0.118.0):** ao marcar o binóculos de um lote sem item idêntico,
  `similarLookoutItems` (puro) lista TODOS os itens ativos do MESMO artista (v0.151.4; os com dúvida —
  álbum ausente, nomes que se contêm/compartilham palavra, ou mesmo ano — vêm primeiro); se houver,
  `LookoutAskDialog` oferece "Inserir em: …"
  (`attachLookout` → `attachLookoutLot`, vira álbum juntado) ou "Criar novo disco". Idêntico = o servidor
  reaproveita sem perguntar. **Página `/olho`:** linhas-resumo (`LookoutSummaryRow`, arrastar sobre outra
  junta); clicar abre o `LookoutItemCard` completo num `Dialog`.
- **Modos da página e cartão do lote (v0.119.0):** `/olho` tem **Compacto** (`LookoutSummaryRow`, abre o
  `LookoutItemCard` num `Dialog`) e **Expandido** (cartões inline), persistido em `olho-view`. Clicar num
  lote "por vir" abre `LookoutLotDialog`: o `LotCard` da home alimentado pelas mesmas queries
  (`lot_ai`/`lot_ident`/`lot_market`/`lot-condition`), binóculos marcado e teto do item.
- **Sacola por artista (v0.187.0):** botão «Sacola» no cabeçalho do grupo de artista em `/olho` (`setLookoutBagArtist`). Chaves normalizadas (`lookoutArtistKey` do nome JÁ resolvido pelas junções) em `app_state.lookout_bag_artists`. `computeLookout` devolve `bagArtists` e `bag`: todo lote por vir cujo artista casa (`lotInArtistBag`: artista CONFIRMADO por IA/Discogs, ou citado no título com o nome EXATO — sem a tolerância de 1 letra do casamento de álbuns, v0.187.1; qualquer candidato do artista, álbuns juntados incluídos), com ou sem álbum de olho; se também casou com um álbum, a linha leva `inAlbum` e `itemId` do álbum (selo «também em álbum: X», componente `lookout-bag.tsx`). O lote aparece nos dois lugares. A sacola NÃO entra em `newCount`/«novo» nem no aviso externo (o álbum continua avisando). Filtro por dia vale para a sacola; o diálogo do lote funciona igual. Controles por lote (v0.187.3): ✕ tira da sacola (`dismissLookoutBagLot` → `app_state.lookout_bag_dismissed`, lista de `lotId` filtrada em `computeLookout`; o álbum em que o lote também casa não muda), arrastar sobre um álbum / ⇄ seletor = `moveLookoutLot`, + = criar álbum de olho (`createFrom`). Pendência: nota «também na sacola» dentro do álbum (ver `docs/pendencias.md`).
- **Juntar artistas (v0.120.0):** arrastar o título de um grupo de artista sobre outro grava em
  `app_state.lookout_artist_groups` (`chave normalizada → {to, label}`, `setLookoutArtistGroup`); a página
  resolve o nome final com `resolveLookoutArtist` (segue cadeias, guarda contra ciclo) e o grupo leva o nome
  de quem recebeu. É só exibição: `lookout_items.artist` e o casamento não mudam. ✕ no chip desfaz.
- **Identificar por IA (v0.110.0):** botão ✨ sob o lápis no card do item de `/olho` →
  `identifyLookout` → `identifyLookoutItem` (`lookout-ident.server.ts`, isolado): usa
  `identLotsSyncRows(…, withImage=true)` (mesmo prompt/parser da identificação dos lotes, **texto
  do lote de origem + foto**), provedor padrão do usuário com failover; se a chamada com imagem
  falhar (casa bloqueando a foto), repete só com o texto. Só preenche/melhora artista/álbum/ano
  (nunca apaga com resultado vazio); depois os matches são recalculados. Gasta créditos de IA —
  só sob demanda. O toast mostra o resultado, a confiança e se houve troca de provedor.
- **Adicionar por lista/texto (v0.122.0):** botão **Adicionar** em `/olho` → `LookoutBulkDialog`
  (cola, digita ou envia `.txt`/`.csv`; uma obra por linha; numeração e ano opcionais —
  `parseLookoutBulk`, `lookout-bulk.ts`). A interface chama `addLookoutByText` linha a linha
  (progresso, falha isolada por linha, máx. 200): `addLookoutFromText` (`lookout-bulk.server.ts`)
  pede à IA (SÓ TEXTO, provedor padrão com failover) artista + álbum canônicos (+ ano); sem
  artista E álbum → "não identificado" (não cria). Cria via `addLookoutManual` — `lot_id`
  sintético `manual-<uuid>`, sem lote de origem, sem repetição (mesmo artista+álbum reaproveita/
  reativa). Depois busca a capa no Discogs (`searchCoverOptions`, prefere o mesmo ano) e grava
  como na Coleção (`importCollectionCover`: comprime em webp na pasta da coleção) — best-effort.
  **Edição (v0.182.0):** a linha é pré-marcada como reedição moderna se citar "reedição/180g/remasterizado…"
  (`detectModernReissue`) e o master do Discogs é consultado na hora (`lookupMaster`; falha → NULL e o
  passo `masters` do cron tenta de novo). **Ano (v0.181.1):** `parseLookoutBulk` lê o ano entre parênteses OU solto na linha (`extractLooseYear`: em qualquer ponto da linha; "Prince - 1999" e "1984 - Van Halen" são o álbum, não o ano); o ano digitado vence o da IA. **Homônimos:** a deduplicação (`addLookoutFromLot`/`addLookoutManual`, `similarLookoutItems`, importação em massa da Coleção) usa `sameAlbumYear`/`isSelfTitledAlbum` (`vinyl-parse.ts`): álbum = nome do artista com anos conhecidos e diferentes é OUTRO disco (Caetano Veloso 1968 × 1986); nos demais, ano diferente = reedição, mesmo disco; ano desconhecido de um lado não separa. O ✨ Identificar usa artista+álbum quando o item não tem título de lote.
- **"Já tenho" — tirar o que já está na Coleção (v0.123.0):** botão **Já tenho (N)** em `/olho`
  (aparece só com N>0) → `LookoutOwnedDialog`. `lookoutOwnedInCollection` (`lookout-match.ts`,
  puro) reaproveita o motor do casamento de lotes: cada disco da Coleção vira uma identidade de
  lote (`buildLotIdentity`) pontuada por `ownedScore` contra os candidatos dos itens ativos
  (inclui álbuns juntados e apelidos de artista); melhor disco por item, score ≥ 0,6; ≥ 0,8 vem
  pré-marcado, o incerto fica desmarcado. Confirmar reusa `acquireItem` (status `acquired` →
  "Arquivados" + remove as vigias dos lotes) — reversível, nada é apagado.
- **Aviso externo (ntfy.sh):** `step=lookoutnotify` do cron (`refresh.yml`, depois de
  aiident/market, antes da faxina, via `call_soft` — falha não reprova a run) →
  `notifyLookoutMatches`: para cada match confiante ainda não avisado (`pickNotifiable`, dedupe
  `lotId|itemId` gravado SÓ após o envio) faz um POST JSON (UTF-8) em `NTFY_SERVER`
  (padrão `https://ntfy.sh`) no tópico `NTFY_TOPIC`; prioridade alta quando o valor atual está
  dentro do teto; `Click` = `PUBLIC_BASE_URL/olho`. Máx. 8 pushes por rodada, o resto vira um
  resumo. **Sem `NTFY_TOPIC` é no-op.** Ao marcar o primeiro disco, lotes já casando disparam
  (limitado pelo teto acima).
- **Aviso por e-mail (v0.135.0):** o mesmo `notifyLookoutMatches` também envia **1 e-mail por
  rodada** com todos os matches novos (`buildLookoutEmail`, dentro do teto primeiro) pelo Gmail
  (`email.server.ts`, `GMAIL_USER`/`GMAIL_APP_PASSWORD`, destino `EMAIL_TO` ou `LEILOESBR_EMAIL`).
  Canais independentes e opcionais; um match vira "avisado" se QUALQUER canal entregou. Sem
  nenhum configurado é no-op.
- **Limites conhecidos:** o histórico só vê o que `lot_sales` guarda (e artista/título gravados);
  `lots.price` é o valor da listagem (pode estar defasado); o estado "vigiando" da página vem da vigia
  real (`useWatchedQuery`: mesmo cache/acumulador da home e da Análise, casando por `idPeca`;
  vigiar/desvigiar atualiza o acumulador na hora, sem invalidar a query); scraping/ntfy não são testáveis no ambiente de desenvolvimento (validado com banco
  local + servidor HTTP falso no lugar do ntfy).

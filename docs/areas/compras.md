# Compras, envio por pregão, loja e avaliação das casas

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Compras do usuário (`purchases`, v0.61.1–2)

- **Histórico de "Minhas compras" (vinil), PERSISTIDO** — diferente de Vigia/Lances (sempre lidos
  ao vivo, sem tabela). Página `_authenticated/compras.tsx` (menu **Compras** no header do
  `index.tsx`), mais recente primeiro por padrão, com 3 visões por botão toggle (`aria-pressed`,
  mesmo idioma de "Vigiados/Lances do dia" em `index.tsx`): **mais recentes** (lista simples),
  **por dia** (agrupado por `won_date`) e **por casa** (`groupWatchedByHouse`, reaproveitado de
  `grouping.ts` sem alteração — `Purchase` já tem `house`/`lote`, `houseUrl` recebe a URL do lote
  por conveniência de tipo, mas não é usada como "site da casa" na UI).
- **Agrupamento aninhado, sem misturar dia/casa (v0.61.2):** cada visão traz a outra dimensão
  como sub-agrupamento — "por dia" separa as compras de cada dia por sub-cabeçalho de casa; "por
  casa" separa as de cada casa por sub-seção de dia (`groupPurchasesByHouse`/`groupByDay`
  reaproveitados nos dois sentidos). "Dia" é a unidade **colapsável** recorrente nas duas visões
  (`DaySection`, `ChevronDown`/`ChevronUp`) — top-level em "por dia", aninhada dentro de cada casa
  em "por casa" — sempre com o dia mais recente ABERTO por padrão e os demais FECHADOS
  (`useState(defaultOpen)` por instância de `DaySection`, chave estável = string do dia; sem
  `useEffect` de resync — o toggle manual do usuário sobrevive a um refetch enquanto o dia
  continuar existindo). "Casa" nunca é colapsável, só um cabeçalho de agrupamento.
- **Tabela própria `purchases`** (`supabase/setup.sql` + `supabase/migrations/…_purchases.sql`):
  `lot_id` (UNIQUE, `"${idLeilao}-${idPeca}"`), `id_peca`, `id_leilao`, `base`, `lote`, `title`,
  `won_price`, `won_date`, `url`, `image`, `house`, `uf`, `domain`. **Independente de
  `collection_items`** — mesma descoberta de leilões vencidos (`wonAuctionIdsFromBids`, `l=4`),
  mas gravação separada: um lote arrematado pode aparecer nas duas tabelas (Compras é o
  histórico bruto; Coleção é o catálogo editável agrupado por artista/álbum).
- **Sync incremental (`purchases.server.ts`):** `syncPurchasesIncremental()` — `listMyBidsFromSite()`
  (`l=4`) → `wonAuctionIdsFromBids` → `listVinylPurchasesForAuctions(auctionIds)`
  (`leiloesbr-purchases.server.ts`, `l=6&id=<idLeilao>`) → `upsert` por `lot_id` (idempotente,
  não duplica ao reprocessar um leilão já visto). **Sem fallback de backfill automático** (a
  tabela é nova — o histórico inicial entra pela **varredura completa manual**,
  `syncPurchasesFull()`, botão "Varredura completa" na página, que usa `listVinylPurchases()`
  sem restrição de leilão, igual ao equivalente da Coleção).
- **Cron:** novo `step=purchases` (`cron.server.ts`) chama `syncPurchasesIncremental()` — 1
  chamada por rodada do `refresh.yml` (barato, sem paginação cega), rodando junto com os demais
  steps 3x/dia.
- **Server functions (`purchases.functions.ts`):** `getPurchases` (leitura, best-effort `[]` em
  erro), `scanPurchases` (botão "Atualizar" → incremental), `scanPurchasesFull` (botão
  "Varredura completa" → escape hatch caro).
- **Card (`PurchaseCard`, `components/vinyl/purchase-card.tsx`):** enxuto (sem edição/tags/grading
  próprios, ao contrário de `CollectionCard`) — imagem, título, casa/UF, valor pago, data e nº do
  lote, link "Ver no leiloeiro". Ganhou (v0.70.0) o selo de relação com a Coleção e o botão
  "Enviar para a coleção" — ver abaixo.
- **Relação com a Coleção + "Enviar para a coleção" (v0.70.0):** a Coleção deixou de ter
  varredura própria (ver seção "Coleção do usuário" acima) — `/compras` passa a ser o ponto de
  entrada para povoá-la a partir de uma compra:
  - **Selo de relação** (ícone `Disc3` no canto do card, `compras.tsx`): reaproveita a MESMA
    infraestrutura da home (`collection_links`/`collection_feedback` em `app_state.server.ts`,
    `resolveOwned`/`OwnedPanel` de `wantlist-match.ts`/`owned-panel.tsx`), casando pelo `lot_id`
    EXATO da compra (`ownedByLotId`, análogo ao `ownedByLotId` de `index.tsx`) — sem o casamento
    fuzzy por tokens (`ownedMatchForLot`), que a home usa para lotes "candidatos" ainda não
    comprados; aqui a compra já é a peça exata, então só o `lot_id` interessa. Roxo = já
    relacionado (enviado por este fluxo, ou vinculado manualmente a um disco pré-existente);
    cinza = sem relação. A sugestão por aprendizado (`resolveOwned`) só vale se o artista do disco sugerido aparece no lote (`candidateOf` + `ownedArtistLevel`), mesmo que a assinatura do feedback case. Clicar abre o `OwnedPanel` (mesmo componente da home) para confirmar,
    vincular a outro disco da Coleção, marcar "não tenho" ou reativar — a decisão grava em
    `collection_links`/`collection_feedback` via `applyCollectionDecision`, **compartilhado**
    com a home (útil quando o disco já estava na Coleção antes deste recurso existir, cadastrado
    manualmente sem `lot_id`).
  - **Botão "Enviar para a coleção"** (só aparece sem relação confirmada): abre
    `SendToCollectionDialog` (`compras.tsx`) pré-preenchido com um palpite de artista
    (`extractArtist`/`titleCase`, client-safe, sobre o título da compra) — álbum, ano, grading e
    tags ficam em branco para completar antes de confirmar. Ao enviar, chama `addCollectionItem`
    com `lotId` = o `lot_id` da compra, herdando valor pago/data/casa/UF/imagem dela; grava
    `source: "auction"` e recusa reenviar a mesma peça duas vezes.
  - **`GradeSelect`** (escala de 10 graus M…F/P) extraído de `colecao.tsx` para
    `components/vinyl/grade-select.tsx` — reusado por `SendToCollectionDialog` e pelo diálogo de
    edição da Coleção.
  - **Botão "Identificar pela IA" no diálogo de envio (v0.71.0):** antes de confirmar, chama
    `identifyPurchaseDraft` (`collection.functions.ts` → nova `identifyDraftFromTitle` em
    `collection.server.ts`) — mesmo prompt/modelo do reprocessar por card da Coleção
    (`identCollectionSync`, `ai-collection.server.ts`, SÓ TEXTO, nunca a capa), rodando com um `id`
    avulso ("draft") já que o disco ainda não existe em `collection_items`; **não persiste
    nada**. Preenche artista/álbum/ano/descritivo/tags no formulário (tags são ACRESCENTADAS às
    já digitadas, via `mergeTagsText`, sem duplicar) para o usuário revisar/ajustar antes de
    "Enviar" — mesmo aviso de failover de provedor (`formatFailoverTrail`) das outras telas de IA.
    Usa sempre o provedor padrão do `app_state` (sem seletor próprio no diálogo).

## Pagamento e envio por pregão (v0.130.0)

- **Visão "Pregões" (padrão de `/compras`)**: `PregaoView` (`components/vinyl/pregao-list.tsx`)
  agrupa as compras por `id_leilao` (`groupByPregao`, `purchase-shipping.ts`, puro/testado em
  `tests/purchase-shipping.test.ts`), mais recente primeiro. As visões antigas (recentes / por dia
  / por casa) seguem disponíveis; a preferência agora usa a chave `compras-view`.
- **Status por pregão** (não por disco): `aberto` (padrão, "novo") → `frete` (em aberto, aguardando retorno do frete; v0.131.0, também sem data de pagamento) → `pago` (a enviar) → `guarda` (pago, parado
  no vendedor) → `transito` → `recebido`. Persistido em `purchase_auctions` (linha só existe depois que
  o usuário mexe; ausência = aberto), **separada de `purchases`** para a sync nunca sobrescrever.
  `paid_at` é preenchido sozinho ao sair de "aberto" (data de Brasília), `received_at` ao virar
  "recebido"; voltar a "aberto" limpa pagamento e remessa. Observação livre (500 chars) por pregão.
- **Remessa** (`shipments`: casa, frete, rastreio): só pregões "na guarda" da MESMA casa. Marcar os
  checkboxes → barra "Montar remessa" → diálogo de preview (tabela, conteúdo da caixa, frete,
  rastreio opcional, economia estimada = envios evitados × `REFERENCE_FREIGHT` R$ 38) → "Aprovar" leva
  todos a "em trânsito" (`createShipment` revalida status e casa no servidor). Rastreio pode ser
  editado depois no pregão; "Marcar remessa como recebida" (`markShipmentReceived`) recebe todos de
  uma vez. Sair de "em trânsito" desvincula e apaga a remessa órfã.
- **Avisos/totais**: pregão na guarda há ≥ `GUARD_ALERT_DAYS` (15) dias mostra aviso de prazo. Os cards
  de totais (a pagar, a enviar, guarda, trânsito, discos recebidos) ficam **ocultos por padrão**
  (botão "Mostrar totais", lembrado em `compras-totais`). Filtros por status com contagem.
- Server functions em `purchases.functions.ts` (`getPurchaseShipping`, `setPregaoStatus`,
  `setPregaoNote`, `approveShipment`, `editShipment`, `receiveShipment`); lógica em
  `purchase-shipping.server.ts`. Não testável contra o site daqui (só funções puras).
- **Recebidos ocultos (v0.131.0):** o chip "Ativos" (padrão; chave interna `todos`) lista tudo menos `recebido`; os recebidos aparecem só no filtro "Recebido". "A pagar" nos totais soma novo + aguardando frete. Atenção: o CHECK de `purchase_auctions.status` é recriado por `ALTER TABLE` no `setup.sql` (o `CREATE TABLE IF NOT EXISTS` não altera tabela existente).
- **Guarda agrupada por casa e totais com taxa (v0.131.0):** nas listas "Ativos" e "Na guarda", os pregões na guarda saem da ordem por data e aparecem em seções por casa (`groupByHouse`), com resumo e botão "Selecionar todos da casa" (atalho para montar a remessa); os demais seguem por data. Os totais ganham a tabela "Por casa" (`totalsByHouse`) sobre a lista atual: arrematado + taxa do leiloeiro (`AUCTIONEER_FEE_RATE` = 5%, somada ao valor arrematado, que não a inclui) = total, mais a linha "Total geral".
- **Barra de remessa x rodapé (v0.131.1):** a barra fixa de seleção fica `sm:bottom-[2.1rem]` (altura do `Footer`, também fixo, z-40); no celular o rodapé é oculto, então a barra fica em `bottom-0`. Se a altura do `Footer` mudar, ajustar esse offset.
- **Gasto por período (v0.132.0):** `SpendingHistory` (totais de `/compras`, `spendingByPeriod`) soma o arrematado de TODOS os pregões (qualquer status, inclusive recebidos) por mês ou ano da data do pregão, com a taxa do leiloeiro (5%) e a linha "Histórico geral"; independe do filtro da lista. Escolha mês/ano lembrada em `compras-gasto-periodo`.

- **Agrupar pregões por arrastar (v0.176.0):** pregões "Pago · a enviar" ou "Em trânsito" da MESMA casa e do mesmo status podem seguir juntos: arraste a alça (⋮⋮) de um card sobre outro (HTML5 drag and drop; não funciona em toque — por isso o card aberto tem o select "Juntar com…") → `joinPregoes` (`joinShipment`, `purchase-shipping.server.ts`) valida casa/status no servidor e põe os dois no mesmo `shipments` (cria uma remessa vazia se o destino não tinha; frete/rastreio editáveis depois). Reaproveita a remessa do fluxo da guarda: `purchase_auctions.shipment_id` agora é mantido também em "pago" (`SHIPMENT_STATUSES`). Pregões da mesma remessa e status aparecem num bloco "Enviados juntos" (`bundleShipments`, remessa de um pregão só não vira bloco); "Separar da remessa" (`leavePregaoShipment`) desfaz. Mudar o status de um membro entre a enviar/trânsito/recebido muda todos os da remessa; para qualquer outro status só aquele pregão sai dela. Sem migração de schema.

## Loja por pregão e "casa não aceita guarda" (v0.193.0)

- **Problema:** o LeilõesBR mostra como casa o SITE dono do leilão. Lojas com site próprio (Escafandro, Acervo do Garimpeiro, Miss leilões, Abreu) já saem certas; já um leiloeiro que hospeda lojas sem site (Alberto Lopes → Discos da Palmeira, JM Antiguidades; Bruce Angeiras → "Leilão Meier") aparece como uma casa só e juntava lojas diferentes na guarda/frete. Claudio Firmino nos leilões dele (Família Mello etc.) é a própria loja. Pistas observadas nas páginas (para uma detecção automática futura, ver `docs/pendencias.md`): bloco LOCAL (e-mail/telefone/endereço da loja, diferente do rodapé do site), título do leilão e, no modelo V8.9, `NOMESITE`/`IDSITE` no `loadData`.
- **Campo "Loja" por pregão:** `purchase_auctions.store` (vazio = a própria casa), editável no card aberto de Compras (`setPregaoStore` → `setAuctionStore`; sugestões das lojas já usadas). `effectiveHouse(store, house)` (`purchase-shipping.ts`) é a casa EFETIVA: `groupByPregao` põe a loja em `PregaoGroup.house` (e o nome do LeilõesBR em `siteHouse`, mostrado como "via …"), então remessa/frete único (`canBundle`, `canJoinShipment`, validação no servidor em `createShipment`/`joinShipment`), guarda por casa, totais por casa e a mala de guarda usam a loja. `pregaoRefs(purchases, stores)` faz o mesmo para semáforo e mala (`house-rating.server.ts`). Mudar a loja de um pregão numa remessa em andamento é recusado (separe antes); pregão já "recebido" pode ser ajustado e continua na remessa (v0.194.0), para organizar o passado.
- **Loja em qualquer tela (v0.194.0):** `RatingsPayload.stores` (id do pregão → loja, lido de `purchase_auctions.store`) vai junto com o semáforo. `lotHouse(stores, idLeilao, casa)` (`house-rating.ts`) devolve a casa efetiva; `HouseLight`/`HouseDot` aceitam `idLeilao` e então mostram semáforo, mala e selo "sem guarda" da LOJA. O componente `AuctionStore` (`auction-store.tsx`, ícone de loja + popover com sugestões; usa o mesmo `setPregaoStore`) fica no cabeçalho do catálogo em Dia (`AuctionSection` e cabeçalho de casa com 1 pregão), Vigiados e Lances; informar a loja num pregão sem compra cria só a linha de estado em `purchase_auctions` (status "aberto", sem efeito em Compras). `HouseNameWithStore` troca o nome na barra de origem do `LotCard` ("Loja via Casa"). Cabeçalho de casa com VÁRIOS pregões mantém o semáforo da casa do LeilõesBR; o da loja fica no sub-cabeçalho "Catálogo N". Ainda sem loja informada o lote usa a casa do LeilõesBR (a detecção automática segue em `docs/pendencias.md`).
- **"Casa não aceita guarda":** caixa de seleção em "Avaliar casa" (`saveHouseNoGuard` → `setHouseNoGuard`, `app_state.house_no_guard` = lista de `houseKey`, escrita atômica). Vale para a casa inteira (não por pregão), salva na hora. `RatingsPayload.noGuard` alimenta o selo vermelho "sem guarda" (`NoGuardBadge`) ao lado do semáforo em `HouseLight`/`HouseDot` (todo lugar onde o semáforo aparece), o alerta vermelho dentro do popover e uma faixa no pregão em Compras ("pague e envie logo"; na guarda: "confirme o envio").

## Reconhecimento automático da loja pelo contato (v0.197.0)

- **Ideia:** o Giba informa a loja de um pregão uma vez; o app guarda o contato daquela página e, nos próximos pregões do mesmo leiloeiro, reconhece a loja. Regras puras em `auction-contact.ts` (`parseAuctionPage`, `contactKeys`, `matchStore`), I/O em `auction-contact.server.ts`.
- **Leitura da página** (`leilao.asp?Num=<id>` no domínio do pregão, `publicFetch`): modelo V8.9 (JSON `loadData` com `LOCAL`, `EXPOSICAO`, `TEL_ZAP`, `NOMESITE`, `IDSITE`; JSON mal-formado, lido por regex após decodificar entidades) e V7.1 (HTML com blocos `cntblck`: "Local", "Exposição", "Informações importantes"). Formato desconhecido ou 403 = falha registrada (`auction_contacts.ok=false`, tenta de novo depois de 12 h) e NUNCA impede salvar a loja.
- **Chaves:** `email:`, `tel:` (DDD + número), `cep:`, `end:` (rua + número). **Forte** = dentro do bloco "Local". **Fraca** = telefone/e-mail fora do "Local" (Exposição, avisos, `TEL_ZAP`). Contatos do cabeçalho (`telefone-topo`/`mail-topo`/`mailto:`) e rodapé são do leiloeiro e saem sempre.
- **Decisão** (`matchStore`): só pregões cuja loja foi informada à mão ("manual") ou aceita ("confirmado") ENSINAM; vínculo "auto" não ensina (erro não se propaga). Forte que bate com UMA só loja e sem pregão sem loja usando o mesmo contato → `auto` (só se o pregão não tem loja nem está em remessa em andamento). Fraca → sugestão (`auction_contacts.suggest_store/suggest_via`), nunca liga. Contato repetido em pregão sem loja (é do leiloeiro) ou em lojas diferentes → nada. "Não é" grava o par `loja|chave` em `app_state.store_contact_blocked`.
- **Cron:** passo `storelink` (`linkNewAuctions`, em `refresh.yml`, best-effort): (a) aprende os pregões que já têm loja manual e nenhum contato lido; (b) lê pregões dos últimos 3 dias dos domínios com loja aprendida. `purchase_auctions.store_source` = `manual` | `confirmado` | `auto` | `''`.
- **Tela** (`AuctionStore`): selo "automático" + "Desfazer vínculo automático" no popover (desfazer também bloqueia aquele contato para a loja), alerta âmbar "Parece ser da loja X (contato) — Confirmar / Não é", botão "Ler os contatos desta página" (diagnóstico). `RatingsPayload.autoStores`/`suggestions` alimentam isso.
- **Casos validados nos testes** (`tests/auction-contact.test.ts`, páginas reais em `tests/fixtures/`): JM Antiguidades via Alberto Lopes (V7.1: contato forte no Local, contato do leiloeiro descartado), Escafandro e Acervo do Garimpeiro (V8.9: loja = site, sem contato de loja / só CEP e WhatsApp), Discorama do Alberto (Local sem contato; WhatsApp só fraco), regras de `matchStore` com Família Sardinha via Claudio Firmino e Leilão Meier via Bruce Angeiras (contatos fictícios). NÃO validado ainda: o servidor abrir `leilao.asp` em produção e o formato do Local de Família Sardinha/Meier (sem HTML em mãos) — o botão "Ler os contatos desta página" mostra o resultado real.

## Avaliação das casas (v0.134.0, por pregão desde v0.134.1)

- **Avaliação por pregão (não por lote):** a nota é da casa, então vale uma por pregão. Cada
  `PregaoCard` (visão Pregões de `/compras`, `pregao-list.tsx`) tem o botão "Avaliar casa" →
  `PregaoRatingDialog` (semáforo obrigatório: verde/amarelo/laranja/vermelho; tags e anotação
  opcionais). Gravado em `app_state.house_ratings` = `{ [id_leilao]: { level, tags, note,
updatedAt } }` (`house-rating.server.ts`; server fns `getHouseRatings`/`savePregaoRating` em
  `house-rating.functions.ts`). Tags só da lista fixa (`POSITIVE_TAGS`/`NEGATIVE_TAGS`).
  ⚠️ Na v0.134.0 a chave era o id da COMPRA; essas entradas não casam mais com nenhum pregão e são
  ignoradas (não há migração).
- **Semáforo da casa = agregação** (`pregaoRefs` → `summarizeHouses`/`levelFromScores`, módulo
  puro `house-rating.ts`): score verde 3 … vermelho 0, média ponderada pela data do pregão (mais
  recente peso 1, cada anterior ×0,8); ≥2,5 verde, ≥1,5 amarelo, ≥0,5 laranja, senão vermelho.
  Chave da casa = `houseKey` (minúsculas, sem acento). Sem avaliação: bolinha tracejada.
- **`HouseLight`** (`components/vinyl/house-light.tsx`) mostra o semáforo + popover (hover/toque)
  com tags mais marcadas e anotações recentes. Aplicado nos cabeçalhos de casa de Compras, Dia,
  Vigiados e Lances, barra de origem do `LotCard` (desktop/mobile), De olho (histórico de vendas),
  Pregões e Ao vivo; em `live-auctions.tsx` (card dentro de `<a>`) usa `HouseDot`, bolinha sem
  popover. Query compartilhada `useHouseRatingsQuery` (`queryKeys.houseRatings`).
- **Mala na guarda:** `RatingsPayload.guarded` (`guardedHouses`, chave `houseKey` → nº de pregões
  com status "guarda") alimenta um ícone de mala ao lado do semáforo em `HouseLight`/`HouseDot`
  (todo lugar onde o semáforo aparece); mudar status em Compras invalida `houseRatings`.
- **Pendente:** ranking das casas e o cabeçalho do detalhe mobile do lote.

- **Valor atual ao vivo (v0.139.1):** `computeLookout` (`applyLivePrices`) sobrescreve `price`/`priceNum` de cada lote por vir com `VALOR_VALUE` do `peca.asp` (`fetchLotDetails`, até 200 lotes por chamada, ordem dia/hora, cache em memória de 3 min — v0.155.0: 3 min para pregão de hoje e 10 min para os dias seguintes); falha = mantém o valor da varredura (`lots.price`, cron 3×/dia, defasado). Vale também para o aviso externo (`lookoutnotify`: "atual" e comparação com o teto). **v0.155.0:** só a versão completa (`history: true`) pede o valor ao vivo; o contador do menu e a 1ª etapa de `/olho` usam a versão leve (`live: false`) — ver `docs/areas/ui.md`, "Desempenho das telas (v0.155.0)", itens 1 e 3.

- **Borda por lance (v0.140.0):** em `/olho`, `useBidsQuery` (mesmo cache da home) vira `bidById` (id do lote → `status`/`myBid`) passado ao `LookoutItemCard`; linha "Por vir" com lance vencendo (`bidIsWinning`) = borda verde, superado (`bidIsCovered`) = vermelha + selo com o valor do meu lance; vence a borda fúcsia de "novo". Só o cartão do disco (não a linha-resumo).

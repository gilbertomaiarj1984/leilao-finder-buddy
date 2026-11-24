# UI — Interface mobile e PWA

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Interface mobile (v0.108.0)

> Protótipo aprovado (artefato "Garimpo Mobile Protótipo"). **Regra de ouro: o desktop não muda.**
> A árvore mobile só existe abaixo de `sm` (640px) e é escolhida por `useIsMobile()`
> (`src/lib/use-is-mobile.ts`, `matchMedia("(max-width: 639px)")` via `useSyncExternalStore`; no
> servidor/hidratação vale `false` = desktop, a árvore mobile entra após a montagem). Todo código
> novo fica em `src/components/vinyl/mobile/`; as páginas só ganham um `if (mobile)` na borda.

- **Barra inferior** (`mobile-bottom-nav.tsx`, montada em `_authenticated/route.tsx` só no
  mobile): Dias, Vigiados (contador), Lances (contador), Menu. Na home troca de aba direto — a
  home se registra em `mobile-nav-store.ts` (`setHomeNav`, `useMobileNavState`: aba atual, contadores
  e `setTab`); nas outras telas grava a aba desejada em `ui-state:home-nav` (mesmo formato do
  `usePersistedState` da home, `nextHomeNav` em `mobile-nav-utils.ts`) e navega para `/`.
  "Menu" fica destacado nas telas `/ao-vivo`, `/analise`, `/olho`, `/colecao`, `/compras`, `/vinil-analytics`
  (`isMenuRoute`). O "Voltar" dessas telas some no mobile (`max-sm:hidden`).
- **Menu** (folha `bottom-sheet.tsx`, Radix Dialog): e-mail + Sair, 6 atalhos (selo fúcsia em De
  olho) e um alvo `setMenuExtraHost` onde a home injeta por **portal** os controles que viviam no
  rodapé global (modo/provedor de IA, modelo Gemini, "Atualizar tudo", "Atualizar relações",
  "Atualizado em…"). Versão do app aparece aqui. O `Footer` fica `max-sm:hidden`; o layout reserva
  `max-sm:pb-24`; o `Toaster` usa `mobileOffset` para não cobrir a barra.
- **Cabeçalho da home** (`mobile-dashboard-header.tsx`, no lugar de `DashboardHeader`): marca +
  atualizar tudo rolando com a página; linha **sticky** com a faixa de dias em cartões (dia da
  semana, número, nº de lotes; âmbar passado / azul futuro / hoje com borda; seleção centraliza;
  dias de páginas ainda não visitadas mostram "·" até abrir — usa `visitedPages` exposto por
  `useDashboardData`), lupa (busca confirmada no Enter, mesma `search` da home) e "⋯" com a barra
  de controles do dia (portal `setDayBarHost` do `DayTab`, agora dentro da folha). Chips "Todos os
  lotes / Vigiados do dia / Lances do dia" (mesmos `watchedViewDay`/`bidsViewDay`) e o alvo do
  "Incluir finalizados" ficam abaixo. Em Vigiados/Lances a linha mostra o título + contador. Botão
  "Voltar para hoje" flutuante. `MobileTopToggle` não é renderizado no mobile da home.
  `tabsBarRef` mede só a faixa sticky (as barras sticky internas colam logo abaixo).
- **Cartão de lote**: `LotCard` virou um wrapper (`lot-card.tsx`) — mobile → `LotCardMobile`,
  senão `LotCardDesktop` (o antigo componente, corpo intacto). Mesmas props, então home, Análise,
  De olho, Vigiados por artista (`origin`), `dateBar` etc. ganham o cartão mobile sem mudar. Estado
  visual (precedência lance > vigia > de olho, guarda "leilão que não começou não vende",
  valor atual = meu lance quando vencendo) em `lot-card-state.ts` (puro, com teste).
  - **Compacto** (`lot-card-mobile.tsx`): miniatura + nº do lote + selo da Coleção (roxo / "?" /
    cinza), álbum da IA + título, Atual/Próximo/Meu lance, selos (situação do lance, De olho %,
    possível lixo, Disco/Capa, hora·UF), nota da IA, tarja diagonal "Vendido" e olho para
    vigiar sem abrir (alvo de 40px). Tocar abre o cartão aberto.
  - **Aberto** (`lot-detail-sheet.tsx`, tela cheia): hero com imagem/lote/nota/selo; abas
    **Resumo** (álbum + título completo, valores, data/hora/UF, demanda, conservação via
    `ConditionBadges`, tags editáveis com controles sempre visíveis, sinais De olho ✓/✕ e
    "possível lixo → não é lixo", origem + mover para outro artista), **Nota IA**
    (`ScoreDetails` exportado de `ai-score.tsx`: raridade, oportunidade, motivo
    e bloco Mercado Discogs), **Faixas** (`TracklistContent`, extraído de `tracklist-hover.tsx`
    — o popover do desktop usa o mesmo componente) e **Coleção** (estado da relação + botão que
    fecha a folha e abre o `OwnedPanel` existente; ficar de olho). Rodapé fixo: Vigiar, De olho,
    abrir no leiloeiro, Excluir (confirma e abre o `ExcludeLotDialog` existente).
- **Telas secundárias** (Ao vivo, Análise, De olho, Coleção, Compras, Analytics): v1 mantém os
  cabeçalhos/conteúdo atuais (já eram responsivos) + barra inferior + cartão de lote mobile onde há
  `LotCard`. O redesenho completo do protótipo (linha sticky única, folhas de filtros/ações, FAB)
  está em `docs/pendencias.md`.

- **Busca da Wantlist lembrada (v0.115.1):** o campo de busca do diálogo da Sondagem usa `usePersistedState("wantlist-search")`.

## PWA instalável (v0.137.0)

- **Arquivos** (todos em `public/`, servidos pelo Nitro sem tocar no Caddy): `manifest.webmanifest`
  (`display: standalone`, tema escuro `#181513`, atalhos para `/olho`, `/ao-vivo`, `/compras`,
  `/colecao`), `icons/` (192/512, maskable 512 e `apple-touch-icon`, gerados por
  `tools/gen-pwa-icons.py` — disco de vinil âmbar), `offline.html` e `sw.js`. As `<meta>`/`<link>`
  (manifest, apple-touch-icon, theme-color, `apple-mobile-web-app-*`) ficam em `__root.tsx`.
- **Service worker** (`sw.js`): estratégia deliberadamente conservadora — **nunca cacheia dados**
  (HTML do SSR autenticado, server functions, `/api/*`: cron, auth, pregão ao vivo). Só:
  `/assets/*` (hash no nome) cache-first; `/icons/*` e o manifest stale-while-revalidate;
  `/collection/*` (fotos) stale-while-revalidate limitado a 400; navegação sem rede cai em
  `/offline.html`. Para invalidar tudo, mude `VERSION` no topo do arquivo.
- **Registro e convite** (`components/PwaSetup.tsx`, montado no `__root.tsx`): registra o SW **só em
  produção** (`import.meta.env.PROD`); oferece instalar uma vez por navegador (`localStorage`
  `pwa-install-hint`) — Android/Chrome via `beforeinstallprompt` (toast com botão "Instalar"),
  iOS com a dica "Compartilhar → Adicionar à Tela de Início". Não aparece já instalado (standalone).
- **Não validado num aparelho real** (sem rede/dispositivo aqui): conferir no celular o convite, o
  ícone, o modo standalone e o login Google dentro do app instalado.

### Web Push e selo no ícone (v0.138.0)

- **Opcional** (no-op sem `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no `.env` do servidor; gerar o par
  uma vez com `bunx web-push generate-vapid-keys` e nunca trocar). Tabela `push_subscriptions`
  (`endpoint` PK, uma linha por aparelho; mortas 404/410 são apagadas no envio).
- **Servidor**: `push.server.ts` (`sendPushToAll`, `pushReady` = configurado E ≥1 aparelho) e
  `push.functions.ts` (`getPushStatus`, `subscribePush`, `unsubscribePush`, `sendTestPush`).
  Canais de aviso do cron: `lookoutnotify` (De olho) agora envia ntfy e/ou Web Push (um por lote;
  conta como avisado se ALGUM canal entregou) + e-mail; novo `step=bidnotify`
  (`bid-notify.server.ts`) lê Meus lances e avisa os que viraram "Coberto" desde a rodada anterior
  (snapshot `app_state.bid_status_snapshot`; a 1ª rodada só semeia). A detecção da transição é a
  função pura `bid-transitions.ts`, compartilhada com o toast do app aberto (`bid-alerts.ts`).
  Como o cron roda 4×/dia, o aviso de lance superado tem atraso de horas (ver pendências).
- **Cliente**: sino `PushToggle` (`components/vinyl/push-toggle.tsx`) ao lado de "Sair" no desktop e
  no Menu do celular — pede permissão, assina (`pushManager.subscribe`), grava no servidor e dispara
  um push de teste. Só aparece em produção, com suporte do navegador e push configurado.
  No `sw.js`, `push` mostra a notificação e `notificationclick` foca/abre o app na URL do payload.
- **Selo do ícone**: `AppBadgeSync` (layout logado) grava `lances superados + novos do De olho`
  (`useAppBadge`, Badge API) lendo só o cache das queries (`skipToken`, não busca lances no site).
  Com o app fechado o `sw.js` soma 1 por push (contador no cache `garimpo-meta`); o app aberto
  grava o número real.
- **Não validado num aparelho real**: conferir permissão, notificação, toque (abre `/olho`) e selo.

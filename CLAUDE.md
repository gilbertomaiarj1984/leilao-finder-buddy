# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Leia primeiro, nesta ordem:** `AGENTS.md` (convenções de trabalho) e
> `docs/notas-desenvolvimento.md` (índice curto: restrições, arquitetura de dados, mapa da
> documentação). Depois, **só a página de `docs/areas/` da área que vai mexer** (scraping, UI,
> IA, coleção…) — é a fonte da mecânica fina, mais confiável que o código sozinho. Não leia
> `CHANGELOG.md` nem `docs/arquivo/` inteiros: use `grep` quando precisar do histórico. O código
> é refatorado com frequência — prefira `grep` por nome de função a caminhos/linhas exatos.

## O que é o app

Garimpa discos de vinil em leilão no LeilõesBR e casas parceiras, agrupando por dia → casa de
leilão → artista, com vigia e lances sincronizados com a conta do usuário, avaliação por IA e
âncora de preço do Discogs. Stack: **TanStack Start** (React 19 + SSR) + **Postgres** próprio
(via `postgres.js`) + **Google OAuth** direto, deploy em **VPS** (Docker Compose + Caddy, build
via Vite + Nitro preset `node-server`), atualização periódica via **GitHub Actions**.
Migração do free tier anterior para VPS único (cutover concluído) documentada em
`docs/arquivo/economia-fase-2-vps-unico.md`.

## Comandos

Gerenciador de pacotes: **Bun** (`bunfig.toml` aponta para o npm público; Node 18+ também
funciona).

```sh
bun install
cp .env.example .env      # preencher os valores (ver README.md)
bun run dev                # http://localhost:3000
bun run build               # build de produção (Vite + Nitro)
bun run build:dev           # build em modo development
bun run preview             # servir o build localmente
bun run lint                # eslint .
bun run format               # prettier --write .
bun run typecheck           # tsc (app + tests/)
bun test                    # testes de funções puras (tests/*.test.ts)
bun run knip                # código/export/dependência sem uso
bun run check               # lint + typecheck + test + knip (rodar antes de todo push)
```

Testes cobrem só funções puras (parsing, grading, matching) — ao mexer nelas, acrescente um
caso em `tests/`. **Scraping/lance não são testáveis neste ambiente** (sem rede para os sites de
leilão) — validar por análise estática; quem testa contra o site real é o usuário, na prévia ou
produção.

## Convenções de trabalho

Ver `AGENTS.md` (fonte única — responder em PT, branch a partir de `origin/main`, bump de
versão obrigatório em todo PR, atualizar a documentação (página da área + `CHANGELOG.md`) antes de mesclar,
`supabase/setup.sql` reaplicado automaticamente em produção a cada deploy — ver
`docs/notas-desenvolvimento.md`, "Restrições do ambiente").

## Arquitetura

- **Roteamento**: file-based do TanStack Start em `src/routes/` (ver `src/routes/README.md`
  para as convenções de nomes de arquivo). `src/routeTree.gen.ts` é gerado, não editar à mão.
  `__root.tsx` é o app shell; rotas protegidas ficam sob `_authenticated/` (gate de auth em
  `_authenticated/route.tsx`).
- **Auth**: Google OAuth direto (authorization code + PKCE), implementado à mão em
  `src/lib/auth.server.ts` (rotas `/api/auth/google/*` tratadas em `src/server.ts`, fora das
  server functions) — cookie de sessão HttpOnly assinado por HMAC. Acesso restrito a um único
  e-mail (`LEILOESBR_EMAIL`, checado em `src/lib/access.server.ts`).
- **Dados**: Postgres próprio, acessado no servidor via `db` (`src/lib/db-client.server.ts`) —
  builder encadeável `db.from(...).select/eq/upsert/...` (`db-query.server.ts`, estilo
  PostgREST, herdado da época do Supabase) sobre `postgres.js` (`db.server.ts`). Server
  functions usam o middleware `requireAuth` (`src/lib/auth-middleware.ts`).
  Módulos `*.server.ts` em `src/lib/` só rodam no servidor (convenção de sufixo, reforçada pelo
  `no-restricted-imports` do ESLint em vez do pacote `server-only` do Next.js); os
  `*.functions.ts` expõem essa lógica como server functions do TanStack Start, um arquivo por
  domínio (`leiloesbr` = lotes/lances/pregão, `ai`, `analytics`, `collection`, `wantlist`,
  `purchases`, `lot-exclusion`, `leiloesbr-watch`, `auth`).
- **Endpoint de cron fora das server functions**: `/api/cron` é tratado direto em
  `src/server.ts` (sem CSRF), protegido por `CRON_TOKEN` (header, comparação em tempo
  constante). Disparado 3×/dia por `.github/workflows/refresh.yml`, com vários `step`s
  (`chunk`, `enrich`, `aiident`, `aieval`, `market`, `condition`, `sales`, `reident`, ...) —
  orquestração em `src/lib/cron.server.ts`.
- **Scraping**: a listagem geral é varrida sem login (`publicFetch`) em blocos/chunks (nunca
  tudo de uma vez, para caber no tempo do servidor); login (`authFetch`,
  `leiloesbr-auth.server.ts`) só é usado para dados da conta (vigias, lances). Sessão é por
  origem (cada casa/domínio tem seu próprio cookie). Dados são persistidos por **merge/upsert**
  na tabela `lots` (nunca apagam o que não veio na varredura atual).
- **IA**: camada multi-provedor plugável (Claude via `@anthropic-ai/sdk`, Gemini via REST) em
  `src/lib/ai-provider.server.ts`, ponto único `runText(req, provider)`; prompts/parsing em
  `ai-eval.server.ts` (lotes), `ai-collection.server.ts` e `ai-condition.server.ts`. Totalmente opcional —
  sem chaves configuradas, vira no-op e o app segue funcionando. Provedor padrão selecionável
  na UI, persistido em `app_state`.
- **Estado global sem tabelas dedicadas**: a tabela `app_state` (chave/valor) guarda
  configurações e overrides de longa duração (casas verificadas, modo de IA, vínculos e
  aprendizado da Coleção, apelidos/exclusões do Analytics, etc.) em vez de migrações novas para
  cada preferência — ver `src/lib/app-state.server.ts`.
- **Módulos puros/client-safe**: lógica de negócio sem I/O (parsing, scoring, agregação) fica
  fora de `*.server.ts` para ser reutilizável no cliente e testável isoladamente — por exemplo
  `src/lib/grading.ts` (conservação disco/capa), `src/lib/vinyl-parse.ts`,
  `src/lib/wantlist-match.ts`, `src/lib/analytics.ts`, `src/components/vinyl/grouping.ts`.
- **State management**: estado de UI local em `useState` + TanStack Query para dados do
  servidor. Queries compartilhadas entre telas ficam em `src/lib/queries.ts` (hooks
  `useXQuery()` + `queryKeys` para invalidar/`setQueryData`) — não redefinir `useQuery` de uma
  chave que já existe lá.
- **UI**: componentes shadcn-style em `src/components/ui/` (gerados, não seguem
  necessariamente o lint estrito) + componentes de domínio em `src/components/vinyl/`. A home
  (`routes/_authenticated/index.tsx`) só compõe: estado/dados em
  `components/vinyl/dashboard/use-dashboard-data.tsx` (objeto `DashboardData`) e cada parte da
  tela (`DashboardHeader`, `DayTab`, `WatchedTab`, `BidsTab`) num arquivo dessa pasta.
  Tailwind v4 via `@tailwindcss/vite`.
- **Banco**: Postgres próprio (rodando em container, no `docker-compose.yml`); schema
  consolidado em `supabase/setup.sql` (nome histórico, mantido — schema puro, sem nada
  específico do Supabase); histórico incremental em `supabase/migrations/`. Tabelas
  principais: `lots`, `known_artists`, `app_state`, `seen_auctions`, `lot_ai`, `lot_ident`,
  `lot_market`, `lot_condition`, `lot_sales`, `wantlist_items`, `collection_items`.
- **Fotos da Coleção**: arquivos em disco (`COLLECTION_DIR`, volume Docker), servidos pelo
  Caddy em produção (`/collection/*`, `Cache-Control` 7 dias) — ver `Caddyfile` e
  `src/lib/collection-storage.server.ts`.
- **Deploy**: `docker-compose.yml` (`caddy` + `app` + `postgres:17` + `backup`) num VPS único;
  `.github/workflows/deploy.yml` builda as imagens (`Dockerfile` do app, preset
  `node-server`; `docker/backup/Dockerfile` do backup) e publica no GHCR a cada push nas
  branches `main` (produção, pós-cutover da Fase 6) ou `vps` (ainda usada pela Fase 7/preview
  deployments), depois faz `docker compose pull && up -d` por SSH.
- **Backup/monitoramento**: `pg_dump` diário do serviço `backup` para o Cloudflare R2
  (retenção por lifecycle no bucket, não no script); ping pro healthchecks.io no fim/erro
  do `refresh.yml` (`HEALTHCHECKS_PING_URL`, opcional). FKs `ON DELETE CASCADE` de
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` para `lots(id)` — nunca `lot_sales`.
  `seen_auctions` podada pelo `step=prune` do cron.

Para a mecânica fina de cada área (parsing de catálogo, matching de coleção, grading, Discogs,
Analytics, etc.) consultar a página correspondente em `docs/areas/` (mapa no índice
`docs/notas-desenvolvimento.md`) — é mantida atualizada a cada PR.

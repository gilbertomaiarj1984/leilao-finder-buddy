# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Leia primeiro, nesta ordem:** `AGENTS.md` (convenções de trabalho, resumo) e
> `docs/notas-desenvolvimento.md` (documento de continuidade entre sessões — arquitetura
> detalhada, mecânica de scraping por feature, decisões, histórico de versões e pendências).
> Este arquivo é só o essencial para começar; para qualquer detalhe de mecânica (parsing,
> scraping, IA, Discogs, etc.) o `notas-desenvolvimento.md` é a fonte, não o código sozinho —
> o código é refatorado com frequência, então prefira `grep` por nome de função a confiar em
> caminhos/linhas exatos.

## O que é o app

Garimpa discos de vinil em leilão no LeilõesBR e casas parceiras, agrupando por dia → casa de
leilão → artista, com vigia e lances sincronizados com a conta do usuário, avaliação por IA e
âncora de preço do Discogs. Stack: **TanStack Start** (React 19 + SSR) + **Supabase**
(Postgres + Auth), deploy na **Vercel** (build via Vite + Nitro), atualização periódica via
**GitHub Actions**.

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
bunx tsc --noEmit           # checagem de tipos (sem script dedicado)
```

Não há suite de testes automatizada. Funções puras podem ser checadas ad-hoc com
`bun -e '...'`. **Scraping/lance não são testáveis neste ambiente** (sem rede para os sites de
leilão) — validar por análise estática; quem testa contra o site real é o usuário, na prévia ou
produção.

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa (a `main` recebe
  commits de outras sessões/PRs). Fluxo: branch → PR → merge.
- **Atualizar `docs/notas-desenvolvimento.md` antes de mesclar QUALQUER PR**: mudança de
  arquitetura/mecânica na seção certa, uma linha no histórico de versões, pendências resolvidas
  saem da lista. Como o arquivo já vive na `main`, faça fetch de `origin/main` e edite a partir
  dele para evitar conflito.
- **Bump de versão obrigatório em todo PR**: `APP_VERSION` em `src/lib/version.ts` **e**
  `version` no `package.json`, seguindo semver (PATCH=correção, MINOR=nova função,
  MAJOR=quebra). É o número exibido no rodapé em produção. O CI `.github/workflows/version-bump.yml`
  falha o PR se a versão não subir (merge via API do GitHub não bloqueia — não confiar só no
  CI). Colocar a versão no título do PR (ex.: `v0.2.0 — filtro por casa`).
- Não colar páginas HTML inteiras no chat (consomem contexto) — pedir só o bloco relevante.
- Migrações `.sql` em `supabase/migrations/` **não são auto-aplicadas**: o schema é
  (re)criado via `supabase/setup.sql` (SQL Editor ou `psql -f`, idempotente, tudo
  `IF NOT EXISTS`). Ao criar tabela/coluna, editar `setup.sql` **e**
  `src/integrations/supabase/types.ts` à mão.

## Arquitetura

- **Roteamento**: file-based do TanStack Start em `src/routes/` (ver `src/routes/README.md`
  para as convenções de nomes de arquivo). `src/routeTree.gen.ts` é gerado, não editar à mão.
  `__root.tsx` é o app shell; rotas protegidas ficam sob `_authenticated/` (gate de auth em
  `_authenticated/route.tsx`).
- **Auth**: Supabase Auth nativo (OAuth Google, PKCE) — `src/routes/auth.tsx` +
  `src/integrations/supabase/`. Acesso restrito a um único e-mail (`LEILOESBR_EMAIL`, checado
  em `src/lib/access.server.ts`).
- **Dados**: servidos via `service_role` no servidor (a RLS bloqueia acesso direto do cliente).
  Módulos `*.server.ts` em `src/lib/` só rodam no servidor (convenção de sufixo, reforçada pelo
  `no-restricted-imports` do ESLint em vez do pacote `server-only` do Next.js); os
  `*.functions.ts` expõem essa lógica como server functions do TanStack Start para o cliente
  chamar via React Query.
- **Endpoint de cron fora das server functions**: `/api/cron` é tratado direto em
  `src/server.ts` (sem Supabase/CSRF), protegido por `CRON_TOKEN` (header, comparação em tempo
  constante). Disparado 4×/dia por `.github/workflows/refresh.yml`, com vários `step`s
  (`chunk`, `enrich`, `aiident`, `aieval`, `market`, `condition`, `sales`, `reident`, ...) —
  orquestração em `src/lib/cron.server.ts`.
- **Scraping**: a listagem geral é varrida sem login (`publicFetch`) em blocos/chunks (nunca
  tudo de uma vez, para caber no tempo do servidor); login (`authFetch`,
  `leiloesbr-auth.server.ts`) só é usado para dados da conta (vigias, lances). Sessão é por
  origem (cada casa/domínio tem seu próprio cookie). Dados são persistidos por **merge/upsert**
  na tabela `lots` (nunca apagam o que não veio na varredura atual).
- **IA**: camada multi-provedor plugável (Claude via `@anthropic-ai/sdk`, Gemini via REST) em
  `src/lib/ai-provider.server.ts`, ponto único `runText(req, provider)`. Totalmente opcional —
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
- **State management**: Redux Toolkit (`src/store/`) para estado de UI local + TanStack Query
  para dados do servidor (cache, invalidação, escrita otimista).
- **UI**: componentes shadcn-style em `src/components/ui/` (gerados, não seguem
  necessariamente o lint estrito) + componentes de domínio em `src/components/vinyl/`.
  Tailwind v4 via `@tailwindcss/vite`.
- **Banco**: schema consolidado em `supabase/setup.sql`; histórico incremental em
  `supabase/migrations/`. Tabelas principais: `lots`, `known_artists`, `app_state`,
  `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`, `lot_condition`, `lot_sales`,
  `wantlist_items`, `collection_items`.

Para a mecânica fina de cada área (parsing de catálogo, matching de coleção, grading, Discogs,
Analytics, etc.) consultar as seções correspondentes em `docs/notas-desenvolvimento.md` — é
mantido atualizado a cada PR e é mais confiável que inferir do código isoladamente.

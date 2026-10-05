# Notas de desenvolvimento — Garimpo de Vinil

> Documento de continuidade entre sessões. **Este arquivo é só o índice**: leia-o inteiro e,
> depois, **só a página de `docs/areas/` da área em que vai mexer**. O código é refatorado com
> frequência — prefira `grep` por nome de função a confiar em caminhos/linhas exatos.
>
> ⚠️ **Atualize a documentação ANTES de mesclar qualquer PR:** mudança de mecânica → página da
> área em `docs/areas/`; toda entrega → 1 linha no topo do `CHANGELOG.md`; pendência nova →
> `docs/pendencias.md` (resolvida → `docs/arquivo/pendencias-resolvidas.md`). Mantenha este
> índice curto: detalhe vai na página da área, não aqui.

## O que é o app

Garimpa **discos de vinil** em leilão no **LeilõesBR** e casas parceiras, agrupando por
**dia → casa de leilão → artista**, com **vigia** e **lances** sincronizados com a conta do
usuário, avaliação por **IA** e âncora de preço do **Discogs**. Stack: **TanStack Start +
React 19 (SSR)** + **Postgres** próprio (`postgres.js`) + Google OAuth, deploy num **VPS**
(Docker Compose + Caddy, Nitro `node-server`). Origem: Lovable (2026-08) → Supabase/Vercel →
VPS único (histórico em `docs/arquivo/`).

## Mapa da documentação

| Área                                                                  | Página                                   | Código principal                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Scraping, catálogo, nº do lote, casas verificadas, cron               | `docs/areas/scraping.md`                 | `leiloesbr-scrape.server.ts`, `leiloesbr-catalog.server.ts`, `cron.server.ts`, `refresh.yml` |
| Páginas, UI, cores/badges/busca, valores do lote, aviso de lance      | `docs/areas/ui.md`                       | `src/routes/_authenticated/*`, `src/components/vinyl/*`                                      |
| Grading Disco × Capa, estado pré-leilão                               | `docs/areas/grading-e-estado.md`         | `grading.ts`, `lot-condition.server.ts`                                                      |
| Histórico de vendas, Vinil Analytics                                  | `docs/areas/vendas-e-analytics.md`       | `lot-sales.server.ts`, `analytics.ts`, `analytics-view.tsx`                                  |
| IA (avaliação, identificação, provedores, custo)                      | `docs/areas/ia.md`                       | `ai-eval.server.ts`, `ai-provider.server.ts`                                                 |
| Discogs / mercado                                                     | `docs/areas/discogs.md`                  | `discogs.server.ts`, `lot-market.server.ts`                                                  |
| Coleção, Sondagem, Compras, De olho                                   | `docs/areas/colecao-sondagem-compras.md` | `collection*.ts`, `wantlist*.ts`, `purchases*.ts`, `lookout*.ts`                             |
| Exclusão de lotes / "possível lixo"                                   | `docs/areas/exclusao-de-lotes.md`        | `lot-exclusion*.ts`                                                                          |
| Infra, deploy, migração, ferramentas avulsas                          | `docs/areas/infra.md`                    | `docker-compose.yml`, `Caddyfile`, `deploy.yml`                                              |
| Pendências em aberto                                                  | `docs/pendencias.md`                     | —                                                                                            |
| O que mudou em cada versão                                            | `CHANGELOG.md` (raiz)                    | —                                                                                            |
| Histórico encerrado (economia/migração VPS, investigações resolvidas) | `docs/arquivo/`                          | —                                                                                            |

## Convenções de trabalho

Ver `AGENTS.md` (fonte única). Resumo: responder em PT, branch a partir de `origin/main`,
atualizar a documentação (área + `CHANGELOG.md`) antes de mesclar QUALQUER PR (ver aviso no
topo), bump de versão
obrigatório em todo PR (`src/lib/version.ts` + `package.json`), rodapé de atribuição no GitHub.

## Restrições do ambiente

- **Não dá para testar scraping/lance daqui** (sem rede aos sites de leilão) — validar por
  análise estática + testes de funções puras; o **usuário** testa na prévia/produção.
- **`bun install` funciona** (`bunfig.toml` → npm público). **`bun run check`** roda tudo o que
  dá pra validar localmente: `lint` + `typecheck` (app e `tests/`, com `noUnusedLocals`) +
  `bun test` (testes de funções puras em `tests/*.test.ts` — acrescente um caso ao mexer em
  parsing/grading/matching) + `knip` (código/export/dependência sem uso). `bun run build` à parte.
- **Schema consolidado em `supabase/setup.sql`, re-executável (tudo `IF NOT EXISTS`).** Não é
  mais Supabase hospedado (Postgres próprio no VPS, ver `docs/areas/infra.md`) — em **produção**, `deploy.yml` reaplica `setup.sql` sozinho a cada push pra
  `main`/`vps` (`docker compose exec postgres psql -f /docker-entrypoint-initdb.d/01-setup.sql`,
  depois do `up -d`), então uma tabela/coluna nova já existe no próximo deploy sem passo manual.
  Localmente, aplicar com `psql -f supabase/setup.sql` contra o Postgres do `docker compose` de
  dev (ou recriar o volume). Migrações incrementais em `supabase/migrations/` continuam só como
  **histórico/changelog** do schema. Ao criar tabela/coluna, editar `setup.sql` e o tipo
  da linha no módulo `*.server.ts` da tabela (não há tipos gerados do banco). Tabelas: `lots`, `known_artists`, `app_state`,
  `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`, `lot_condition`, `lot_sales`,
  `wantlist_items`, `collection_items`, `purchases`, `excluded_lots`, `lookout_items`.
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
  por `id`, **merge** — nunca apaga o que não veio) + `app_state` (chaves globais: casas
  verificadas, interesses, modo de IA, batches pendentes, vínculos/aprendizado da Coleção).
- `id` do lote = `"${idLeilao}-${idPeca}"`. Janela = **5 dias** (`WINDOW_DAYS`).
- **Última atualização:** `getVinylLots` retorna `updatedAt` = maior `updated_at` de `lots` na
  janela (trigger `update_lots_updated_at` toca a coluna no upsert); exibido sob "Atualizar
  tudo" (`formatUpdatedAt`, fuso São Paulo).

## Lições que evitam regressão

> ⚠️ **Lição (evitar regressão):** módulo **`*.server.ts` NÃO deve importar de módulo
> client-safe** (nem `import type`). No v0.24.0, `app-state.server.ts` importava um tipo de
> `wantlist-match` → o _code-splitting_ deixou o chunk `wantlist-match-*.js` fora do `/assets/`
> do cliente → **404** ("Failed to fetch dynamically imported module") só na home logada em
> produção. Corrigido no v0.24.1 definindo o tipo localmente. Tipos compartilhados entre client e
> server: manter no lado **client-safe**.

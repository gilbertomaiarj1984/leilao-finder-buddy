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

| Área                                                                                             | Página                                                                   | Código principal                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Scraping, catálogo, nº do lote, casas verificadas, cron                                          | `docs/areas/scraping.md`                                                 | `leiloesbr-scrape.server.ts`, `leiloesbr-catalog.server.ts`, `cron.server.ts`, `refresh.yml` |
| Páginas e telas (home, Vigiados, Lances, Análise…)                                               | `docs/areas/ui.md`                                                       | `src/routes/_authenticated/*`, `src/components/vinyl/*`                                      |
| Agendamentos de lance                                                                            | `docs/areas/ui-agendamentos.md`                                          | `lot-bid-schedule-button.tsx`, `bid-schedule*.ts`                                           |
| Cores, badges, busca, valores do lote (atual/próximo/meu lance)                                  | `docs/areas/ui-lotes-cores-busca.md`                                     | `components/vinyl/*`, `lot-score.ts`                                                         |
| Pregão ao vivo, aviso de lance superado, "Lotes sem lance"                                       | `docs/areas/ui-pregao-ao-vivo.md`                                        | `dashboard/*`, `lot-sales.server.ts`                                                         |
| Desempenho das telas, estado lembrado, painel de casas                                           | `docs/areas/ui-desempenho-e-estado.md`                                   | `queries.ts`, `account-cache.server.ts`                                                      |
| Interface mobile e PWA                                                                           | `docs/areas/ui-mobile-pwa.md`                                            | `public/`, `components/vinyl/*`                                                              |
| Grading Disco × Capa, estado pré-leilão                                                          | `docs/areas/grading-e-estado.md`                                         | `grading.ts`, `lot-condition.server.ts`                                                      |
| Histórico de vendas, Vinil Analytics                                                             | `docs/areas/vendas-e-analytics.md`                                       | `lot-sales.server.ts`, `analytics.ts`, `analytics-view.tsx`                                  |
| IA (avaliação, identificação, provedores, custo)                                                 | `docs/areas/ia.md`                                                       | `ai-eval.server.ts`, `ai-provider.server.ts`                                                 |
| APIs dos provedores de IA (Claude, Gemini, Groq): modelos, preços, limites, visão, raciocínio    | `docs/areas/ia-apis-referencia.md`                                       | `ai-provider.server.ts`, `ai-provider.ts`                                                    |
| Painel de IA (`/ia-painel`): contexto do prompt, correlação de condições, frete                  | `docs/areas/ia.md` (seção "Painel de IA") + `docs/areas/ui-painel-ia.md` | `ai-panel-config.ts`, `ai-context.ts`, `condition-text.ts`, `components/vinyl/ai-panel/*`    |
| Testes locais (Postgres real, cadeia de IA com API falsa, painel no navegador)                   | `tools/local-tests/README.md`                                            | `tools/local-tests/*`                                                                        |
| Discogs / mercado                                                                                | `docs/areas/discogs.md`                                                  | `discogs.server.ts`, `lot-market.server.ts`                                                  |
| Coleção do usuário e edição do disco (original × reedição)                                       | `docs/areas/colecao.md`                                                  | `collection*.ts`, `album-edition.ts`                                                         |
| De olho e perfil do colecionador                                                                 | `docs/areas/de-olho.md`                                                  | `lookout*.ts`, `collector-profile.server.ts`                                                 |
| Compras, envio por pregão, loja e avaliação das casas                                            | `docs/areas/compras.md`                                                  | `purchases*.ts`                                                                              |
| Exclusão de lotes / "possível lixo"                                                              | `docs/areas/exclusao-de-lotes.md`                                        | `lot-exclusion*.ts`                                                                          |
| Infra, deploy, migração, ferramentas avulsas                                                     | `docs/areas/infra.md`                                                    | `docker-compose.yml`, `Caddyfile`, `deploy.yml`                                              |
| Pendências em aberto                                                                             | `docs/pendencias.md`                                                     | —                                                                                            |
| O que mudou em cada versão                                                                       | `CHANGELOG.md` (raiz)                                                    | —                                                                                            |
| Histórico encerrado (economia/migração VPS, pendências resolvidas, UI e Sondagem descontinuadas) | `docs/arquivo/`                                                          | —                                                                                            |

## Convenções de trabalho

Ver `AGENTS.md` (fonte única). Resumo: responder em PT, branch a partir de `origin/main`,
atualizar a documentação (área + `CHANGELOG.md`) antes de mesclar QUALQUER PR (ver aviso no
topo), bump de versão
obrigatório em todo PR (`src/lib/version.ts` + `package.json`), rodapé de atribuição no GitHub.

## Restrições do ambiente

- **Acesso irrestrito à internet** (desde a v0.151.6): as sessões de agente alcançam o LeilõesBR e
  as casas parceiras (confirmado: `https://www.leiloesbr.com.br/` → HTTP 200), além do Discogs etc.
  Scraping e consultas podem — e devem — ser validados contra o site real durante a implementação
  (requisições públicas; `publicFetch`). Login/lance só com credenciais fornecidas pelo usuário, e
  nunca dar lance nem alterar a conta sem pedido explícito. Complementar com testes de funções
  puras; o **usuário** segue testando a prévia/produção.
- **`bun install` funciona** (`bunfig.toml` → npm público). **`bun run check`** roda tudo o que
  dá pra validar localmente: `lint` + `typecheck` (app e `tests/`, com `noUnusedLocals`) +
  `bun test` (testes de funções puras em `tests/*.test.ts` — acrescente um caso ao mexer em
  parsing/grading/matching) + `knip` (código/export/dependência sem uso). `bun run build` à parte.
- **Schema consolidado em `supabase/setup.sql`, re-executável (tudo `IF NOT EXISTS`).** Não é
  mais Supabase hospedado (Postgres próprio no VPS, ver `docs/areas/infra.md`) — em **produção**, `deploy.yml` reaplica `setup.sql` sozinho a cada push pra
  `main` (`docker compose exec postgres psql -f /docker-entrypoint-initdb.d/01-setup.sql`,
  depois do `up -d`), então uma tabela/coluna nova já existe no próximo deploy sem passo manual.
  Localmente, aplicar com `psql -f supabase/setup.sql` contra o Postgres do `docker compose` de
  dev (ou recriar o volume). Migrações incrementais em `supabase/migrations/` continuam só como
  **histórico/changelog** do schema. Ao criar tabela/coluna, editar `setup.sql` e o tipo
  da linha no módulo `*.server.ts` da tabela (não há tipos gerados do banco). Tabelas: `lots`, `known_artists`, `app_state`,
  `seen_auctions`, `lot_ai`, `lot_ident`, `lot_market`, `lot_condition`, `lot_sales`,
  `collection_items`, `purchases`, `excluded_lots`, `lookout_items`.
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
  verificadas, interesses, modo de IA, batches pendentes, vínculos/aprendizado da Coleção). **Escrita em chave que guarda um JSON inteiro (lista/mapa) sempre via
  `mutateAppState`** (`app-state-mutate.server.ts`, transação com `FOR UPDATE`) — nunca ler com
  leitor tolerante, alterar e regravar (perde dado em erro de leitura e em escrita concorrente).
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

# Notas para agentes

Este projeto é um app **TanStack Start** (React 19 + SSR, build com Vite + Nitro),
com **Postgres** próprio como backend e deploy em **VPS** (Docker Compose + Caddy).

> **Antes de começar, leia `docs/notas-desenvolvimento.md`** — é o documento de
> continuidade entre sessões (arquitetura, mecânica do scraping, baseline do painel,
> nº de lote, cores, pendências). Este arquivo é só o resumo.

> **Trabalho de infraestrutura/custo pendente:** ver `docs/economia-migracao.md` (índice) e
> os dois planos de fase que ele aponta. Migração em andamento na branch `vps` (base:
> `origin/main`) — Fases 1 (camada de dados), 2 (Auth: Google OAuth direto), 3 (Storage: fotos
> da Coleção em disco), 4 (Host: Docker Compose + Caddy no VPS) e 5 (backup/monitoramento/
> faxina) entregues em código. Falta só a Fase 6 (cutover — migrar o banco de verdade, apontar
> o DNS, mesclar `vps` → `main`), que exige acesso ao VPS real e não é algo que uma sessão
> remota consiga fazer sozinha — ver o passo a passo manual em
> `docs/economia-fase-2-vps-unico.md`. Até lá, produção continua no Supabase/Vercel; o
> ambiente do VPS existe em paralelo, só validado por quem testa manualmente.

## Visão geral

- Auth: Google OAuth direto (authorization code + PKCE), implementado à mão — ver
  `src/routes/auth.tsx` e `src/lib/auth.server.ts`.
- Acesso restrito ao e-mail em `LEILOESBR_EMAIL` (ver `src/lib/access.server.ts`).
- Dados servidos por um Postgres próprio (`src/lib/db.server.ts` + `db-query.server.ts`),
  nunca acessado direto do cliente.
- Atualização periódica via GitHub Actions chamando `/api/cron` — o endpoint é
  tratado direto em `src/server.ts` (fora das server functions), protegido por
  `CRON_TOKEN`; workflow em `.github/workflows/refresh.yml`.
- Deploy: `Dockerfile` + `docker-compose.yml` + `Caddyfile`, publicado via
  `.github/workflows/deploy.yml` (push na branch `vps` → build → GHCR → SSH no VPS).
- Roteamento file-based do TanStack Start — ver `src/routes/README.md`.
- Variáveis de ambiente: ver `.env.example`.

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/vps` antes de cada tarefa**
  (a `vps` é a branch base durante a migração — ver aviso acima; ela pode receber
  commits de outras sessões/PRs. Volta a ser `origin/main` depois do cutover da Fase 6).
- Fluxo: branch de trabalho → PR **para `vps`** → merge.
- **Atualizar `docs/notas-desenvolvimento.md` antes de mesclar QUALQUER PR** (mudanças de
  arquitetura/mecânica na seção certa, uma linha no histórico de versões, pendências resolvidas
  saem da lista).
- **Subir a versão do app em TODO PR:** bump em `src/lib/version.ts` (`APP_VERSION`) e
  no `package.json`, seguindo semver (PATCH=correção, MINOR=nova função, MAJOR=quebra).
  É o número mostrado no rodapé em produção. **Obrigatório** — o CI `version-bump.yml`
  falha o PR se a versão não subir. Coloque a versão no título do PR (ex.: `v0.2.0 — …`).
- Rodapé de atribuição em qualquer post no GitHub; commits terminam com
  `Co-Authored-By: Claude ...`.

# Notas para agentes

Este projeto é um app **TanStack Start** (React 19 + SSR, build com Vite + Nitro),
com **Postgres** próprio como backend e deploy em **VPS** (Docker Compose + Caddy).

> **Antes de começar, leia `docs/notas-desenvolvimento.md`** — é o documento de
> continuidade entre sessões (arquitetura, mecânica do scraping, baseline do painel,
> nº de lote, cores, pendências). Este arquivo é só o resumo.

> **Migração pra VPS concluída (Fase 6, cutover feito).** `main` voltou a ser a branch de
> produção/trabalho padrão — **não usar `vps` como base pra novo trabalho** (ela só segue viva
> em paralelo enquanto durar a Fase 7/preview deployments via Dokploy, trabalho de outra sessão;
> sincronizar com `main` de vez em quando, não abrir PR novo contra ela). Ver
> `docs/economia-fase-2-vps-unico.md` pra histórico completo do cutover e achados de produção
> pós-migração (ex.: colisão de alias de rede com o preview do Dokploy).

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
  `.github/workflows/deploy.yml` (push na branch `main` — ou `vps`, ainda usada pela Fase 7 —
  → build → GHCR → SSH no VPS).
- Roteamento file-based do TanStack Start — ver `src/routes/README.md`.
- Variáveis de ambiente: ver `.env.example`.

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa**
  (pós-cutover da Fase 6 — ver aviso acima; `main` é a branch de produção/base agora).
  **Não usar `vps` como base pra trabalho novo.**
- Fluxo: branch de trabalho → PR **para `main`** → merge.
- **Atualizar `docs/notas-desenvolvimento.md` antes de mesclar QUALQUER PR** (mudanças de
  arquitetura/mecânica na seção certa, uma linha no histórico de versões, pendências resolvidas
  saem da lista).
- **Subir a versão do app em TODO PR:** bump em `src/lib/version.ts` (`APP_VERSION`) e
  no `package.json`, seguindo semver (PATCH=correção, MINOR=nova função, MAJOR=quebra).
  É o número mostrado no rodapé em produção. **Obrigatório** — o CI `version-bump.yml`
  falha o PR se a versão não subir. Coloque a versão no título do PR (ex.: `v0.2.0 — …`).
- Rodapé de atribuição em qualquer post no GitHub; commits terminam com
  `Co-Authored-By: Claude ...`.
- **Nunca editar `Caddyfile` sem validar a sintaxe antes de mandar pro VPS** — `deploy.yml`
  aplica direto em produção a cada push na `vps`, sem passo de revisão manual no meio. Baixar o
  binário oficial do Caddy (não precisa de Docker: `curl -fsSL -o caddy.tar.gz
  "https://github.com/caddyserver/caddy/releases/download/vX.Y.Z/caddy_X.Y.Z_linux_amd64.tar.gz"`,
  extrair, `caddy validate --config Caddyfile --adapter caddyfile` com as envs via `VAR=valor`
  na frente do comando) e, se mexer em matcher/expressão/roteamento novo, também `caddy run`
  numa porta alternativa (`http_port`/`https_port` no bloco global) pra testar de verdade antes
  do push — já causou crash-loop de produção duas vezes (v0.69.5: env vazia virando bloco
  Caddyfile inválido; ver `docs/economia-fase-2-vps-unico.md`, Fase 7).

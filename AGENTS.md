# Notas para agentes

Este projeto é um app **TanStack Start** (React 19 + SSR, build com Vite + Nitro),
com **Supabase** como backend e deploy na **Vercel**.

> **Antes de começar, leia `docs/notas-desenvolvimento.md`** — é o documento de
> continuidade entre sessões (arquitetura, mecânica do scraping, baseline do painel,
> nº de lote, cores, pendências). Este arquivo é só o resumo.

## Visão geral

- Auth: Supabase Auth nativo (OAuth Google, fluxo PKCE) — ver `src/routes/auth.tsx`
  e `src/integrations/supabase/`.
- Acesso restrito ao e-mail em `LEILOESBR_EMAIL` (ver `src/lib/access.server.ts`).
- Dados servidos via `service_role` no servidor (RLS bloqueia acesso direto).
- Atualização periódica via GitHub Actions chamando `/api/cron` — o endpoint é
  tratado direto em `src/server.ts` (fora das server functions), protegido por
  `CRON_TOKEN`; workflow em `.github/workflows/refresh.yml`.
- Roteamento file-based do TanStack Start — ver `src/routes/README.md`.
- Variáveis de ambiente: ver `.env.example`.

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa**
  (a `main` pode receber commits de outras sessões/PRs).
- Fluxo: branch de trabalho → PR → merge.
- Rodapé de atribuição em qualquer post no GitHub; commits terminam com
  `Co-Authored-By: Claude ...`.

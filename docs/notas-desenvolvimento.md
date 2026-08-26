# Notas de desenvolvimento

Registro de conhecimento acumulado entre sessões de trabalho no **Garimpo de Vinil**.
Cada sessão acrescenta uma seção nova **ao final**, sem reescrever o histórico anterior.

## Visão geral do projeto

- **Stack:** TanStack Start (React 19 + SSR), build com Vite + Nitro, deploy na Vercel.
- **Backend:** Supabase (Auth nativo OAuth Google/PKCE + dados via `service_role` no servidor; RLS bloqueia acesso direto).
- **Domínio:** garimpa lotes de disco de vinil em leilões do LeilõesBR nos próximos 5 dias, agrupados por dia, casa de leilão e artista, com vigia sincronizada à conta do usuário.
- **Acesso restrito** ao e-mail em `LEILOESBR_EMAIL` (ver `src/lib/access.server.ts`).
- **Atualização periódica** via GitHub Actions chamando `/api/cron` (`.github/workflows/refresh.yml`), protegida por `CRON_TOKEN`.
- **Gerenciador de pacotes:** `bun` (há `bun.lock` e `bunfig.toml`).

### Mapa rápido de arquivos

| Área | Caminho |
| --- | --- |
| Root layout / shell / error+404 | `src/routes/__root.tsx` |
| Rota autenticada (guard) | `src/routes/_authenticated/route.tsx` |
| Listagem principal (home) | `src/routes/_authenticated/index.tsx` (arquivo grande, ~1775 linhas) |
| Painel de mudanças | `src/routes/_authenticated/dashboard.tsx` |
| Login | `src/routes/auth.tsx` |
| Integração Supabase | `src/integrations/supabase/` |
| Lógica de scraping/negócio | `src/lib/leiloesbr-*.server.ts`, `src/lib/vinyl-parse.ts` |
| Componentes UI (shadcn) | `src/components/ui/` |

### Comandos de validação (rodar antes de commit)

```bash
bun install            # necessário na 1ª vez da sessão (deps não vêm no clone)
bun run lint           # eslint (warnings pré-existentes em ui/badge e ui/button são esperados)
bunx tsc --noEmit      # typecheck
bunx prettier --check <arquivos>
bun run build          # build de produção (Vite + Nitro); gera .output (ignorado no git)
```

Observação: sem `bun install`, o `eslint` falha com `Cannot find package '@eslint/js'`.

---

## Sessão 2026-08-26 — Rodapé + versionamento do app

**Branch:** `claude/footer-versioning-4646i5` · **PR:** [#35](https://github.com/gilbertomaiarj1984/leilao-finder-buddy/pull/35)

### O que foi feito

1. **Fonte única de versão** — `src/lib/version.ts` exporta `APP_VERSION` (semver). É o **único** lugar para dar bump. Começou em `0.1.0`.
2. **Rodapé global** — `src/components/Footer.tsx` lê `APP_VERSION` e exibe `v{versão}` no rodapé. Usa tokens de design (`border`, `muted-foreground`, `card`).
3. **Montagem global** — o `<Footer />` foi adicionado ao `RootComponent` em `src/routes/__root.tsx`, dentro de um wrapper flex (`flex min-h-screen flex-col` + `flex-1` no conteúdo) para que apareça em **todas** as rotas via `<Outlet />` e fique sempre no fim da página.
4. **`package.json`** — adicionado `"version": "0.1.0"` para manter o campo consistente com o app.

Validado: prettier, lint (só warnings pré-existentes), `tsc --noEmit` e `build` — todos verdes.

### Convenção de versionamento (importante para PRs)

- **Bump em `src/lib/version.ts` a cada release**, seguindo semver:
  - **PATCH** (`0.1.1`) → correção de bug / ajuste pequeno
  - **MINOR** (`0.2.0`) → nova funcionalidade compatível
  - **MAJOR** (`1.0.0`) → mudança incompatível
- **Usar o número da versão no título dos PRs**, ex.: `v0.2.0 — filtro por casa de leilão`.
- O rodapé em produção mostra qual versão está no ar → dá para confirmar visualmente qual PR foi implantado.
- Versão atual no fim desta sessão: **v0.1.0**.

### Próximos passos / ideias em aberto

- (Opcional) Acompanhar o PR #35: reagir a falhas de CI e comentários de review.
- (Opcional) Automatizar o bump da versão (ex.: script ou checagem em CI para garantir que `APP_VERSION` foi incrementado no PR).
- Considerar exibir também o hash/commit ou data do build no rodapé, se for útil rastrear deploys específicos.

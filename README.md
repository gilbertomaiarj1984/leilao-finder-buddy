# Garimpo de Vinil (Leilão Finder)

App que garimpa discos de vinil em leilões (leiloesbr.com.br), com busca,
acompanhamento de lotes e lances.

Stack: **TanStack Start** (React 19 + SSR) · **Supabase** (Postgres + Auth) ·
deploy na **Vercel** · atualização periódica via **GitHub Actions**.

## Desenvolvimento local

Requer [Bun](https://bun.sh) (ou Node 18+).

```sh
bun install
cp .env.example .env   # preencha os valores
bun run dev
```

App em http://localhost:3000

## Variáveis de ambiente

Veja `.env.example`. Resumo:

| Variável                                              | Onde                      | Para quê                                     |
| ----------------------------------------------------- | ------------------------- | -------------------------------------------- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | cliente                   | conexão Supabase no front                    |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`           | servidor                  | validação de sessão                          |
| `SUPABASE_SERVICE_ROLE_KEY`                           | servidor                  | acesso aos dados (bypassa RLS) — **segredo** |
| `LEILOESBR_EMAIL`                                     | servidor                  | único e-mail Google autorizado               |
| `LEILOESBR_SENHA`                                     | servidor                  | login no site de leilões (scraper)           |
| `CRON_TOKEN`                                          | servidor + GitHub Actions | protege o endpoint `/api/cron`               |

## Deploy (Vercel)

1. Importe o repositório na Vercel (framework detectado automaticamente via Nitro).
2. Cadastre todas as variáveis acima em **Settings → Environment Variables**.
3. Build command: `bun run build` · Output: gerado pelo preset `vercel` do Nitro.

## Banco de dados (Supabase)

O schema está consolidado em `supabase/setup.sql`; o histórico em
`supabase/migrations/`.

## Atualização periódica

`.github/workflows/refresh.yml` chama `/api/cron` 4×/dia. Configure os secrets
`APP_URL` (domínio do app na Vercel) e `CRON_TOKEN` no repositório.

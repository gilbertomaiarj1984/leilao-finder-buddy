# Notas para agentes

Este projeto é um app **TanStack Start** (React 19 + SSR, build com Vite + Nitro),
com **Supabase** como backend e deploy na **Vercel**.

- Auth: Supabase Auth nativo (OAuth Google, fluxo PKCE) — ver `src/routes/auth.tsx`
  e `src/integrations/supabase/`.
- Acesso restrito ao e-mail em `LEILOESBR_EMAIL` (ver `src/lib/access.server.ts`).
- Dados servidos via `service_role` no servidor (RLS bloqueia acesso direto).
- Atualização periódica via GitHub Actions chamando `/api/cron` (ver
  `.github/workflows/refresh.yml`), protegida por `CRON_TOKEN`.
- Variáveis de ambiente: ver `.env.example`.

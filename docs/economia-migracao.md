# Economia de infraestrutura — decisão e alternativas descartadas

> Índice e memória da decisão. Investigação feita em 2026-09-14, com preços verificados na
> data. O app é de **um único usuário** (`src/lib/access.server.ts` libera um e-mail Google).
> Orçamento alvo: ~US$ 5/mês. Nada estourou ainda — a motivação é preventiva.

## Documentos

| Fase | Documento | Custo | Status |
|---|---|---|---|
| 1 | [Faxina do banco e medição](./economia-fase-1-faxina-e-medicao.md) | US$ 0 | não iniciada |
| 2 | [VPS único (escape hatch)](./economia-fase-2-vps-unico.md) | ~US$ 4/mês | só se a Fase 1 exigir |

**A Fase 2 não deve ser executada sem os números da Fase 1.**

## O que o app usa do Supabase

| Recurso | Uso real | Onde |
|---|---|---|
| Postgres | 11 tabelas, 76 chamadas via PostgREST | 11 arquivos `src/lib/*.server.ts` |
| Auth | Google OAuth (PKCE), 1 e-mail autorizado | `src/routes/auth.tsx`, `src/integrations/supabase/auth-middleware.ts` |
| Storage | 1 bucket público (`collection`) | `src/lib/collection.server.ts:936` |
| Edge Functions | **nenhuma** | — |
| Realtime | **nenhum** | — |

RLS está ligada **sem nenhuma policy** (0 `CREATE POLICY` em `supabase/setup.sql`) e
`anon`/`authenticated` têm `REVOKE ALL`. O navegador nunca consulta o Postgres — todo acesso a
dado passa pelo servidor com `service_role`.

## Alternativas descartadas (e por quê)

### ❌ Netlify no lugar da Vercel — é downgrade, não economia

- **Timeout de 10 s** em functions nos planos Free e Pro. Os passos do cron (`step=chunk` varre
  15 páginas, `step=sales` busca catálogos inteiros) e o proxy `/api/live` estouram isso. Hoje
  na Vercel o teto é 60 s — e o `--max-time 120` em `.github/workflows/refresh.yml` mostra que
  algumas chamadas já são longas.
- O free tier virou **crédito** em 2026: 300 créditos/mês a 20 créditos/GB de banda ≈ **~15 GB**,
  contra 100 GB da Vercel.

### ❌ Neon sozinho no lugar do Supabase — retrabalho máximo, teto igual

- Free: **0,5 GB por projeto** — o mesmo teto do Supabase, e pior no comportamento: passando do
  limite, **INSERT/UPDATE/DELETE falham** até liberar espaço. O Supabase ao menos continua
  servindo leitura.
- Free: **100 CU-horas/projeto**, autosuspend após 5 min ocioso. O cron segura o compute
  acordado por dezenas de minutos, 4×/dia — chega perto do limite sem folga.
- Neon entrega **só Postgres**. Ainda sobraria substituir Auth e Storage e reescrever as 76
  chamadas PostgREST para SQL.

Paga-se o custo integral da reescrita e continua-se num free tier de 0,5 GB. Se for pagar esse
custo, o banco vai para o VPS da Fase 2.

## O que fica como está

- **Cron no GitHub Actions** — gratuito e adequado.
- **IA (Anthropic/Gemini)** — já é pay-per-use com Batches API (~50% mais barato) e failover
  entre provedores. Nada a economizar sem perder função.
- **Vercel Hobby** — para um usuário só, os tetos (100 GB transfer, 1 M invocações, 4 CPU-horas)
  estão longe. Uso é pessoal e não comercial. O único ponto de atenção é o **teto de 60 s por
  função**; se aparecer timeout, a saída é diminuir `size`/`max` dos chunks no workflow, não
  trocar de plataforma.

## Limites vigentes (verificados em 2026-09-14)

| Plataforma | Free tier |
|---|---|
| Supabase | 500 MB banco · 1 GB storage · 5 GB egress · pausa após 1 semana sem requisição (o cron 4×/dia evita) · sem backup |
| Vercel Hobby | 100 GB transfer · 1 M invocações · 4 CPU-horas · 6.000 min de build · **60 s por função** · uso não comercial |
| Netlify | ~15 GB de banda (300 créditos a 20/GB) · **10 s por função** |
| Neon | 0,5 GB por projeto (escrita falha ao estourar) · 100 CU-horas · autosuspend em 5 min |

Preços de VPS mudaram em 2026 (dois reajustes da Hetzner): ver tabela na Fase 2.

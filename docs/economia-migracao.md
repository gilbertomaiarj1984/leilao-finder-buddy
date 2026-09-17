# Economia de infraestrutura — decisão e alternativas descartadas

> Índice e memória da decisão. O app é de **um único usuário** (`src/lib/access.server.ts` libera
> um e-mail Google). Orçamento alvo: ~US$ 5/mês.
>
> ⚠️ **Revisado em v0.48.2** com a telemetria real. A v0.48.1 mirava o tamanho do banco — alvo
> errado. Ver "Correção de rota" abaixo.

## Telemetria (30 dias, set/2026) — o que realmente dói

| Medidor | Uso | Situação |
| --- | --- | --- |
| **Supabase — Egress** | **9,14 / 5 GB** | 🔴 **já estourado (183%)** |
| **Vercel — Fluid Active CPU** | **3h09 / 4h** | 🟠 79% |
| Vercel — Fast Origin Transfer | 6,34 / 10 GB | 63% |
| Vercel — Provisioned Memory | 111 / 360 GB-Hrs | 31% |
| Supabase — Database size | **49 / 500 MB** | 🟢 10% |
| Supabase — MAU | 1 / 50.000 | 🟢 |
| Supabase — File storage | 0 / 1 GB | 🟢 |
| Vercel — Edge Requests · Invocations · Data Transfer | 44K/1M · 41K/1M · 4,18/100 GB | 🟢 ~4% |
| Vercel — Deployment / Functions Storage | 238 MB/10 GB · 199 MB/10 GB | 🟢 |

**Leitura:** o banco é pequeno (49 MB) e o tráfego para o usuário é irrisório. O que está caro é
**ler os mesmos dados muitas vezes** — 49 MB saindo ~190× por mês. Isso aparece nos dois medidores
apertados ao mesmo tempo: egress no Supabase, CPU na Vercel.

## Documentos

| Fase | Documento | Custo | Status |
|---|---|---|---|
| 1 | [Cortar egress e Active CPU](./economia-fase-1-egress-e-cpu.md) | US$ 0 | **feita em código** (v0.48.4, v0.60.1–v0.60.4) — falta remedir |
| 2 | [VPS único](./economia-fase-2-vps-unico.md) | R$ 27,89/mês | **plano fechado, execução não iniciada** |

A Fase 1 entrou em código mas o "passo 5 — medir de novo" nunca foi executado, e o usuário
reporta que o estouro persiste. A **Fase 2 foi aprovada em 2026-09-17**: VPS HostGator em São Paulo
(1 vCPU / 2 GB, 13 ms de latência) por R$ 27,89/mês, migração completa (Postgres, Auth e Storage)
em fases reversíveis, com shim `postgres.js` preservando o nome `supabaseAdmin`, numa branch
`vps` paralela — a `main` fica intocada na Vercel até o cutover. Plano executável completo no documento da Fase 2.

## Causa raiz

`reidentifyAllSales()` (`src/lib/lot-sales.server.ts:511`) carrega `lot_sales` **inteira** (com
`orig_text`) e `lot_ident` **inteira** a cada chamada, para processar 25 linhas. O workflow chama
isso em laço de até 60× por execução, 4×/dia (`.github/workflows/refresh.yml:120`). Detalhe e
correção na Fase 1.

Secundário: `getVinylSales` (`src/lib/leiloesbr.functions.ts:542`) devolve o histórico inteiro ao
navegador a cada abertura do Vinil Analytics.

## O que o app usa do Supabase

| Recurso | Uso real | Onde |
|---|---|---|
| Postgres | 11 tabelas, 76 chamadas via PostgREST | 11 arquivos `src/lib/*.server.ts` |
| Auth | Google OAuth (PKCE), 1 e-mail autorizado | `src/routes/auth.tsx`, `src/integrations/supabase/auth-middleware.ts` |
| Storage | 1 bucket público (`collection`) | `src/lib/collection.server.ts:936` |
| Edge Functions | **nenhuma** | — |
| Realtime | **nenhum** | — |

RLS ligada **sem nenhuma policy** (0 `CREATE POLICY` em `supabase/setup.sql`) e `anon`/
`authenticated` com `REVOKE ALL`. O navegador nunca consulta o Postgres — todo acesso a dado passa
pelo servidor com `service_role`.

## Alternativas descartadas (e por quê)

### ❌ Netlify no lugar da Vercel — é downgrade, não economia

- **Timeout de 10 s** em functions (Free e Pro). Os steps do cron e o proxy `/api/live` estouram
  isso; na Vercel o teto é 60 s.
- Free tier virou **crédito** em 2026: ~15 GB de banda contra 100 GB da Vercel.
- Confirmado na prática: o projeto Netlify conectado ao repo falha o deploy em todo PR.

### ❌ Neon sozinho no lugar do Supabase — não resolve o medidor que dói

- O problema é **egress**, não armazenamento. O Neon Free cobra por **CU-horas** (100/projeto) —
  o mesmo padrão de leitura repetida queima compute lá do mesmo jeito.
- Storage free é **0,5 GB por projeto**, e passando do limite a **escrita falha**. Mas com 49 MB
  isso nunca foi o gargalo.
- Entrega só Postgres: sobraria substituir Auth e Storage e reescrever 76 chamadas PostgREST.

## O que fica como está

- **Cron no GitHub Actions** — gratuito. O que muda é o **tamanho dos laços**, não a plataforma.
- **IA (Anthropic/Gemini)** — pay-per-use com Batches API (~50% mais barato) e failover.
- **Vercel Hobby** — depois da Fase 1, o Active CPU deve cair bem abaixo dos 79%. Uso é pessoal,
  não comercial. Atenção permanente ao teto de **60 s por função**.

## Correção de rota (v0.48.1 → v0.48.2)

A v0.48.1 concluiu, a partir da leitura do schema, que o risco era o banco encostar nos 500 MB, e
propunha faxina de linhas órfãs. A telemetria mostrou **49 MB (10%)** — a faxina resolvia algo que
não doía — e revelou os dois medidores que realmente apertam. A afirmação de que "os tetos da
Vercel estão longe" também estava errada: Active CPU em 79%.

O achado das órfãs continua válido (não há FK nem `CASCADE` no schema), mas foi rebaixado a item
secundário dentro da Fase 1.

**Lição:** schema mostra o que *pode* crescer; só telemetria mostra o que *está* doendo. Pedir os
painéis de uso antes de planejar.

## Limites vigentes (verificados em 2026-09-14)

| Plataforma | Free tier |
|---|---|
| Supabase | 500 MB banco · 1 GB storage · **5 GB egress** · pausa após 1 semana sem requisição (o cron 4×/dia evita) · sem backup |
| Vercel Hobby | 100 GB transfer · 1 M invocações · **4 CPU-horas** · 6.000 min de build · **60 s por função** · uso não comercial |
| Netlify | ~15 GB de banda (300 créditos a 20/GB) · **10 s por função** |
| Neon | 0,5 GB por projeto (escrita falha ao estourar) · 100 CU-horas · autosuspend em 5 min |

Preços de VPS mudaram em 2026 (dois reajustes da Hetzner): ver tabela na Fase 2.

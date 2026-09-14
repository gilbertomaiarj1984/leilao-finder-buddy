# Fase 2 — Escape hatch: um VPS único (~US$ 4/mês)

> **Status: não iniciada — e só deve começar se a Fase 1 provar que precisa.**
> Pré-requisito: `docs/economia-fase-1-faxina-e-medicao.md` executada e o `step=usage`
> mostrando crescimento que a faxina não segura.
>
> Contexto e alternativas descartadas: `docs/economia-migracao.md`.

## Por que assim (e não Neon/Netlify)

Sair do Supabase custa reescrever a camada de dados **de qualquer jeito** — o Neon entrega só
Postgres, com o mesmo teto de 0,5 GB, e ainda deixa Auth e Storage para resolver. Se o custo
da reescrita é inevitável, vale pôr o banco no servidor que você já está pagando: teto fixo,
sem egress medido, sem pausa por inatividade, sem cláusula de uso comercial. Uma conta só.

## A boa notícia

**Trocar de host já é uma variável de ambiente.** `vite.config.ts:9` já honra
`SERVER_PRESET` / `NITRO_PRESET`:

```ts
const preset = process.env.SERVER_PRESET ?? process.env.NITRO_PRESET;
```

`SERVER_PRESET=node-server` gera um servidor Node **sem tocar em código**.

Isso permite um caminho intermediário, se um dia só a Vercel incomodar: **mover apenas o host,
mantendo Supabase intacto**. Zero mudança de código, ~US$ 4/mês, e o banco/auth/storage seguem
como estão.

## Onde hospedar

| Provedor | Preço | Specs |
|---|---|---|
| Netcup | ~€ 3,35/mês | 2 vCPU / 2 GB / 64 GB SSD |
| Contabo | ~€ 4,50/mês | 4 vCPU / 6 GB / 100 GB NVMe |

A Hetzner **saiu do orçamento** nos reajustes de 2026: o CX22 foi descontinuado e o CAX11
subiu para € 5,99/mês.

## Arquitetura alvo

Docker Compose numa máquina só:

- **Caddy** — TLS automático, reverse proxy, e serve as imagens da coleção
- **app** — Node (`SERVER_PRESET=node-server`)
- **postgres** — Postgres 17
- **volume** — imagens da coleção

## O trabalho, peça por peça

### Dados — `supabaseAdmin` → `postgres.js`

**76 call sites em 11 arquivos**, mas concentrados — `app-state.server.ts` (25) e
`collection.server.ts` (13) são metade do trabalho:

| Arquivo | `.from(` |
|---|---|
| `src/lib/app-state.server.ts` | 25 |
| `src/lib/collection.server.ts` | 13 |
| `src/lib/wantlist.server.ts` | 5 |
| `src/lib/lot-sales.server.ts` | 4 |
| `src/lib/leiloesbr-scrape.server.ts` | 4 |
| `src/lib/lot-market.server.ts` | 3 |
| `src/lib/lot-ai.server.ts` | 3 |
| `src/lib/leiloesbr-auctions.server.ts` | 3 |
| `src/lib/lot-ident.server.ts` | 2 |
| `src/lib/lot-condition.server.ts` | 2 |
| `src/lib/known-artists.server.ts` | 1 |

Simplificador importante: **RLS está ligada sem nenhuma policy** e `anon`/`authenticated` têm
`REVOKE ALL` (`supabase/setup.sql`). O navegador **nunca** consulta o Postgres — todo acesso a
dado já passa pelo servidor com `service_role`. Ou seja, a migração é **100% server-side**,
nenhum componente de UI precisa mudar.

O schema também é simples: 11 tabelas, sem FK, sem pgvector, sem pg_cron, sem Realtime, sem
Edge Functions. Um `pg_dump`/`pg_restore` resolve a carga inicial.

### Auth — GoTrue → OAuth Google direto

O app libera **exatamente um e-mail** (`src/lib/access.server.ts`). Não precisa de um serviço
de auth: OAuth Google direto + cookie HttpOnly assinado resolve.

Some: `src/integrations/supabase/auth-middleware.ts`, `src/integrations/supabase/auth-attacher.ts`,
`src/integrations/supabase/api-fetch.ts`, e o import de `supabase` em `src/routes/auth.tsx`,
`src/routes/__root.tsx`, `src/routes/_authenticated/route.tsx` e `src/routes/_authenticated/index.tsx`.

O middleware global fica registrado em `src/start.ts` — ajustar lá também.

### Storage — bucket → disco

Um bucket público e pequeno (`collection`, usado em `src/lib/collection.server.ts:936-943`).
Vira um diretório no volume, servido pelo Caddy. Alternativa: Cloudflare R2 (free 10 GB).

### Backup — ganho líquido

`pg_dump` noturno para Cloudflare R2 (free 10 GB). O Supabase Free **não dá backup nenhum**
hoje, então isto melhora a situação em vez de piorar.

### Cron — não mexer

`.github/workflows/refresh.yml` continua chamando `/api/cron` por HTTP com `CRON_TOKEN`. Só
muda o `APP_URL` (secret do repositório). O GitHub Actions é gratuito e adequado.

## Ordem sugerida

1. Subir o VPS com Caddy + Postgres, restaurar um `pg_dump` do Supabase, validar o schema.
2. Migrar a camada de dados para `postgres.js` **ainda rodando na Vercel**, apontando para o
   Postgres do VPS. Testar tudo com o front atual.
3. Migrar auth e storage.
4. Só então mover o host (`SERVER_PRESET=node-server`) e apontar o DNS.
5. Desligar o projeto Supabase depois de uma semana estável.

Cada passo é reversível sozinho — evita um big bang.

## Lembretes do projeto (AGENTS.md)

- Bump de versão em `src/lib/version.ts` **e** `package.json` a cada PR (CI `version-bump.yml`).
- Atualizar `docs/notas-desenvolvimento.md` antes de mesclar — esta migração muda arquitetura,
  então a seção correspondente precisa ser reescrita.
- `.env.example`, `README.md` e `AGENTS.md` descrevem Supabase + Vercel: atualizar.

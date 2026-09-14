# Fase 1 — Faxina do banco e medição de uso

> **Status: não iniciada.** Documento de execução autossuficiente — uma sessão futura deve
> conseguir executar só com isto + o código. Custo: US$ 0. Esforço: pequeno.
>
> Contexto e alternativas descartadas: `docs/economia-migracao.md`.

## Por que

O app roda em Supabase Free (500 MB de banco) + Vercel Hobby. Nada estourou ainda — isto é
preventivo. A investigação mostrou que **o risco real não é a plataforma, é um vazamento de
linhas órfãs no schema**. Consertar isso provavelmente devolve a maior parte dos 500 MB e
adia (ou elimina) qualquer necessidade de migrar.

## O problema, em concreto

`supabase/setup.sql` não tem **nenhum** `REFERENCES` nem `ON DELETE CASCADE`. Consequência:

- `lots` **já é podada** por janela de dias — `pruneOutOfWindow()` em
  `src/lib/leiloesbr-scrape.server.ts:195`, chamada nas linhas 480 e 581.
- Mas `lot_ai`, `lot_ident`, `lot_market` e `lot_condition` são caches com chave de lote que
  **nunca são podados**. Quando o lote sai da janela, essas linhas viram **órfãs permanentes**
  e se acumulam para sempre.
- `lot_sales` cresce sem teto e carrega `orig_text` (descritivo completo do catálogo, texto
  longo, uma cópia por venda) — o maior consumidor por linha da base.
- `seen_auctions` também só cresce.

**Verificação já feita:** cada módulo `src/lib/lot-*.server.ts` só toca a própria tabela
(`lot-ident` → `lot_ident`, `lot-ai` → `lot_ai`, etc). Os quatro caches são **independentes
de `lot_sales`**, então podá-los **não perde histórico de vendas**.

## O que fazer

### 1. Passo `usage` no cron (medir antes de mexer)

Em `src/lib/cron.server.ts`, adicionar `step=usage` seguindo o padrão dos steps existentes
(já protegidos por `CRON_TOKEN` via header `x-cron-token`; ver `handleCron()`).

Deve retornar: `pg_database_size`, `pg_total_relation_size` por tabela, contagem de linhas por
tabela e tamanho do bucket `collection`.

⚠️ O `supabase-js` não executa SQL cru. Exponha via função SQL no `supabase/setup.sql` chamada
com `.rpc()`. **Hoje não existe nenhum `.rpc()` no projeto** — este será o primeiro; lembre de
adicionar a assinatura em `src/integrations/supabase/types.ts` (bloco `Functions`).

### 2. Passo `prune` no cron

No mesmo arquivo, apagando:

- órfãos de `lot_ai` / `lot_ident` / `lot_market` / `lot_condition` sem `lots` correspondente;
- `seen_auctions` além de uma janela de retenção (definir; sugestão: 12 meses);
- opcional: zerar `lot_sales.orig_text` em vendas com mais de N meses — mantém os campos
  estruturados (`sold_price`, `media`, `sleeve`, `views`, `bids`, `fee_pct`), que é o que a UI
  usa. Conferir antes se nada relê `orig_text` depois da captura.

Deve ser **idempotente** e reportar quantas linhas saíram por tabela.

### 3. Prevenir a reincidência

Nova migration em `supabase/migrations/` (+ refletir em `supabase/setup.sql`):

1. Limpar os órfãos existentes primeiro (senão a FK não pode ser criada).
2. Adicionar FK `ON DELETE CASCADE` de `lot_ai`, `lot_ident`, `lot_market` e `lot_condition`
   para `lots(id)`.

A partir daí o `pruneOutOfWindow()` que **já existe** passa a limpar os caches sozinho.

> ❗ **Não** cascatear `lot_sales` para `lots`. `lot_sales` é o arquivo permanente de vendas e
> precisa sobreviver à poda de `lots` — cascatear apagaria o histórico inteiro.

### 4. Plugar no workflow

Em `.github/workflows/refresh.yml`: chamar `step=prune` uma vez por run e `step=usage` no fim,
imprimindo o tamanho no log. Isso vira o **termômetro** que decide se a Fase 2 algum dia
precisa acontecer.

## Arquivos

- `src/lib/cron.server.ts` — steps `usage` e `prune`
- `supabase/setup.sql` + nova migration em `supabase/migrations/`
- `src/integrations/supabase/types.ts` — tipo da função RPC
- `.github/workflows/refresh.yml` — chamadas novas

## Verificação

1. `bun run build` e `bun run lint` passam.
2. Com `.env` apontando para o Supabase, subir `bun run dev` e:
   `curl -H "x-cron-token: $CRON_TOKEN" 'http://localhost:3000/api/cron?step=usage'`
   → devolve tamanhos por tabela.
3. Anotar o tamanho → rodar `step=prune` → rodar `step=usage` de novo. Confirmar a queda e
   quantas linhas órfãs saíram.
4. Conferir que **`lot_sales` não perdeu linhas** e que `/analise`, `/colecao` e
   `/vinil-analytics` continuam carregando.
5. Rodar `step=prune` uma segunda vez → deve reportar ~0 órfãos (idempotente).
6. Disparar o workflow manualmente (`workflow_dispatch`) e ver o tamanho impresso no log.

## Lembretes do projeto (AGENTS.md)

- Bump de versão em `src/lib/version.ts` **e** `package.json` — o CI `version-bump.yml` falha
  o PR sem isso. Versão no título do PR.
- Atualizar `docs/notas-desenvolvimento.md` antes de mesclar.
- Recriar a branch a partir de `origin/main` antes de começar.

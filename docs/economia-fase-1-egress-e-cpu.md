# Fase 1 — Cortar egress do Supabase e Active CPU da Vercel

> **Status: não iniciada.** Documento de execução autossuficiente. Custo: US$ 0.
> Contexto e alternativas descartadas: `docs/economia-migracao.md`.
>
> ⚠️ Este documento foi **reescrito em v0.48.2** depois que a telemetria real chegou. A versão
> anterior (v0.48.1) mirava o tamanho do banco — alvo errado, ver "O que mudou" no fim.

## Por que

Telemetria de 30 dias (set/2026):

| Medidor | Uso | Situação |
| --- | --- | --- |
| **Supabase — Egress** | **9,14 / 5 GB** | 🔴 **já estourado (183%)** |
| **Vercel — Fluid Active CPU** | **3h09 / 4h** | 🟠 79% |
| Vercel — Fast Origin Transfer | 6,34 / 10 GB | 63% |
| Vercel — Provisioned Memory | 111 / 360 GB-Hrs | 31% |
| Supabase — Database size | **49 / 500 MB** | 🟢 10% |
| Supabase — MAU | 1 / 50.000 | 🟢 |
| Supabase — File storage | 0 / 1 GB | 🟢 |
| Vercel — Edge Requests / Invocations / Data Transfer | 44K/1M · 41K/1M · 4,18/100 GB | 🟢 ~4% |

Ou seja: **o banco não é o problema — o padrão de leitura é.** 49 MB de dados gerando 9 GB de
saída significa que os mesmos bytes saem do Postgres cerca de 190 vezes por mês.

## A causa raiz (uma só, explica os dois medidores vermelhos)

`reidentifyAllSales()` — `src/lib/lot-sales.server.ts:511` — carrega **duas tabelas inteiras a
cada chamada** para processar apenas `max` linhas (padrão 25):

```ts
const [allSales, identRows] = await Promise.all([
  getAllLotSales(),      // lot_sales INTEIRA, incluindo orig_text
  getAllLotIdent(),      // lot_ident INTEIRA
]);
```

- `getAllLotSales()` (`lot-sales.server.ts:65`) pagina de 1000 em 1000 até o fim da tabela, com
  `orig_text` (o descritivo completo do catálogo, o campo mais pesado por linha).
- `getAllLotIdent()` (`lot-ident.server.ts:21`) faz o mesmo em `lot_ident`.

E o workflow chama isso em laço — `.github/workflows/refresh.yml:120`:

```yaml
for i in $(seq 1 60); do
  res="$(call "/api/cron?step=reident&max=25")"
```

**Leitura O(tabela inteira) para O(25) de trabalho, até 60× por execução, 4×/dia.** Mesmo num dia
sem venda nova, a primeira chamada ainda baixa tudo só para descobrir que não há o que fazer.

Isso é simultaneamente:
- o **egress** do Supabase (~78 MB por execução de cron);
- o **Active CPU** da Vercel (desserializar megabytes de JSON dentro da função, dezenas de vezes).

### Vazamento secundário

`getVinylSales` (`src/lib/leiloesbr.functions.ts:542`) devolve o histórico **inteiro** ao
navegador a cada abertura do Vinil Analytics — mais egress do Supabase e mais Origin Transfer
da Vercel.

### Verificar também

Os outros steps do cron que rodam em laço longo (`market` 30×, `condition` 40×, `sales` 40×) —
conferir se algum repete o mesmo padrão de "ler tudo para trabalhar pouco".

## O que fazer

### 1. Filtrar no banco, não no Node (o grosso do ganho)

`reidentifyAllSales` deve pedir **só as vendas ainda não identificadas**, com `limit(max)`, em vez
de baixar tudo e filtrar em memória. Com PostgREST isso pede um anti-join (`lot_sales` sem linha
correspondente em `lot_ident`) — o caminho limpo é uma **função SQL** chamada via `.rpc()`, ou uma
view. Hoje não existe nenhum `.rpc()` no projeto; ao criar, adicionar a assinatura em
`src/integrations/supabase/types.ts` (bloco `Functions`).

O `getAllLotSales()` já aceita pedir sem `orig_text` (flag `withOrig`, linha 69) — usar o caminho
magro em quem não precisa do texto.

### 2. Não baixar a tabela só para descobrir que não há trabalho

Antes do laço, uma contagem barata (`head: true, count: "exact"`) decide se há algo a fazer. Se
não houver, o step retorna `done: true` sem ler linha nenhuma.

### 3. Encolher o laço do workflow

60 iterações para um passo que converge em poucas é desperdício puro mesmo depois da correção.
Reduzir e deixar o resto para a execução seguinte — o passo já é incremental por design.

### 4. Paginar/agregar o Vinil Analytics

`getVinylSales` não deve devolver o histórico inteiro ao browser. Agregar no servidor, ou paginar.

### 5. Só então: medir de novo

Manter um `step=usage` (contagens + `pg_database_size`) ajuda, mas o número que importa agora é o
**egress no painel do Supabase** e o **Active CPU no da Vercel** — reconferir lá depois de uma
semana rodando com a correção.

## Arquivos

- `src/lib/lot-sales.server.ts` — `reidentifyAllSales`, `getAllLotSales`
- `src/lib/lot-ident.server.ts` — `getAllLotIdent`
- `src/lib/leiloesbr.functions.ts` — `getVinylSales`
- `src/lib/cron.server.ts` — short-circuit dos steps sem trabalho
- `.github/workflows/refresh.yml` — contagem dos laços
- `supabase/setup.sql` + migration — função SQL do anti-join
- `src/integrations/supabase/types.ts` — assinatura da RPC

## Verificação

1. `bun run build` e `bun run lint` passam.
2. Anotar o egress atual no painel do Supabase e o Active CPU no da Vercel.
3. Rodar o cron manualmente (`workflow_dispatch`) **uma vez** e comparar o egress antes/depois:
   a diferença é o custo de uma execução. Antes da correção deve dar dezenas de MB; depois,
   ordem de grandeza menor.
4. Conferir que a reidentificação **continua identificando as mesmas vendas** — a correção é de
   desempenho, não pode mudar resultado. Comparar `identified`/`applied` de uma rodada antes e
   depois numa base igual.
5. `/vinil-analytics` continua carregando e com os mesmos números.
6. Depois de ~1 semana, reconferir os dois painéis.

## Faxina de órfãos (agora é item menor, não urgente)

Continua verdade que `supabase/setup.sql` não tem **nenhum** `REFERENCES` nem `ON DELETE CASCADE`,
e que `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` acumulam órfãos quando `lots` é podada por
janela (`pruneOutOfWindow`, `src/lib/leiloesbr-scrape.server.ts:195`). Com o banco em 49/500 MB
isso **não é urgente** — mas vale fazer junto, porque linha órfã em `lot_ident` também é linha
lida à toa pelo anti-join acima.

Ao fazer: limpar os órfãos, depois criar as FKs com `ON DELETE CASCADE` para `lots(id)`.
⚠️ **Nunca** cascatear `lot_sales` → `lots`: é o arquivo permanente de vendas e precisa sobreviver
à poda de `lots`.

## O que mudou em relação à v0.48.1

A primeira versão deste plano concluiu que o risco era o banco encostar em 500 MB, e propunha
faxina de órfãos + medição de tamanho. A telemetria mostrou que **o banco está em 10% do limite** e
que os medidores apertados são outros (egress do Supabase, já estourado; Active CPU da Vercel, em
79%). O diagnóstico de "Vercel Hobby está longe dos tetos", na v0.48.1, também estava errado.

Lição: a conclusão anterior veio de ler o schema sem olhar a telemetria. Schema explica o que
*pode* crescer; só a medição diz o que *está* doendo.

## Lembretes do projeto (AGENTS.md)

- Bump de versão em `src/lib/version.ts` **e** `package.json` — o CI `version-bump.yml` falha o PR
  sem isso. Versão no título do PR.
- Atualizar `docs/notas-desenvolvimento.md` antes de mesclar.
- Recriar a branch a partir de `origin/main` antes de começar.

# Grading Disco × Capa e estado pré-leilão (`lot_condition`)

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Grading de estado — Disco × Capa (`grading.ts`, v0.29.0)

Módulo **puro/client-safe** `src/lib/grading.ts` — fonte única da conservação, sem rede nem
imports de servidor. Consumido pelo card do lote, pela Coleção e (nas fases seguintes) pelo
enriquecimento no servidor e pelo Vinil Analytics.

- **Escala canônica de 10 graus** (melhor→pior): `M, NM, EX, VG+, VG, VG-, G+, G, G-, F/P`
  (`GRADE_ORDER`), com score-base (`GRADE_SCORES`, M=100…F/P=0). Sinônimos: `M-`≈NM, `VG++`≈EX
  e palavras (Mint/Lacrado, Near Mint, Excelente, Muito Bom, Bom, Regular, Fair/Poor).
- **Score Final** = matriz fixa **Disco × Capa** (`scoreCondition`; diagonal = score-base; um
  lado só → score-base desse lado; nenhum → null) e **Faixas de Classificação** (`FAIXAS`:
  90–100 Colecionador · 75–89 Excelente · 60–74 Muito Bom · 45–59 Aceitável · 30–44 Abaixo da
  Média · 0–29 Muito Danificado; `faixaFromScore`).
- **Extração do texto** (`parseConditionFromText`, determinística): rótulos `Disco/Mídia/Vinil`
  e `Capa/Sleeve`; rótulo geral `Estado/Conservação` aplica aos dois; palavra de item inteiro
  (Lacrado/Mint) → ambos; senão uma única sigla forte solta → Disco. **Nunca inventa** →
  `source: 'indefinido'`. Encarte: `detectInsert` (`sem encarte` vence `encarte`).
- **UI:** componente compartilhado `ConditionBadges` (`condition-badges.tsx`) no padrão de pill
  do app; pill de Faixa/Score colorida por `scoreTone`. No `LotCard` o estado é **derivado do
  título** nesta fase (prop `condition`, resolver `conditionFor` na home); no `CollectionCard`
  a Faixa/Score sai de `scoreCondition(normalizeGrade(midia), normalizeGrade(capa))`.
- **Coleção alinhada aos 10 graus:** `toGrade` (`collection-bulk.ts`) usa `normalizeGrade`; o
  `Select` de mídia/capa (`colecao.tsx`) mapeia `GRADE_ORDER`; o prompt de import lista os 10.
- **De onde vem o estado:** o **descritivo completo** do lote está no **tooltip** do card do
  catálogo (atributo `title`/`alt`/`data-*`) — ver "Estrutura do card do catálogo" em `vendas-e-analytics.md`. Logo o
  estado rico (Disco/Capa) sai do **catálogo** (1 req/leilão) SEM abrir a `peca.asp` lote a lote.
  Isso alimenta tanto o histórico de vendas (`lot_sales`, v0.30.0) quanto o cache de estado dos
  cards **pré-leilão** (`lot_condition`, v0.32.0). Depois a página **Vinil Analytics** agrega por
  artista→álbum sobre o histórico.

## Estado dos lotes pré-leilão — `lot_condition` (v0.32.0)

Cache de estado (Disco/Capa) por lote para os **cards pré-leilão**, alimentado pelo **catálogo**
(o descritivo do tooltip), sem `peca.asp` lote a lote. Espelha `lot_ident`/`lot_market`.

- **Enriquecimento:** `enrichConditions` (`lot-condition.server.ts`) lê a janela (`scrapeVinylLots`),
  seleciona os lotes SEM linha em `lot_condition` (ou com `title_hash` mudado), agrupa por leilão,
  busca `fetchCatalogData` (1 req/leilão, até `max` por rodada) e parseia o descritivo do card;
  fallback ao título quando o catálogo não traz o estado. Grava linha para **todos** os lotes
  processados (mesmo `indefinido`, marcando `source` = `catalog`/`title`/`indefinido`) para não
  reprocessar à toa; drena por rodadas. Cron `step=condition` (`cron.server.ts` + `refresh.yml`).
- **UI:** server fn `getLotCondition` (query `["lot-condition"]`); no `VinylDashboard`
  (`index.tsx`) o resolver `conditionFor` passa a **priorizar o cache** (`conditionById`,
  reconstruído com `scoreCondition`) e cai no parse do título quando não há linha. O badge
  `ConditionBadges` no `LotCard` é o mesmo — agora com estado mais rico.
- **Cobertura:** preenche ao longo das rodadas do cron, como IA/mercado; casas fora do padrão de
  catálogo simplesmente ficam `indefinido`.

# Exclusão de lotes (`excluded_lots`) e "possível lixo"

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Exclusão de lotes — `excluded_lots` (v0.72.0)

- **Objetivo:** o usuário exclui manualmente um lote "lixo" (ex.: joia, item que escapou do
  filtro de vinil) e ele **nunca mais volta**, mesmo em varreduras futuras do cron — e o sistema
  **aprende** os termos do título para sinalizar (nunca esconder sozinho) lotes futuros
  parecidos como "possível lixo".
- **DELETE físico, sem desfazer** — diferente do padrão "soft-hide via `app_state`" usado pelo
  Analytics (`analytics_excluded_sales`/`analytics_excluded_artists`) ou pelo aprendizado da
  Coleção (`collection_feedback`): aqui o lote é APAGADO de `lots` de verdade
  (`excludeLot`, `src/lib/lot-exclusion.server.ts`) — `ON DELETE CASCADE` já existente limpa
  `lot_ai`/`lot_ident`/`lot_market`/`lot_condition` junto (mesmas FKs da Fase 5 da migração
  VPS). Reverter exigiria re-raspar o site; não há botão de "desfazer" nesta versão.
- **Tabela `excluded_lots`** (`supabase/setup.sql` +
  `supabase/migrations/20260922000000_excluded_lots.sql`): `id` é a MESMA PK de `lots.id`
  (histórico — a linha sobrevive ao lote já apagado, mesma razão de `lot_sales` nunca cascatear
  com `lots`), `title`/`house`/`artist` (snapshot no momento da exclusão), `reason` (opcional,
  do usuário), `keywords text[]` (extraídas do título, ver abaixo), `excluded_by`, `excluded_at`.
- **Bloqueio de reinserção pelo cron:** `persistLots` (`leiloesbr-scrape.server.ts`) filtra os
  lotes frescos contra `getExcludedLotIds()` (1 query best-effort — nunca lança, um erro aqui só
  falha em não filtrar nada) ANTES do upsert. Mesmo princípio dos outros prune
  (`pruneOutOfWindow`/`pruneNonVinylLots`), mas aplicado na ENTRADA em vez de limpeza posterior.
- **"Possível lixo" — heurística por palavras-chave, SEM IA** (`src/lib/lot-exclusion.ts`,
  módulo puro/client-safe, mesmo padrão de `grading.ts`/`wantlist-match.ts`):
  `extractKeywords(title, artist)` normaliza (`normalizeForMatch`, de `vinyl-parse.ts`), remove
  stopwords em PT + termos genéricos de catálogo ("disco", "vinil", "lote", "capa"...) e o
  próprio artista (evita falso positivo por nome comum); `matchPossibleTrash` compara por
  OVERLAP DE CONTAGEM (não percentual, `MIN_OVERLAP=2`) contra os lotes já excluídos — o
  primeiro casamento vira o sinal (`{ matchedTerms, excludedTitle }`).
- **Reescrita v0.87.0 — o MOTIVO de ser lixo, não as palavras em comum:** a regra acima (2
  palavras quaisquer em comum) casava por CONTEÚDO — excluir um "DVD Fulano Ao Vivo Show"
  marcava todo "LP Beltrano Ao Vivo Show", sem DVD nenhum. Agora `buildTrashModel` reduz cada
  lote excluído ao motivo e `matchPossibleTrash(perfil, modelo)` compara em três camadas:
  1. **Motivo digitado ao excluir** (`excluded_lots.reason`, agora lido por
     `getAllExcludedLots`): `reasonPhrases` separa por vírgula/";"/"/"/" ou " e tira ruído
     ("não é vinil", "lixo", "item"…) — cada trecho ("máquina de costura", "kit de limpeza")
     vira uma expressão aprendida que sinaliza QUALQUER lote que a tenha no título (palavras em
     ordem, plural tolerado; vale até para lote com "vinil" no nome). Expressão presente em
     muitos lotes da listagem (ex.: "capa") é descartada por genérica. O `ExcludeLotDialog`
     explica isso no campo.
  2. **Indicador de tipo de objeto/formato** (`INDICATORS`: DVD, CD, blu-ray, VHS, K7, HQ,
     livro, boneco, relógio, toca-discos, aparelho de som, móvel, pôster, chaveiro, joia…) no
     título do excluído → só sinaliza lote com o MESMO indicador; lote com sinal forte de vinil
     (`hasStrongVinylSignal`, exportado de `vinyl-parse.ts`) exige ainda mais 1 termo raro em
     comum ("LP + DVD bônus" não basta).
  3. **Sem motivo nem indicador** → 2+ termos RAROS em comum, nunca contra lote claramente
     vinil quando o excluído não era.
  Termos do lote novo saem do casamento quando são CONTEÚDO: artista efetivo, álbum da IA e
  release do Discogs (`trashProfile({content})`), palavras de conteúdo (`CONTENT_WORDS`: "ao
  vivo", "show", "sucessos", estado…) e termos COMUNS na listagem atual (usados por ≥ 20 lotes
  e ≥ 3% dela — a própria listagem é o corpus). O `trash_keyword_denylist` (clique no badge)
  vale para os três tipos de termo (expressão, indicador, termo raro).
- **Calculado no CLIENTE, NÃO persistido:** `index.tsx` busca `getExcludedLotsForMatching`
  (`["excluded-lots"]`, `staleTime` 30 min) e monta `possibleTrashById` num `useMemo` a partir de
  `lots.data.lots` — mesmo padrão de `albumById`/`marketById`. Decisão deliberada: volume baixo
  (exclusão manual, 1 usuário), sem testes automatizados no projeto, evita decidir "quando
  recalcular" (a cada exclusão? a cada upsert do cron?) que uma tabela/coluna persistida exigiria.
- **UI:** botão de lixeira no `LotCard` (só aparece quando `onExclude` é passado — hoje só nas
  duas listagens de DESCOBERTA de lotes novos: busca com relevância e "por casa → artista";
  **não** nas abas Vigiados/Lances, que mostram lotes já em acompanhamento) abre
  `ExcludeLotDialog` (`components/vinyl/exclude-lot-dialog.tsx`, um diálogo só, controlado por
  estado no `index.tsx`, mesmo padrão do `OwnedPanel`) com motivo opcional. Sucesso remove o
  lote do cache de `["vinyl-lots"]` na hora (otimista) e invalida `["excluded-lots"]`. Badge
  "⚠ possível lixo" (laranja, com tooltip dos termos casados) fica na linha de badges do card,
  ao lado de demanda/condição — nunca esconde nada sozinho.
- **`setup.sql` reaplicado automaticamente a cada deploy:** esta PR também corrigiu a convenção
  antiga ("SQL Editor ou `psql -f`", resquício de quando o projeto era Supabase hospedado — não
  é mais, ver `infra.md`) — `deploy.yml` agora roda
  `docker compose exec postgres psql -f /docker-entrypoint-initdb.d/01-setup.sql` depois do
  `up -d`, em TODO push pra `main`/`vps` (idempotente, `IF NOT EXISTS`), então uma tabela/coluna
  nova em `setup.sql` já existe no próximo deploy sem passo manual. Ver "Restrições do ambiente"
  no topo deste documento.
  ⚠️ **Fix v0.72.1 — esse mesmo auto-apply quebrou o primeiro deploy em produção**: `setup.sql`
  ainda tinha `GRANT`/`REVOKE` para papéis (`anon`/`authenticated`/`service_role`) e um
  `INSERT INTO storage.buckets` herdados do Supabase hospedado, que nunca existiram de verdade
  no Postgres self-hosted da VPS — rodavam sem erro só porque o script nunca tinha sido
  executado de fato contra esse banco (o schema veio de `pg_restore`, não de `setup.sql`; ver
  "Infra" abaixo). Na primeira execução automática (`ON_ERROR_STOP=1`), o script travou no meio
  (`role "service_role" does not exist`), ANTES de chegar em `excluded_lots` — a tabela nunca
  foi criada, e a exclusão de lote falhava em produção com "relation excluded_lots does not
  exist". Corrigido: `CREATE ROLE IF NOT EXISTS` (idempotente) pra `anon`/`authenticated`/
  `service_role` logo no topo de `setup.sql` (só pra RLS não falhar — a conexão real do app
  ignora RLS por ser dona das tabelas) + removida a linha morta do Storage bucket (fotos da
  Coleção são arquivo em disco desde a Fase 5).
- **Badge "possível lixo" clicável → aprendizado por negação (v0.73.0):** clicar no badge diz
  "isto NÃO é lixo" — não precisa excluir nada nem existe mais um lote pra apontar (o casamento
  é por palavras-chave, não por id). O clique nega os TERMOS que causaram aquele casamento
  específico (`ExclusionSignal.matchedTerms`), não só aquele lote: `app_state` ganha a chave
  `trash_keyword_denylist` (array simples, mesmo padrão de `verified_houses`, só cresce — nunca
  esquece um termo já negado), via `getTrashKeywordDenylist`/`addTrashKeywordDenylist`
  (`app-state.server.ts`) e as server functions `getTrashKeywordDenylist`/`dismissPossibleTrash`
  (`lot-exclusion.functions.ts`). `matchPossibleTrash` (`lot-exclusion.ts`) ganhou um 3º
  parâmetro opcional `denylist: ReadonlySet<string>`, filtrado de AMBOS os lados (keywords do
  lote novo E do lote excluído) antes de contar o overlap — assim o termo negado deixa de gerar
  falso positivo em QUALQUER lote futuro, não só no que foi clicado (é isso que "melhora o
  modelo": a heurística fica mais precisa a cada correção, sem precisar reexcluir nada). UI:
  o badge vira `<button>` com "✕" quando `onDismissTrash` está presente (`LotCard`); clique
  chama `dismissTrashMutation` (`index.tsx`) com atualização OTIMISTA de
  `["trash-keyword-denylist"]` — o badge some da tela na hora, antes mesmo da resposta do
  servidor, e reverte com toast de erro se a gravação falhar.

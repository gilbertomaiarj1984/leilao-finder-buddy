# Sondagem — descontinuada (v0.149.0)

> Movido de `docs/areas/colecao-sondagem-compras.md` em 24/11/2026.

## Sondagem — DESCONTINUADA (v0.149.0); perfil do colecionador = De olho + interesses

- A **Sondagem** (`wantlist_items`: rascunho de obras caçadas, casamento por saco de palavras) foi
  **substituída pelo De olho** (`lookout_items`: artista + álbum + ano, confirmação ✓/✕, teto de preço,
  aviso externo). Removidos: diálogo da Sondagem, `wantlist.server/functions`, `wantlist-parse`, o
  casamento `scoreWant`/`bestWantForLot` (o resto de `wantlist-match.ts` — `lotIdentity`, `ownedScore`,
  `resolveOwned` — segue servindo a Coleção e o De olho). Na Análise, 🎯 e o filtro «Só De olho» usam
  o mesmo casamento do De olho (`matchLookoutForLot` + `buildLotIdentity`, só confiante ≥ 80% ou confirmado).
- **Migração concluída e removida (v0.151.0):** a v0.149.0 migrou as obras pela IA (`addLookoutFromText`; as
  adquiridas viraram itens `acquired`, a nota foi copiada) e a tabela `wantlist_items` foi apagada do banco e do
  `setup.sql`. O código da migração (`wantlist-migration.server.ts`, aviso em `/olho`) saiu junto. Resta só a linha
  `app_state.wantlist_migration` (progresso antigo, inofensiva; pode ser apagada).
- **Meus interesses** moveu para a página `/olho` (botão no cabeçalho). Interesses efetivos
  (`collector-profile.ts`, `useCollectorInterests`) = lista manual **∪ artistas dos discos de olho ativos**
  (somente leitura no diálogo, com «fixar» para copiar à lista manual). Vale para o ⭐ da home/Análise e
  para a IA. Perfil do colecionador = De olho + interesses (+ «já tenho» na Coleção, só para a IA).
- **IA:** bloco «Perfil do colecionador» (`perfil_do_colecionador`: `nos_meus_interesses`, `de_olho`,
  `teto_de_olho_brl`, `ja_tenho`) — só o RESULTADO do casamento do lote (`profileForLot`; De olho com
  `includeOrigin`, Coleção só automático ≥ 80%, sem as decisões manuais do usuário), nunca as listas.

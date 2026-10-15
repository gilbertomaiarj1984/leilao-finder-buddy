# Checklist — painel de IA, contexto do prompt e Discogs (v0.144.0)

Feito em 15/10/2026. O que já foi testado automaticamente e o que **só você consegue testar** (precisa
do LeilõesBR, do Discogs, da IA e do login Google reais, que o ambiente de desenvolvimento não alcança).

## Já testado (sem rede externa)

- `bun run check`: lint, typecheck, 212 testes de funções puras e knip.
- Postgres 16 real: `setup.sql` aplicado 2× (idempotente) e a migração nova; `tools/local-tests/integracao-banco.ts`
  (19 verificações: jsonb do sugerido por condição, backfill, leitura enxuta de `lot_ai`, painel em `app_state`,
  contexto lido do banco).
- Cadeia da avaliação com API falsa da Anthropic (`cadeia-ia.ts`, 19 verificações): o prompt leva estado, Discogs
  e frete do banco; a configuração do painel muda o prompt (blocos, ordem, campos, frete); o hash não muda sozinho;
  Batches congela o contexto; falha de contexto grava o hash com `x` e o lote volta para a fila.
- Painel no Chromium (`painel-e2e.mjs`, 42 verificações; `painel-mobile.mjs`): abas, arrastar e soltar, salvar,
  recarregar, restaurar padrão, modo da IA gravado, rodapé sem os seletores antigos, sem rolagem horizontal a 390 px.
- Passos do cron que não dependem de rede (`aieval`, `aiident`, `market`, `condition`, `tracklist`, `fame`, `prune`,
  `dailydigest`) respondem sem quebrar.

## 1. No deploy (VPS)

- [ ] O deploy aplica `supabase/setup.sql` sozinho. Conferir a coluna nova:
      `docker compose exec -T postgres psql -U garimpo -d garimpo -c "\d lot_market" | grep suggested_by_condition`
- [ ] Rodapé da tela inicial mostra a versão `v0.144.0`.
- [ ] Nenhuma variável de ambiente nova. `DISCOGS_TOKEN` e as chaves de IA continuam como estão.

## 2. Primeiras rodadas do cron (acompanhar o log do `refresh.yml`)

- [ ] `step=condition`: **todas as linhas de `lot_condition` serão relidas** (o hash agora leva a versão do leitor e
      as regras do painel): uma requisição por leilão da janela. Vai levar algumas rodadas.
- [ ] `step=aieval`: o hash da avaliação mudou, então a base será **reavaliada** (até 800 lotes por rodada; no modo
      «vigiados + lances» só esses). Há gasto de IA nesta primeira vez.
- [ ] `step=market`: preenche o sugerido por condição das linhas antigas (até 40 discos por chamada). Acompanhar:
      `SELECT count(*) FILTER (WHERE suggested_by_condition IS NULL AND matched) AS faltam, count(*) FILTER (WHERE suggested_by_condition IS NOT NULL) AS preenchidas FROM lot_market;`
      Esperado: `faltam` cai a cada execução. Discos já consultados NÃO são reconsultados (o `basis` antigo continua válido).
- [ ] No log do servidor, procurar `[discogs] página de venda bloqueada` (aparece uma vez, é esperado) e
      `[ai-context] falha ao ler o contexto` (não deveria aparecer; se aparecer, a nota sai sem contexto e volta para a fila).

## 3. Testes manuais no app real

**Painel (`/ia-painel`, atalho «IA» no cabeçalho e «Painel de IA» no rodapé/menu)**

- [ ] Mudar a ordem dos blocos e tirar um campo, salvar, recarregar a página: continua como salvo.
- [ ] «Restaurar padrão» + Salvar volta ao padrão.
- [ ] Aba Modelo e modo: trocar o modo e o modelo; conferir o aviso (toast) e que a troca vale na tela inicial.
- [ ] Celular: abas rolam, sem rolagem horizontal da página; atalho no menu.

**Veredicto de mercado e frete**

- [ ] Um lote com Discogs casado mostra «Sugerido (VG+)…», «Lote + frete» e «Oportunidade … (mercado)».
- [ ] Mesmo disco num leilão do Sudeste e em outra região: o frete muda (R$ 25 / R$ 35) e o veredicto pode mudar.
- [ ] Lote sem estado informado: aparece «sem estado: usa o padrão G+».
- [ ] No painel, mudar o frete e salvar: o veredicto dos cards muda sem reavaliar a IA.

**Leitura do estado em português (descrições reais)**

- [ ] Achar 3 a 5 lotes com «ótimo estado», «estado regular», «riscos que afetam a audição», «sem pulos» e conferir o
      badge Disco/Capa (ótimo = VG+, regular = G+, risco na audição = G+, «sem pulos» não rebaixa).
- [ ] Na aba Correlação, criar uma expressão sua (ex.: «muito bem conservado»), salvar, e na rodada seguinte do
      `condition` conferir em `lot_condition` que os lotes com essa frase mudaram.

**Reavaliar com IA (todos devem usar o contexto)**

- [ ] ✨ do lote sem nota, «refazer consulta» e «repassar a IA»: a nota volta, **as faixas (tracklist) não somem**.
- [ ] Tracklist sob demanda (0.146.0): ícone de faixas acende nos lotes que têm; passar o mouse/tocar mostra «Carregando faixas…» e depois a lista; a aba «Faixas» do detalhe no celular também; «atualizar» troca a lista sem recarregar a página.
- [ ] «Analisar dia», «Analisar casa» e «Analisar vigiados».
- [ ] Trocar para Gemini no painel e reavaliar um lote com capa: confirmar que a capa ainda é enviada (a URL passa
      pelo filtro de segurança) e a nota sai.

**Outras telas**

- [ ] De olho: o card mostra «… vs. mercado» ao lado do «Discogs BR» e da nota; a notificação/e-mail traz o veredicto.
- [ ] Meus lances: cartões com nota da IA, mercado e estado de conservação.
- [ ] Resumo diário (`step=dailydigest`): lote «caro vs. mercado» fica de fora do e-mail.
- [ ] Análise: a «Oportunidade» e o «vs. mercado» não divergem mais.

## 4. Pendências conhecidas

**Produto (próximas etapas)**

- [x] **Calibração**: feita na 0.150.0 com as compras recebidas (ver o item «Calibração (0.150.0)» abaixo). Ideia que
      ficou de fora: reavaliar as compras com o prompt atual e comparar com a nota do usuário (backtest com custo de IA).
- [ ] **Vendas passadas (0.148.0)**: no detalhe da nota de um lote com histórico aparece «Vendas passadas (Analytics)» com o link
      «ver no Analytics» (abre o artista/álbum certos); corrigir o disco lá e voltar ao detalhe atualiza o resumo (até 30 s); «repassar a IA»
      usa a correção. Aba Blocos: o bloco «Vendas passadas do mesmo disco» aparece ligado.
- [ ] **Descrição do lote (0.147.0)**: depois do deploy o `step=condition` relê os lotes (uma vez) e preenche a descrição; no painel
      (aba Blocos) o bloco «Descrição completa do lote» aparece ligado; conferir `select description from lot_condition limit 5` na VPS.
- [ ] **Frete real dos vendedores brasileiros**: a página de venda do Discogs responde 403 (Cloudflare). Alternativas
      em `docs/pendencias.md` (inventário por vendedor pela API, serviço de scraping).
- [ ] Cotação USD→BRL derivada da API: só será preciso se aparecer preço em outra moeda.

**Técnicas (não bloqueiam)**

- [ ] Duplicações (pool de workers, parser de JSON, lista de modelos), mover funções de `components/` para `src/lib`,
      teto de 25 do estado por IA sem prioridade, `PROMPT_VERSION` ainda manual para mudanças de ESTRUTURA do contexto.
- [ ] Testes sem cobertura: `pickBestRelease`/`parseAlbum`/`buildQuery`, `isQuotaError`, `priceRoseSinceEval`.
- [ ] O fallback de IA do estado e a identificação não usam as regras do painel (só o regex usa).

## 5. Se algo der errado

- Voltar a configuração: aba «Restaurar padrão» + Salvar (ou `DELETE FROM app_state WHERE key = 'ai_panel';`).
- Reler o estado com as regras atuais: `DELETE FROM lot_condition;` (o `step=condition` refaz).
- Reavaliar tudo: subir `PROMPT_VERSION` em `src/lib/ai-context.ts` (ou editar o texto do prompt).
- Conferir o que a IA recebe: aba «Blocos de contexto» (prévia) e `tools/local-tests/cadeia-ia.ts`.

**Sondagem → De olho e perfil do colecionador (0.149.0)**

- [ ] `/olho`: o aviso «A Sondagem foi descontinuada» lista as obras por migrar; **Migrar para o De olho** cria os itens
      (confira artista/álbum de cada um), as adquiridas ficam como «adquiridas» e o aviso some. Obras que a IA não resolveu:
      adicionar à mão ou «Dispensar».
- [ ] Depois de migrar, **não deve chegar enxurrada de push/e-mail** do De olho (os matches de hoje entram como já avisados).
- [ ] Apagar a tabela antiga quando estiver tudo certo: `DROP TABLE public.wantlist_items;` (e o trecho no `setup.sql`).
- [ ] `/olho` → «Meus interesses»: lista manual editável + artistas do De olho (chips «fixar»); o ⭐ da home/Análise vale para ambos.
- [ ] Análise: 🎯 aparece nos lotes que casam com um disco do De olho; «Só De olho» filtra; não há mais botão «Sondagem».
- [ ] Painel de IA → Blocos: «Perfil do colecionador» aparece ligado; no prompt só entra o que se aplica ao lote.

**Calibração (0.150.0)**
- [ ] Em Compras, marque um pregão como «Recebido»; em `/ia-painel` → «Calibração» os discos dele aparecem com o retrato da época.
- [ ] Preencha estado real, nota e «valeu a pena?» de alguns discos e confira os quatro resumos no topo (e as sugestões, com ≥ 3 discos).
- [ ] Compras novas: depois do próximo `step=purchases`, a linha nova já deve ter «IA na época» (retrato tirado na compra).
- [ ] Compras antigas (lote já fora da janela) mostram «sem retrato da época», mas a leitura do texto e o estado real funcionam.

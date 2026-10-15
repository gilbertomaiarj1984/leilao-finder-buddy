# Testes locais (banco, cadeia de IA e painel no navegador)

Complementam o `bun run check` (que só cobre funções puras). Precisam de um Postgres e, os de
navegador, do Playwright + Chromium. Nada aqui fala com o LeilõesBR, o Discogs ou a IA de verdade: a
cadeia de IA usa um servidor falso no lugar da API da Anthropic. **Não rodam no CI** (não fazem parte
do `bun test`).

## Preparar
```sh
# Postgres vazio e o schema (rode setup.sql duas vezes para provar que é idempotente)
createdb garimpo
psql garimpo -v ON_ERROR_STOP=1 -f supabase/setup.sql
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/garimpo
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=garimpo   # usado pelo psql dos testes de navegador
```

## 1. Banco (jsonb de `lot_market`, `lot_ai` enxuto, painel em `app_state`, contexto)
```sh
bun run tools/local-tests/integracao-banco.ts        # 19 verificações
```

## 2. Cadeia de IA (banco → contexto → prompt → IA falsa → hash → seleção, e o Batches)
```sh
bun run tools/local-tests/cadeia-ia.ts               # 19 verificações (usa a porta 4010)
```

## 3. Painel `/ia-painel` no navegador (desktop e celular)
```sh
bun run build
tools/local-tests/subir-servidor.sh &                # app em http://127.0.0.1:3999
# Playwright: PLAYWRIGHT_DIR=<pasta com node_modules/playwright>, CHROMIUM_PATH=<executável do Chromium>
node tools/local-tests/painel-e2e.mjs                # 42 verificações (abas, arrastar e soltar, salvar, recarregar)
node tools/local-tests/painel-mobile.mjs             # sem rolagem horizontal a 390 px + atalho no menu
node tools/local-tests/analytics-link-e2e.mjs        # link «ver no Analytics» abre o artista/álbum certos
```
A sessão é gerada com `SESSION_SECRET` (padrão de teste do `subir-servidor.sh`); nunca use o segredo de
produção. Os testes de navegador apagam `ai_panel` e `ai_mode` de `app_state` ao começar.

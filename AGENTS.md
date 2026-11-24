# Notas para agentes

App **TanStack Start** (React 19 + SSR, Vite + Nitro) com **Postgres** próprio, deploy em **VPS**
(Docker Compose + Caddy). Mapa da documentação e arquitetura de dados: `docs/notas-desenvolvimento.md`
(leia inteiro) e, depois, **só a página de `docs/areas/` da área em que vai mexer**. Este arquivo é a
fonte única das **convenções de trabalho**.

> `main` é a branch de produção e de trabalho. **Não usar `vps` como base** (parada, sem uso; o
> preview via Dokploy foi desligado em 12/11/2026). Histórico: `docs/arquivo/economia-fase-2-vps-unico.md`.

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- **Escopo:** este repo é SÓ o app de leilão. Nunca ler/editar/commitar no `pdf-unite-and-print`
  (gerador de etiquetas) a partir daqui, nem aplicar pedido de um projeto no outro; na dúvida,
  perguntar antes.
- **Fluxo:** recriar a branch a partir de `origin/main` antes de cada tarefa → PR **para `main`** → merge.
- **Antes de push:** `bun run check` (lint + typecheck + testes + knip). Ao mexer em parsing,
  grading ou matching, acrescente um caso em `tests/`.
- **Versão em TODO PR:** subir `APP_VERSION` em `src/lib/version.ts` e `version` no `package.json`
  (semver: PATCH=correção, MINOR=função nova, MAJOR=quebra) e pôr a versão no título do PR
  (`v0.2.0 — …`). O CI `version-bump.yml` falha o PR se a versão não subir.
- **Documentação antes de mesclar QUALQUER PR:** mecânica que mudou → página da área em
  `docs/areas/`; 1 linha no topo do `CHANGELOG.md`; pendência nova → `docs/pendencias.md`
  (resolvida → `docs/arquivo/pendencias-resolvidas.md`). O índice `docs/notas-desenvolvimento.md`
  só muda se mudar o mapa, as restrições ou a arquitetura de dados.
- **Reaproveitar antes de criar:** antes de criar helper, server function ou componente, procure
  com `grep` em `src/lib` e `src/components`. Ao terminar, se algo descoberto melhora outro ponto
  e é pequeno e seguro, aplique; senão registre em `docs/pendencias.md`.
- **Código repetido:** ao tocar numa área, consolide duplicação pequena e segura na mesma entrega
  (com teste). Se não der, deixe `// DUP(<tema>): …` no código e registre em `docs/pendencias.md`
  ("Código repetido"). Achar as marcas: `grep -rn "DUP(" src`; quem mexer numa cópia consolida
  todas as do tema.
- **GitHub:** rodapé de atribuição em qualquer post; commits terminam com `Co-Authored-By: Claude ...`.
- **Sem lance e sem alterar a conta** da LeilõesBR/casas sem pedido explícito; login só com
  credenciais fornecidas pelo usuário. Scraping público pode ser testado contra o site real.

## Caddyfile (já derrubou produção duas vezes)

- **Validar antes do push:** `deploy.yml` aplica direto em produção a cada push na `main`. Baixe o
  binário oficial do Caddy (sem Docker) e rode `caddy validate --config Caddyfile --adapter caddyfile`
  (envs via `VAR=valor` na frente); se mexeu em matcher/roteamento, teste também com `caddy run`
  numa porta alternativa. Passo a passo e histórico (v0.69.5, v0.69.21-23): `docs/areas/infra.md`.
- **Não remover o `caddy reload`** do `deploy.yml`: `docker compose up -d` não reinicia o serviço
  quando só o conteúdo de um arquivo montado muda.

# Notas para agentes

Este projeto é um app **TanStack Start** (React 19 + SSR, build com Vite + Nitro),
com **Postgres** próprio como backend e deploy em **VPS** (Docker Compose + Caddy).

> **Antes de começar, leia `docs/notas-desenvolvimento.md`** (índice curto) e só a página de
> `docs/areas/` da área que vai mexer. Arquitetura resumida no `CLAUDE.md`; este arquivo é a
> fonte única das **convenções de trabalho**.

> **Migração pra VPS concluída (Fase 6, cutover feito).** `main` voltou a ser a branch de
> produção/trabalho padrão — **não usar `vps` como base pra novo trabalho** (ela só segue viva
> em paralelo enquanto durar a Fase 7/preview deployments via Dokploy, trabalho de outra sessão;
> sincronizar com `main` de vez em quando, não abrir PR novo contra ela). Ver
> `docs/arquivo/economia-fase-2-vps-unico.md` pra histórico completo do cutover e achados de produção
> pós-migração (ex.: colisão de alias de rede com o preview do Dokploy).

## Convenções de trabalho

- **Responder em português** ao interagir com o usuário.
- **Recriar a branch de trabalho a partir de `origin/main` antes de cada tarefa**
  (pós-cutover da Fase 6 — ver aviso acima; `main` é a branch de produção/base agora).
  **Não usar `vps` como base pra trabalho novo.**
- Fluxo: branch de trabalho → PR **para `main`** → merge.
- **Rodar `bun run check` antes de todo push** (lint + typecheck + testes + knip).
- **Atualizar a documentação antes de mesclar QUALQUER PR**: mudança de mecânica na página da
  área em `docs/areas/`, uma linha no topo do `CHANGELOG.md`, pendência nova em
  `docs/pendencias.md` (resolvida vai para `docs/arquivo/pendencias-resolvidas.md`). O índice
  `docs/notas-desenvolvimento.md` só muda se mudar o mapa/restrições/arquitetura de dados.
- **Subir a versão do app em TODO PR:** bump em `src/lib/version.ts` (`APP_VERSION`) e
  no `package.json`, seguindo semver (PATCH=correção, MINOR=nova função, MAJOR=quebra).
  É o número mostrado no rodapé em produção. **Obrigatório** — o CI `version-bump.yml`
  falha o PR se a versão não subir. Coloque a versão no título do PR (ex.: `v0.2.0 — …`).
- Rodapé de atribuição em qualquer post no GitHub; commits terminam com
  `Co-Authored-By: Claude ...`.
- **Nunca editar `Caddyfile` sem validar a sintaxe antes de mandar pro VPS** — `deploy.yml`
  aplica direto em produção a cada push na `vps`, sem passo de revisão manual no meio. Baixar o
  binário oficial do Caddy (não precisa de Docker: `curl -fsSL -o caddy.tar.gz
  "https://github.com/caddyserver/caddy/releases/download/vX.Y.Z/caddy_X.Y.Z_linux_amd64.tar.gz"`,
  extrair, `caddy validate --config Caddyfile --adapter caddyfile` com as envs via `VAR=valor`
  na frente do comando) e, se mexer em matcher/expressão/roteamento novo, também `caddy run`
  numa porta alternativa (`http_port`/`https_port` no bloco global) pra testar de verdade antes
  do push — já causou crash-loop de produção duas vezes (v0.69.5: env vazia virando bloco
  Caddyfile inválido; ver `docs/arquivo/economia-fase-2-vps-unico.md`, Fase 7).
- **Uma mudança de `Caddyfile` só vale de verdade em produção depois do `caddy reload`
  no `deploy.yml`** — `docker compose up -d` não recria/reinicia um serviço só porque o
  CONTEÚDO de um arquivo montado via bind mount mudou (mesma classe de bug do `.env`,
  v0.69.5/v0.69.8). Achado com um bug de verdade no v0.69.21-23: o Caddy ficou rodando a
  config antiga por 3 deploys seguidos sem ninguém perceber, porque o arquivo no disco do
  VPS mudava mas o processo nunca recarregava. `deploy.yml` já faz `docker compose exec
  caddy caddy reload` depois do `up -d` — não remover isso.

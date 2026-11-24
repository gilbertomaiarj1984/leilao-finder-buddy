---
name: fechar-pr
description: Checklist para fechar um PR do app (versão, CHANGELOG, docs da área, pendências, check). Use antes de abrir ou mesclar qualquer PR neste repo.
---

# Fechar PR do Garimpo de Vinil

Faça os passos na ordem e confirme cada um com um comando, sem "achar" que está certo.

1. **Base:** `git fetch origin && git log --oneline origin/main -1`. A branch parte de `origin/main`.
2. **Versão:** subir `APP_VERSION` em `src/lib/version.ts` e `"version"` em `package.json`, os dois iguais e maiores que a de `origin/main` (PATCH=correção, MINOR=função nova, MAJOR=quebra). Conferir: `grep -n APP_VERSION src/lib/version.ts && grep -n '"version"' package.json`.
3. **CHANGELOG:** 1 linha curta no topo de `CHANGELOG.md`, no formato `- **X.Y.Z** — **Resumo**: o que mudou`.
4. **Docs da área:** se a mecânica mudou, atualizar a página certa em `docs/areas/` (mapa em `docs/notas-desenvolvimento.md`).
5. **Pendências:** item novo → `docs/pendencias.md`; item resolvido → mover para `docs/arquivo/pendencias-resolvidas.md`.
6. **Duplicação:** `grep -rn "DUP(" src` nas áreas tocadas; consolidar o que for pequeno e seguro.
7. **Check:** `bun run check` (o hook em `.claude/settings.json` também roda isso antes de `git push`). Se falhar, rodar de novo só o que falhou depois de corrigir.
8. **PR:** título com a versão (`v0.200.2 — …`), draft, base `main`, corpo começando pelas linhas de atribuição da sessão.
9. **Mesclar** só com pedido explícito do dono; depois conferir o run "Deploy (VPS)" no GitHub Actions.

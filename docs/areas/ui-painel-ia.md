# UI — Painel de IA (`/ia-painel`)

> Parte das notas de desenvolvimento — índice em `docs/notas-desenvolvimento.md`.
> Atualize esta página ao mudar a mecânica desta área.

## Painel de IA (`/ia-painel`, v0.143.0)

Rota `routes/_authenticated/ia-painel.tsx` + `components/vinyl/ai-panel/` (`blocks-tab`, `correl-tab`,
`freight-tab`, `model-tab`, `use-list-dnd`). Rascunho local (`edited`) e botão Salvar → `setAiPanel`;
"Restaurar padrão" só vale depois de salvar. Arrastar e soltar nativo (HTML5), como no resto do app;
cada reordenação também tem botões ▲▼ (touch). O rodapé da tela inicial perdeu o modo/modelo da IA
(agora na aba "Modelo e modo"); ficou o atalho "Painel de IA" ao lado de "Atualizar tudo".

Atualização v0.144.0: a aba **Blocos de contexto** lista, em «Em breve», os blocos que ainda não entram
no prompt (`PLANNED_BLOCKS` em `blocks-tab.tsx`: vendas, perfil do colecionador, descrição — «em breve»;
tracklist, correções — «por ora não»). Para ativar um deles: criar o dado, acrescentá-lo a
`CONTEXT_BLOCK_IDS`/`CONTEXT_FIELDS` (`ai-panel-config.ts`), a `buildLotContext`/`contextForPrompt`
(`ai-context.ts`) e subir `PROMPT_VERSION`. As abas ficam num contêiner com rolagem horizontal (390 px).
Testes de ponta a ponta do painel: `tools/local-tests/README.md`.

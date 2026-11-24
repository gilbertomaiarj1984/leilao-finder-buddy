// Hook PreToolUse (Bash): antes de `git push`, roda `bun run check` (lint + typecheck + testes +
// knip) e BLOQUEIA o push se falhar. Regra do AGENTS.md ("Antes de push: bun run check").
// Entrada: JSON do Claude Code em stdin ({ tool_input: { command } }). Saída 2 = bloqueia.
import { spawnSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let command = "";
try {
  command = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0); // entrada inesperada: não atrapalha
}

// Só `git push` de verdade (não `git push` dentro de uma mensagem de commit/echo).
if (!/(^|[;&|]\s*)git\s+(-C\s+\S+\s+)?push(\s|$)/.test(command)) process.exit(0);
if (/--dry-run/.test(command)) process.exit(0);

const r = spawnSync("bun", ["run", "check"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (r.status === 0) process.exit(0);

const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").slice(-40).join("\n");
process.stderr.write(
  `Push bloqueado: \`bun run check\` falhou. Corrija e tente de novo.\n\n${out}\n`,
);
process.exit(2);

import { normalizeForMatch } from "@/lib/vinyl-parse";

/**
 * Uma obra "sondada" já interpretada a partir de uma linha de texto colada. `work` é a
 * descrição da obra (artista/álbum), `year` o ano (quando entre parênteses), `note` uma
 * observação (rótulo de colchete e/ou o que sobra dentro dos parênteses) e `norm` o texto
 * normalizado de `work` (sem acento/pontuação) para casar com os títulos dos lotes.
 */
export type ParsedWantItem = {
  raw: string;
  work: string;
  year: number | null;
  note: string;
  norm: string;
};

const YEAR_RE = /\b(?:19|20)\d{2}\b/;

/** Limpa aspas (retas/tipográficas) e espaços redundantes de uma observação. */
function cleanNote(s: string): string {
  return s
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Interpreta UMA linha do rascunho de sondagem. Retorna `null` para linhas vazias ou que
 * não sobram nada de obra. Exemplos aceitos:
 *   "01. Tim Maia (1970)"
 *   "03. Tim Maia Racional, Vol. 1 (1975 - Fase Cult/Rara)"
 *   "05. Tim Maia (1976 - \"Rodésia\")"
 *   "[Bônus/Cult: Tim Maia Racional, Vol. 2 (1975)]"
 */
export function parseWantLine(line: string): ParsedWantItem | null {
  const original = line.trim();
  if (!original) return null;

  let body = original;
  const notes: string[] = [];

  // Linha entre colchetes: "[Bônus/Cult: ...]" → o rótulo antes do ":" vira nota.
  const bracket = body.match(/^\[(.*)\]$/s);
  if (bracket) {
    const inner = bracket[1]!.trim();
    const labeled = inner.match(/^([^:]{1,40}):\s*(.+)$/s);
    if (labeled) {
      const label = cleanNote(labeled[1]!);
      if (label) notes.push(label);
      body = labeled[2]!.trim();
    } else {
      body = inner;
    }
  }

  // Numeração inicial: "01." / "1)" / "1 -".
  body = body.replace(/^\s*\d+\s*[.)\-–]\s*/, "").trim();

  // Último parêntese: ano e/ou observação — "(1975 - Fase Cult/Rara)", "(1970)".
  let year: number | null = null;
  const paren = body.match(/\(([^()]*)\)\s*$/);
  if (paren && paren.index !== undefined) {
    const content = paren[1]!.trim();
    body = body.slice(0, paren.index).trim();
    const ym = content.match(YEAR_RE);
    if (ym) year = Number(ym[0]);
    const rest = cleanNote(content.replace(YEAR_RE, "").replace(/^[\s\-–—:]+/, ""));
    if (rest) notes.push(rest);
  }

  const work = body.replace(/[\s,;\-–—]+$/, "").trim();
  if (!work) return null;

  return {
    raw: original,
    work,
    year,
    note: notes.join(" · "),
    norm: normalizeForMatch(work),
  };
}

/** Interpreta o texto colado inteiro (uma obra por linha), removendo duplicatas (obra+ano). */
export function parseWantlistText(text: string): ParsedWantItem[] {
  const out: ParsedWantItem[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const item = parseWantLine(line);
    if (!item) continue;
    const key = `${item.norm}|${item.year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

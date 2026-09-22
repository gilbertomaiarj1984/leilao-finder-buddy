// Módulo puro/client-safe: extração de palavras-chave e heurística de "possível lixo"
// (sem IA — ver docs/notas-desenvolvimento.md, seção de exclusão de lotes).
import { normalizeForMatch } from "@/lib/vinyl-parse";

// Stopwords em PT + termos genéricos de catálogo de disco que aparecem em quase todo
// título e não ajudam a identificar o que torna um lote "lixo" (heurística deliberadamente
// simples, sem IA).
const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "sem",
  "para",
  "em",
  "no",
  "na",
  "um",
  "uma",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "lp",
  "lps",
  "disco",
  "discos",
  "vinil",
  "vinis",
  "vinyl",
  "compacto",
  "compactos",
  "album",
  "lote",
  "original",
  "nacional",
  "importado",
  "raro",
  "capa",
  "encarte",
]);

const MIN_TOKEN_LEN = 3;

/** Termos significativos de um título para o aprendizado de exclusão (sem o artista). */
export function extractKeywords(title: string, artist?: string | null): string[] {
  const artistTokens = new Set(artist ? normalizeForMatch(artist).split(" ") : []);
  const tokens = normalizeForMatch(title)
    .split(" ")
    .filter((t) => t.length >= MIN_TOKEN_LEN)
    .filter((t) => !STOPWORDS.has(t))
    .filter((t) => !artistTokens.has(t));
  return Array.from(new Set(tokens));
}

// Overlap mínimo (contagem absoluta de termos em comum) para acender "possível lixo" —
// evita que um único termo genérico marque um lote sozinho.
const MIN_OVERLAP = 2;

export type ExclusionSignal = { matchedTerms: string[]; excludedTitle: string };

/**
 * Compara as keywords de um lote NOVO contra os lotes já excluídos e devolve o primeiro
 * casamento (ou null). Overlap por contagem, não percentual — mais previsível para títulos
 * curtos. Não esconde nada sozinho: só sinaliza (ver LotCard `possibleTrash`).
 *
 * `denylist` são termos que o usuário já confirmou NÃO indicarem lixo (clicou no badge —
 * ver `addTrashKeywordDenylist` em `app-state.server.ts`): removidos de AMBOS os lados antes
 * de contar o overlap, então o aprendizado vale pra qualquer lote futuro que só bateria por
 * esses termos, não só o lote que foi clicado.
 */
export function matchPossibleTrash(
  lotKeywords: string[],
  excluded: { title: string; keywords: string[] }[],
  denylist?: ReadonlySet<string>,
): ExclusionSignal | null {
  const lotFiltered = denylist ? lotKeywords.filter((k) => !denylist.has(k)) : lotKeywords;
  if (lotFiltered.length < MIN_OVERLAP) return null;
  const lotSet = new Set(lotFiltered);
  for (const ex of excluded) {
    const exFiltered = denylist ? ex.keywords.filter((k) => !denylist.has(k)) : ex.keywords;
    const hit = exFiltered.filter((k) => lotSet.has(k));
    if (hit.length >= MIN_OVERLAP) return { matchedTerms: hit, excludedTitle: ex.title };
  }
  return null;
}

/**
 * Regras de TEXTO que traduzem o jeito brasileiro de descrever o estado de um disco em leilão
 * ("ótimo estado", "estado regular", "riscos que afetam a audição") para um grau (`Grade`).
 * Dados puros (client-safe), pensados para virar a tabela editável do painel de IA.
 *
 * Operam sobre texto JÁ dobrado (`foldUpper` de grading.ts: maiúsculas, sem acento).
 * - `set`: define o estado dos DOIS lados quando o texto não traz Disco/Capa rotulados.
 * - `cap`: limita o DISCO a esse grau (um defeito audível derruba "VG+" no resto do texto).
 */
import type { Grade } from "./grading";

type TextRule = {
  id: string;
  label: string;
  /** Fonte da regex (aplicada em texto maiúsculo e sem acento). */
  pattern: string;
  grade: Grade;
  effect: "set" | "cap";
};

const TEXT_RULES: readonly TextRule[] = [
  {
    id: "excelente-estado",
    label: "excelente estado",
    pattern: "\\bEXCELENTE\\s+ESTADO\\b",
    grade: "EX",
    effect: "set",
  },
  {
    id: "otimo-estado",
    label: "ótimo estado",
    pattern: "\\bOTIM[OA]\\s+ESTADO\\b",
    grade: "VG+",
    effect: "set",
  },
  {
    id: "muito-bom-estado",
    label: "muito bom estado",
    pattern: "\\bMUITO\\s+BOM\\s+ESTADO\\b",
    grade: "VG+",
    effect: "set",
  },
  {
    id: "bom-estado",
    label: "bom estado",
    pattern: "\\bBOM\\s+ESTADO\\b",
    grade: "VG",
    effect: "set",
  },
  {
    id: "estado-regular",
    label: "estado regular",
    pattern: "\\b(?:ESTADO\\s+(?:REGULAR|RAZOAVEL)|(?:REGULAR|RAZOAVEL)\\s+ESTADO)\\b",
    grade: "G+",
    effect: "set",
  },
  {
    id: "risco-audicao",
    label: "riscos que afetam a audição",
    pattern:
      "\\bRISCOS?\\b[^.;!?]{0,50}?\\b(?:AFET\\w*|PREJUDIC\\w*|INTERFER\\w*|COMPROMET\\w*|ACARRET\\w*|CAUS\\w*)\\b[^.;!?]{0,30}?\\b(?:AUDICAO|REPRODUCAO|OUVIDA|SOM)\\b",
    grade: "G+",
    effect: "cap",
  },
  {
    id: "afeta-audicao",
    label: "afeta a audição",
    pattern:
      "\\b(?:AFET\\w*|PREJUDIC\\w*|INTERFER\\w*|COMPROMET\\w*)\\s+(?:A\\s+|NA\\s+|O\\s+)?(?:AUDICAO|REPRODUCAO|SOM)\\b",
    grade: "G+",
    effect: "cap",
  },
  {
    id: "problema-audicao",
    label: "problemas na audição",
    pattern:
      "\\b(?:PROBLEMAS?|FALHAS?|RISCOS?)\\s+(?:NA|DE|NO|PARA)\\s+(?:AUDICAO|REPRODUCAO|SOM)\\b",
    grade: "G+",
    effect: "cap",
  },
  {
    id: "pulos-riscos-fundos",
    label: "pula, trava ou riscos profundos",
    pattern:
      "\\bPULA(?:R|M|NDO)?\\b|\\bPULOS?\\b|\\bTRAVA(?:R|M|NDO)?\\b|\\bRISCOS?\\s+(?:PROFUND\\w+|FUND\\w+|MARCANT\\w+)\\b",
    grade: "G+",
    effect: "cap",
  },
];

type TextHit = { rule: TextRule; excerpt: string };

// Negação logo antes do trecho ("sem pulos", "não pula", "livre de riscos que afetem…").
const NEGATION = /\b(?:SEM|NAO|NENHUM|NENHUMA|NUNCA|ISENTO|LIVRE\s+DE)\b[^.;!?]*$/;

/** Regras que casam com o texto dobrado, ignorando as precedidas de negação. */
export function matchTextRules(folded: string, rules: readonly TextRule[] = TEXT_RULES): TextHit[] {
  const hits: TextHit[] = [];
  for (const rule of rules) {
    const m = new RegExp(rule.pattern).exec(folded);
    if (!m) continue;
    if (NEGATION.test(folded.slice(Math.max(0, m.index - 40), m.index))) continue;
    hits.push({ rule, excerpt: m[0] });
  }
  return hits;
}

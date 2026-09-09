/**
 * Grading de conservação de vinil (Disco × Capa) — módulo PURO e client-safe (sem rede,
 * sem imports de servidor). Fonte única da escala canônica de 10 graus, da matriz de Score
 * Final e das faixas de classificação. É consumido pelo card dos lotes, pela Coleção e
 * (nas fases seguintes) pelo enriquecimento no servidor e pelo Vinil Analytics.
 *
 * Escala canônica (do MELHOR para o PIOR): M, NM, EX, VG+, VG, VG-, G+, G, G-, F/P.
 * Sinônimos aceitos: M- ≈ NM, VG++ ≈ EX, além de palavras (Mint/Lacrado, Near Mint,
 * Excelente, Muito Bom, Bom, Regular, Fair/Poor…).
 */

/** Graus canônicos, do melhor (M) ao pior (F/P). A ordem define o eixo pior→melhor do Analytics. */
export const GRADE_ORDER = ["M", "NM", "EX", "VG+", "VG", "VG-", "G+", "G", "G-", "F/P"] as const;

export type Grade = (typeof GRADE_ORDER)[number];

/** Score-base de cada grau (usado quando só um lado — Disco OU Capa — é conhecido). */
export const GRADE_SCORES: Record<Grade, number> = {
  M: 100,
  NM: 90,
  EX: 80,
  "VG+": 70,
  VG: 55,
  "VG-": 45,
  "G+": 35,
  G: 25,
  "G-": 15,
  "F/P": 0,
};

/**
 * Matriz de Score Final: linha = Disco, coluna = Capa, na ordem de `GRADE_ORDER`.
 * Valores fixos conforme a tabela de referência (a diagonal reproduz o score-base).
 */
const MATRIX_ROWS: Record<Grade, readonly number[]> = {
  M: [100, 97, 93, 90, 84, 81, 77, 74, 70, 65],
  NM: [94, 90, 87, 83, 78, 74, 71, 67, 64, 59],
  EX: [87, 84, 80, 77, 71, 68, 64, 61, 57, 52],
  "VG+": [81, 77, 74, 70, 65, 61, 58, 54, 51, 46],
  VG: [71, 67, 64, 60, 55, 52, 48, 45, 41, 36],
  "VG-": [64, 61, 57, 54, 49, 45, 42, 38, 35, 29],
  "G+": [58, 54, 51, 47, 42, 39, 35, 32, 28, 23],
  G: [51, 48, 44, 41, 36, 32, 29, 25, 22, 16],
  "G-": [45, 41, 38, 34, 29, 26, 22, 19, 15, 10],
  "F/P": [35, 32, 28, 25, 19, 16, 12, 9, 5, 0],
};

/** Faixas de Classificação do Score Final (limites inclusivos). `label` curto p/ chips. */
export type Faixa = { min: number; max: number; label: string; full: string };

export const FAIXAS: readonly Faixa[] = [
  { min: 90, max: 100, label: "Colecionador", full: "Estado de Colecionador / Impecável" },
  { min: 75, max: 89, label: "Excelente", full: "Excelente Conservação" },
  { min: 60, max: 74, label: "Muito Bom", full: "Muito Bom (uso constante)" },
  { min: 45, max: 59, label: "Aceitável", full: "Aceitável (sinais claros de uso)" },
  { min: 30, max: 44, label: "Abaixo da Média", full: "Abaixo da Média / Uso Secundário" },
  { min: 0, max: 29, label: "Muito Danificado", full: "Muito Danificado / Transição ou Decoração" },
];

/** Faixa correspondente a um Score Final (0–100), ou null quando o score é null. */
export function faixaFromScore(score: number | null): Faixa | null {
  if (score === null || !Number.isFinite(score)) return null;
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return FAIXAS.find((f) => s >= f.min && s <= f.max) ?? null;
}

/** Origem da classificação de um lote. */
export type ConditionSource = "regex" | "ia" | "indefinido";

/** Presença do encarte interno. */
export type InsertState = "sim" | "nao" | null;

/** Estado de conservação consolidado de um lote/disco. */
export type Condition = {
  media: Grade | null; // Disco
  sleeve: Grade | null; // Capa
  insert: InsertState; // encarte interno
  score: number | null; // Score Final (0–100)
  faixa: Faixa | null;
  source: ConditionSource;
  raw: string; // trecho de origem (para auditoria/tooltip)
};

/** Estado vazio/indefinido — nunca inventa graus. */
export const EMPTY_CONDITION: Condition = {
  media: null,
  sleeve: null,
  insert: null,
  score: null,
  faixa: null,
  source: "indefinido",
  raw: "",
};

/**
 * Score Final a partir dos graus de Disco e Capa. Com ambos, usa a matriz; com apenas um
 * lado, cai no score-base desse lado; sem nenhum, null.
 */
export function scoreCondition(
  media: Grade | null,
  sleeve: Grade | null,
): { score: number | null; faixa: Faixa | null } {
  let score: number | null = null;
  if (media && sleeve) {
    const col = GRADE_ORDER.indexOf(sleeve);
    score = MATRIX_ROWS[media][col] ?? null;
  } else if (media) {
    score = GRADE_SCORES[media];
  } else if (sleeve) {
    score = GRADE_SCORES[sleeve];
  }
  return { score, faixa: faixaFromScore(score) };
}

// ---------------------------------------------------------------------------
// Normalização de graus a partir de siglas/palavras soltas.
// ---------------------------------------------------------------------------

/** Remove acentos e coloca em caixa alta, preservando +, - e /. */
function foldUpper(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/**
 * Converte uma sigla OU palavra de conservação no grau canônico correspondente; null quando
 * não reconhece. Ex.: "vg+" → "VG+", "M-" → "NM", "VG++" → "EX", "lacrado" → "M",
 * "excelente" → "EX", "bom" → "VG".
 */
export function normalizeGrade(raw: string | null | undefined): Grade | null {
  if (!raw) return null;
  const s = foldUpper(raw)
    .replace(/\([^)]*\)/g, " ") // "M (MINT)" -> "M"
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  // Siglas (checar as mais longas/específicas primeiro).
  const sigla = s.replace(/\s+/g, "");
  const SIGLA_MAP: Record<string, Grade> = {
    "M-": "NM",
    "VG++": "EX",
    "VG+": "VG+",
    "VG-": "VG-",
    "G+": "G+",
    "G-": "G-",
    "F/P": "F/P",
    NM: "NM",
    EX: "EX",
    VG: "VG",
    M: "M",
    G: "G",
    F: "F/P",
    P: "F/P",
  };
  if (SIGLA_MAP[sigla]) return SIGLA_MAP[sigla];

  // Palavras/frases (checar "Near Mint"/"Quase perfeito" ANTES de Mint/Perfeito soltos).
  if (/\bNEAR\s*MINT\b|\bQUASE\s*PERFEIT[OA]\b/.test(s)) return "NM";
  if (/\b(MINT|LACRAD[OA]|SELAD[OA]|IMPECAVEL|PERFEIT[OA]|NOVO)\b/.test(s)) return "M";
  if (/\bEXCELENTE\b|\bEXCELLENT\b/.test(s)) return "EX";
  if (/\bMUITO\s*BOM\b|\bVERY\s*GOOD\s*PLUS\b/.test(s)) return "VG+";
  if (/\bVERY\s*GOOD\b|\bBOM\b|\bBOA\b/.test(s)) return "VG";
  if (/\bGOOD\s*PLUS\b/.test(s)) return "G+";
  if (/\bGOOD\b|\bREGULAR\b|\bRAZOAVEL\b/.test(s)) return "G";
  if (/\bFAIR\b|\bPOOR\b|\bRUIM\b|\bPESSIM[OA]\b|\bDANIFICAD[OA]\b/.test(s)) return "F/P";
  return null;
}

// ---------------------------------------------------------------------------
// Extração do estado a partir do texto livre (título/descrição do lote).
// ---------------------------------------------------------------------------

// Alternância de tokens de grau (siglas + palavras). Ordem importa: mais longo primeiro.
const GRADE_TOKEN =
  "M-|VG\\+\\+|VG\\+|VG-|G\\+|G-|F/P|NM|EX|VG|NEAR\\s*MINT|MINT|LACRAD[OA]|SELAD[OA]|IMPEC[AÁ]VEL|EXCELENTE|MUITO\\s*BOM|GOOD\\s*PLUS|VERY\\s*GOOD\\s*PLUS|VERY\\s*GOOD|REGULAR|FAIR|POOR|RUIM|BOM|GOOD|\\bM\\b|\\bG\\b|\\bF\\b|\\bP\\b";

/** Captura o grau que segue um rótulo (ex.: "Disco: VG+", "Capa - NM", "Mídia EX"). */
function gradeAfterLabel(text: string, labels: string): Grade | null {
  const re = new RegExp(`(?:${labels})\\s*[:\\-–]?\\s*(${GRADE_TOKEN})`, "i");
  const m = text.match(re);
  return m ? normalizeGrade(m[1]!) : null;
}

/** Detecta a presença do encarte interno: 'nao' (sem encarte) tem prioridade sobre 'sim'. */
export function detectInsert(text: string): InsertState {
  const t = foldUpper(text);
  if (/\bSEM\s+ENCARTE\b|\bN[AÃ]O\s+(?:POSSUI|TEM|ACOMPANHA)\s+ENCARTE\b/.test(t)) return "nao";
  if (/\bENCARTE\b/.test(t)) return "sim";
  return null;
}

/**
 * Interpreta o estado de conservação a partir do texto do lote (título e/ou descrição).
 * Estratégia determinística (regex/dicionário):
 * 1. Rótulos explícitos "Disco/Mídia/Vinil" e "Capa/Sleeve" definem cada lado.
 * 2. Rótulo geral ("Estado/Conservação/Grade") aplica o mesmo grau aos dois lados.
 * 3. Palavra de item inteiro ("Lacrado/Mint/Impecável") sem rótulo → ambos os lados.
 * 4. Uma única sigla forte solta (NM, EX, VG+, VG-, G+, G-, VG++, M-, F/P) → Disco (geral).
 * Nunca inventa: sem sinal → `source: 'indefinido'`.
 */
export function parseConditionFromText(text: string | null | undefined): Condition {
  const raw = (text ?? "").trim();
  if (!raw) return { ...EMPTY_CONDITION };

  let media = gradeAfterLabel(raw, "disco|m[ií]dia|midia|vinil|bolacha");
  let sleeve = gradeAfterLabel(raw, "capa|sleeve|jaqueta");

  if (!media && !sleeve) {
    // (2) rótulo geral: aplica aos dois lados.
    const overall = gradeAfterLabel(raw, "estado|conserva[cç][aã]o|grade|classifica[cç][aã]o");
    if (overall) {
      media = overall;
      sleeve = overall;
    } else {
      // (3) palavra de item inteiro sem rótulo.
      const whole = foldUpper(raw);
      if (/\b(MINT|LACRAD[OA]|SELAD[OA]|IMPEC[AÁ]VEL)\b/.test(whole)) {
        media = "M";
        sleeve = "M";
      } else {
        // (4) uma única sigla forte solta (evita M/G/F/P sozinhos, ambíguos demais).
        const STRONG = /\b(VG\+\+|VG\+|VG-|M-|NM|EX|G\+|G-|F\/P)\b/gi;
        const found = new Set<Grade>();
        for (const m of raw.matchAll(STRONG)) {
          const g = normalizeGrade(m[1]!);
          if (g) found.add(g);
        }
        if (found.size === 1) media = [...found][0]!;
      }
    }
  }

  const insert = detectInsert(raw);
  const { score, faixa } = scoreCondition(media, sleeve);
  const source: ConditionSource = media || sleeve ? "regex" : "indefinido";
  return { media, sleeve, insert, score, faixa, source, raw };
}

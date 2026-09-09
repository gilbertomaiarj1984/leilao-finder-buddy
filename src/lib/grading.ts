/**
 * Grading de conservação de vinil (Disco × Capa) — módulo PURO e client-safe (sem rede,
 * sem imports de servidor). Fonte única da escala canônica de 10 graus e das faixas de
 * classificação. É consumido pelo card dos lotes, pela Coleção e pelo enriquecimento no
 * servidor (catálogo/IA) e pelo Vinil Analytics.
 *
 * Escala canônica (do MELHOR para o PIOR): M, NM, EX, VG+, VG, VG-, G+, G, G-, F/P.
 * Sinônimos aceitos: M- ≈ NM, VG++ ≈ EX, além de palavras (Mint/Lacrado, Near Mint,
 * Excelente, Muito Bom, Bom, Regular, Fair/Poor…).
 *
 * Regra de preenchimento cruzado (padrão em TODO o app — cards, Coleção, Analytics):
 * - Só um lado conhecido (Disco OU Capa) → ESPELHA o mesmo grau para o outro lado — nunca
 *   fica "só Disco" ou "só Capa" quando há QUALQUER sinal de estado.
 * - Ambos conhecidos (iguais ou diferentes) → Score Final = MÉDIA dos scores-base dos dois
 *   graus (arredondada). Ver `scoreCondition`.
 */

/** Graus canônicos, do melhor (M) ao pior (F/P). A ordem define o eixo pior→melhor do Analytics. */
export const GRADE_ORDER = ["M", "NM", "EX", "VG+", "VG", "VG-", "G+", "G", "G-", "F/P"] as const;

export type Grade = (typeof GRADE_ORDER)[number];

/** Score-base de cada grau (usado no cálculo de Score Final — ver `scoreCondition`). */
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
 * Score Final a partir dos graus de Disco e Capa, aplicando a regra de preenchimento cruzado
 * do sistema (padrão em toda a UI — cards de lote, Coleção, Vinil Analytics):
 * - Só um lado conhecido → ESPELHA o mesmo grau para o outro lado. `media`/`sleeve` no
 *   retorno já refletem o espelhamento (nunca "só Disco" ou "só Capa" quando há QUALQUER
 *   sinal de estado) — use os valores retornados para exibir os badges.
 * - Ambos conhecidos (iguais ou diferentes) → Score Final = MÉDIA dos scores-base dos dois
 *   graus, arredondada ao inteiro mais próximo.
 * - Nenhum lado conhecido → tudo null.
 */
export function scoreCondition(
  media: Grade | null,
  sleeve: Grade | null,
): { media: Grade | null; sleeve: Grade | null; score: number | null; faixa: Faixa | null } {
  const m = media ?? sleeve;
  const s = sleeve ?? media;
  const score = m && s ? Math.round((GRADE_SCORES[m] + GRADE_SCORES[s]) / 2) : null;
  return { media: m, sleeve: s, score, faixa: faixaFromScore(score) };
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
 * "excelente" → "EX", "bom"/"boa" → "VG", "quase novo" → "NM".
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

  // Palavras/frases (checar as compostas ANTES das soltas: "Near Mint"/"Quase Perfeito"/
  // "Quase Novo" antes de "Mint"/"Perfeito"/"Novo"; "Muito Bom/Boa" antes de "Bom/Boa"…).
  if (/\bNEAR\s*MINT\b|\bQUASE\s*PERFEIT[OA]\b|\bQUASE\s*NOVO\b/.test(s)) return "NM";
  if (/\b(MINT|LACRAD[OA]|SELAD[OA]|IMPECAVEL|PERFEIT[OA]|NOVO)\b/.test(s)) return "M";
  if (/\bEXCELENTE\b|\bEXCELLENT\b|\bOTIM[OA]\b/.test(s)) return "EX";
  if (/\bMUITO\s*BOM\b|\bMUITO\s*BOA\b|\bVERY\s*GOOD\s*PLUS\b/.test(s)) return "VG+";
  if (/\bVERY\s*GOOD\b|\bBOM\b|\bBOA\b/.test(s)) return "VG";
  if (/\bGOOD\s*PLUS\b/.test(s)) return "G+";
  if (/\bGOOD\b|\bREGULAR\b|\bRAZOAVEL\b/.test(s)) return "G";
  if (/\bFAIR\b|\bPOOR\b|\bRUIM\b|\bPESSIM[OA]\b|\bDANIFICAD[OA]\b/.test(s)) return "F/P";
  return null;
}

// ---------------------------------------------------------------------------
// Extração do estado a partir do texto livre (título/descrição do lote).
// ---------------------------------------------------------------------------

// Alternância de tokens de grau (siglas + palavras), operando sobre texto JÁ dobrado
// (`foldUpper`: maiúsculas, sem acento) — por isso não há variantes acentuadas aqui. Ordem
// importa: alternativas que compartilham prefixo com outra mais curta vêm PRIMEIRO (ex.:
// "VG++"/"VG+" antes de "VG"; "GOOD PLUS" antes de "GOOD"; "MUITO BOM" não conflita com
// "BOM" solto pois começam com letras diferentes na mesma posição de busca).
const GRADE_TOKEN =
  "M-|VG\\+\\+|VG\\+|VG-|G\\+|G-|F/P|NM|EX|VG" +
  "|NEAR\\s*MINT|QUASE\\s*PERFEIT[OA]|QUASE\\s*NOVO" +
  "|MINT|LACRAD[OA]|SELAD[OA]|IMPECAVEL|PERFEIT[OA]|NOVO" +
  "|EXCELENTE|EXCELLENT|OTIM[OA]" +
  "|MUITO\\s*BOA|MUITO\\s*BOM|GOOD\\s*PLUS|VERY\\s*GOOD\\s*PLUS|VERY\\s*GOOD" +
  "|BOA|BOM|GOOD" +
  "|RAZOAVEL|REGULAR" +
  "|FAIR|POOR|RUIM|PESSIM[OA]|DANIFICAD[OA]" +
  "|\\bM\\b|\\bG\\b|\\bF\\b|\\bP\\b";

// Rótulos de cada lado (sobre texto dobrado — sem acento). "MIDIA" já cobre "mídia"
// (acento removido pelo fold), sem precisar de classe de caracteres.
const MEDIA_LABELS = "DISCO|MIDIA|VINIL|BOLACHA";
const SLEEVE_LABELS = "CAPA|SLEEVE|JAQUETA";
const OVERALL_LABELS = "ESTADO|CONSERVACAO|GRADE|CLASSIFICACAO";
// Rótulo combinado ("Capa e Disco: VG+", "Disco/Capa NM") — aplica aos dois lados.
const COMBINED_LABELS = `CAPA\\s*(?:E|/|,)?\\s*DISCO|DISCO\\s*(?:E|/|,)?\\s*CAPA`;

/**
 * Captura o grau que segue um rótulo, tolerando CONECTORES DE PROSA entre o rótulo e o grau
 * (ex.: "Capa em bom estado", "Disco apresenta-se em estado excelente", "Capa (VG+)") — até
 * ~40 caracteres de enchimento, sem cruzar fim de frase (.;!?) nem, quando informado, o
 * rótulo do OUTRO lado (`stopLabels`) — evita atribuir o grau do Disco à Capa (ou vice-versa)
 * em frases como "Capa com riscos, disco muito bom". Rejeita negação IMEDIATAMENTE adjacente
 * ("não bom", "sem excelente"); negação mais distante ("não está em bom estado") é uma
 * limitação conhecida do regex — fica para o fallback de IA.
 */
function gradeAfterLabel(foldedText: string, labels: string, stopLabels = ""): Grade | null {
  const stop = stopLabels ? `(?!${stopLabels})` : "";
  const filler = `(?:${stop}[^.;!?]){0,40}?`;
  const re = new RegExp(
    `(?:${labels})${filler}[:\\-–=]?\\s*\\(?\\s*(?<!NAO\\s)(?<!SEM\\s)(${GRADE_TOKEN})`,
    "i",
  );
  const m = foldedText.match(re);
  return m ? normalizeGrade(m[1]!) : null;
}

/**
 * Detecta a presença do encarte interno. CONSERVADOR: só conta afirmação DEFINIDA
 * ('nao' vence 'sim'). Uma menção genérica/condicional — como o boilerplate de catálogo
 * "Se o LP possuir encarte estará nas imagens" — NÃO conta (retorna null), para não
 * marcar "tem encarte" onde a loja só diz que, se houver, aparece nas fotos.
 */
export function detectInsert(text: string): InsertState {
  const t = foldUpper(text);
  if (/\bSEM\s+ENCARTE\b|\bN[AÃ]O\s+(?:POSSUI|TEM|ACOMPANHA|INCLUI)\s+ENCARTE\b/.test(t)) {
    return "nao";
  }
  if (
    /\b(COM|POSSUI|ACOMPANHA|INCLUI|CONT[EÉ]M)\s+ENCARTE\b|\bENCARTE\s+(INTERNO|INCLUSO|PRESENTE|ORIGINAL|JUNTO)\b/.test(
      t,
    )
  ) {
    return "sim";
  }
  return null;
}

/**
 * Interpreta o estado de conservação a partir do texto do lote (título e/ou descrição).
 * Estratégia determinística (regex/dicionário), tolerante a PROSA (não só siglas coladas
 * ao rótulo):
 * 1. Rótulos explícitos "Disco/Mídia/Vinil" e "Capa/Sleeve" definem cada lado (mesmo com
 *    conectores no meio: "capa em bom estado", "disco apresenta leves riscos, EX").
 * 2. Sem nenhum dos dois: rótulo geral ("Estado/Conservação/Grade") ou combinado ("Capa e
 *    Disco: VG+") aplica o mesmo grau aos dois lados.
 * 3. Palavra de item inteiro ("Lacrado/Mint/Impecável") sem rótulo → ambos os lados.
 * 4. Uma única sigla forte solta (NM, EX, VG+, VG-, G+, G-, VG++, M-, F/P) → um lado (geral).
 * Nunca inventa: sem sinal → `source: 'indefinido'`. O resultado final passa por
 * `scoreCondition`, que ESPELHA o grau quando só um lado foi encontrado (ver seu doc).
 */
export function parseConditionFromText(text: string | null | undefined): Condition {
  const rawTrim = (text ?? "").trim();
  if (!rawTrim) return { ...EMPTY_CONDITION };
  const folded = foldUpper(rawTrim);

  let media = gradeAfterLabel(folded, MEDIA_LABELS, SLEEVE_LABELS);
  let sleeve = gradeAfterLabel(folded, SLEEVE_LABELS, MEDIA_LABELS);

  if (!media && !sleeve) {
    // (2) rótulo geral OU combinado: aplica aos dois lados.
    const overall =
      gradeAfterLabel(folded, OVERALL_LABELS) ?? gradeAfterLabel(folded, COMBINED_LABELS);
    if (overall) {
      media = overall;
      sleeve = overall;
    } else {
      // (3) palavra de item inteiro sem rótulo.
      if (/\b(MINT|LACRAD[OA]|SELAD[OA]|IMPECAVEL)\b/.test(folded)) {
        media = "M";
        sleeve = "M";
      } else {
        // (4) uma única sigla forte solta (evita M/G/F/P sozinhos, ambíguos demais).
        const STRONG = /\b(VG\+\+|VG\+|VG-|M-|NM|EX|G\+|G-|F\/P)\b/g;
        const found = new Set<Grade>();
        for (const m of folded.matchAll(STRONG)) {
          const g = normalizeGrade(m[1]!);
          if (g) found.add(g);
        }
        if (found.size === 1) media = [...found][0]!;
      }
    }
  }

  const insert = detectInsert(rawTrim);
  const { media: m, sleeve: s, score, faixa } = scoreCondition(media, sleeve);
  const source: ConditionSource = m || s ? "regex" : "indefinido";
  return { media: m, sleeve: s, insert, score, faixa, source, raw: rawTrim };
}

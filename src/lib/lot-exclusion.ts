// Módulo puro/client-safe: extração de palavras-chave e heurística de "possível lixo"
// (sem IA — ver docs/notas-desenvolvimento.md, seção de exclusão de lotes).
import { hasStrongVinylSignal, normalizeForMatch } from "@/lib/vinyl-parse";

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

// ---------------------------------------------------------------------------
// "Possível lixo" — o que faz um lote excluído ser lixo, e não o que ele tem em comum
// ---------------------------------------------------------------------------
//
// A versão anterior marcava qualquer lote que dividisse 2 palavras QUAISQUER com um lote
// excluído — e as palavras em comum quase sempre eram de CONTEÚDO (artista, "ao vivo",
// "show"), não do que tornava aquilo lixo: excluir um "DVD Fulano Ao Vivo Show" passava a
// marcar todo "LP Beltrano Ao Vivo Show", que não tem DVD nenhum. Agora cada lote excluído é
// reduzido ao seu MOTIVO de ser lixo, em três camadas, da mais à menos confiável:
//  1. **Motivo informado pelo usuário** ao excluir ("máquina de costura", "kit de limpeza")
//     → vira uma expressão aprendida: todo lote com essa expressão no título é sinalizado.
//  2. **Indicador de tipo de objeto/formato** no título do excluído (DVD, CD, K7, livro,
//     boneco, relógio, toca-discos…, ver `INDICATORS`) → só sinaliza lote que TAMBÉM tem o
//     mesmo indicador; se o lote é claramente vinil (LP/vinil/compacto), exige ainda mais um
//     termo raro em comum.
//  3. **Sem motivo nem indicador** → sobreposição de 2+ termos RAROS (não usados por muitos
//     lotes da listagem atual, fora artista/álbum do próprio lote e palavras de conteúdo), e
//     nunca contra um lote claramente vinil quando o excluído não era (o que eles dividem só
//     pode ser conteúdo, não o motivo).
// Nada é escondido sozinho: só sinaliza (badge "possível lixo" no `LotCard`).

/** Indicadores de tipo de objeto/formato que NÃO é disco de vinil (rótulo → padrão). */
const INDICATORS: [string, RegExp][] = [
  ["dvd", /\bdvds?\b/],
  ["cd", /\bcds?\b/],
  ["blu-ray", /\bblu\s?ray\b/],
  ["vhs", /\bvhs\b/],
  ["k7", /\b(?:k7|cass?ett?es?)\b/],
  ["hq", /\b(?:hqs?|gibis?|quadrinhos?)\b/],
  ["revista", /\brevistas?\b/],
  ["livro", /\blivros?\b/],
  ["figurinha", /\bfigurinhas?\b/],
  ["boneco", /\bbonec[oa]s?\b/],
  ["brinquedo", /\bbrinquedos?\b/],
  ["miniatura", /\bminiaturas?\b/],
  ["estatueta", /\b(?:estatuetas?|action figures?)\b/],
  ["relogio", /\brelogios?\b/],
  ["telefone", /\btelefones?\b/],
  ["toca-discos", /\b(?:toca discos?|vitrolas?|radiolas?)\b/],
  [
    "aparelho de som",
    /\b(?:receivers?|amplificador(?:es)?|tape deck|cassete deck|equalizador(?:es)?|caixas? de som)\b/,
  ],
  ["agulha", /\b(?:agulhas?|capsulas?)\b/],
  ["movel", /\b(?:moveis|movel|porta lps?|porta discos?|estantes?)\b/],
  ["videogame", /\b(?:video ?games?|consoles?)\b/],
  ["camiseta", /\bcamisetas?\b/],
  ["poster", /\b(?:posters?|cartaz(?:es)?|quadros?|pinturas?|gravuras?)\b/],
  ["chaveiro", /\bchaveiros?\b/],
  ["caneca", /\b(?:canecas?|copos?|xicaras?)\b/],
  ["ingresso", /\bingressos?\b/],
  ["joia", /\b(?:joias?|bijuterias?|pulseiras?|colar(?:es)?|brincos?|aneis|anel|broches?)\b/],
  ["moeda", /\b(?:moedas?|cedulas?|medalhas?)\b/],
  ["perfume", /\bperfumes?\b/],
  ["lata", /\blatas?\b/],
];

/** Palavras de CONTEÚDO (tipo de gravação/estado) — nunca são o motivo de um lote ser lixo. */
const CONTENT_WORDS = new Set([
  "vivo",
  "show",
  "shows",
  "sucessos",
  "sucesso",
  "grandes",
  "volume",
  "vol",
  "trilha",
  "sonora",
  "novela",
  "coletanea",
  "edicao",
  "especial",
  "remasterizado",
  "duplo",
  "lacrado",
  "novo",
  "nova",
  "usado",
  "usada",
  "estado",
  "excelente",
  "otimo",
  "otima",
  "bom",
  "boa",
  "conservado",
  "conservada",
  "musica",
  "musicas",
  "banda",
  "orquestra",
  "ano",
  "anos",
  "gravadora",
  "selo",
  "stereo",
  "estereo",
  "mono",
]);

/** Palavras de um MOTIVO que não descrevem o objeto ("não é vinil", "lixo", "item de…"). */
const REASON_NOISE = new Set([
  ...STOPWORDS,
  "nao",
  "lixo",
  "item",
  "itens",
  "produto",
  "objeto",
  "coisa",
  "tipo",
  "outro",
  "outra",
  "isso",
  "isto",
  "esse",
  "essa",
  "este",
  "esta",
  "eh",
  "sao",
  "tem",
  "nada",
  "ver",
  "apenas",
  "so",
  "mas",
  "pois",
  "porque",
  "pq",
  "que",
  "errado",
  "errada",
  "categoria",
  "duplicado",
  "repetido",
]);

/** Um lote reduzido ao que interessa para o "possível lixo". */
export type TrashProfile = {
  /** Termos do título (sem artista/álbum do próprio lote, stopwords e palavras de conteúdo). */
  keywords: string[];
  /** Indicadores de tipo de objeto/formato não-vinil presentes no título (`INDICATORS`). */
  indicators: string[];
  /** Título normalizado (para achar as expressões aprendidas dos motivos). */
  text: string;
  /** O título diz claramente que é vinil (LP, vinil, compacto, rpm…). */
  strongVinyl: boolean;
};

function indicatorsOf(text: string): string[] {
  return INDICATORS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/**
 * Perfil de "possível lixo" de um título. `content` são textos que identificam o CONTEÚDO do
 * lote (artista efetivo, álbum da IA, título do release do Discogs): seus termos saem das
 * keywords — um lote não pode parecer lixo por causa do nome do próprio disco.
 */
export function trashProfile(lot: {
  title: string;
  artist?: string | null;
  content?: (string | null | undefined)[];
}): TrashProfile {
  const text = normalizeForMatch(lot.title);
  const contentTokens = new Set(
    (lot.content ?? []).flatMap((c) => (c ? normalizeForMatch(c).split(" ") : [])),
  );
  const keywords = extractKeywords(lot.title, lot.artist).filter(
    (t) => !CONTENT_WORDS.has(t) && !contentTokens.has(t),
  );
  return {
    keywords,
    indicators: indicatorsOf(text),
    text,
    strongVinyl: hasStrongVinylSignal(lot.title),
  };
}

/**
 * Expressões aprendidas do MOTIVO informado ao excluir ("máquina de costura; kit de limpeza")
 * — cada trecho separado por vírgula/ponto e vírgula/quebra de linha/" ou " vira uma
 * expressão (palavras significativas em ordem). Trechos que só dizem "não é vinil"/"lixo"
 * (sem descrever o objeto) não viram nada.
 */
export function reasonPhrases(reason: string | null | undefined): string[][] {
  if (!reason) return [];
  return reason
    .split(/[,;\n/]|\s+ou\s+/i)
    .map((part) =>
      normalizeForMatch(part)
        .split(" ")
        .filter(
          (t) => t && !REASON_NOISE.has(t) && !/^(?:vinil|vinis|vinyl|lps?|discos?)$/.test(t),
        ),
    )
    .filter((tokens) => tokens.length > 0 && tokens.join("").length >= 3);
}

/** Mesma palavra, tolerando plural simples ("maquina" × "maquinas"). */
function sameWord(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

/** A expressão aparece no texto: palavras em ordem, com no máximo 2 palavras entre elas. */
function containsPhrase(text: string, phrase: string[]): boolean {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    if (!sameWord(words[i]!, phrase[0]!)) continue;
    let pos = i;
    let ok = true;
    for (let k = 1; k < phrase.length && ok; k++) {
      let found = -1;
      for (let j = pos + 1; j < words.length && j <= pos + 3; j++) {
        if (sameWord(words[j]!, phrase[k]!)) {
          found = j;
          break;
        }
      }
      if (found < 0) ok = false;
      else pos = found;
    }
    if (ok) return true;
  }
  return false;
}

/** Lote excluído preparado para comparação (ver `buildTrashModel`). */
type ExcludedProfile = {
  title: string;
  phrases: string[][];
  indicators: string[];
  keywords: string[];
  strongVinyl: boolean;
};

export type TrashModel = {
  excluded: ExcludedProfile[];
  /** Termos usados por muitos lotes da listagem atual — são conteúdo, não motivo de lixo. */
  common: ReadonlySet<string>;
  denylist: ReadonlySet<string>;
};

/** A partir de quantos lotes (e de que fração da listagem) um termo é "comum" demais. */
const COMMON_MIN_LOTS = 20;
const COMMON_MIN_SHARE = 0.03;

/**
 * Prepara o modelo uma vez por listagem: perfis dos lotes excluídos (motivo, indicadores,
 * keywords) e o conjunto de termos COMUNS na listagem atual (`corpus` = perfis dos lotes
 * carregados). `denylist` são termos/expressões que o usuário já disse que NÃO indicam lixo
 * (clique no badge — `trash_keyword_denylist`), ignorados em todas as camadas.
 */
export function buildTrashModel(
  excluded: { title: string; keywords?: string[] | null; reason?: string | null }[],
  corpus: TrashProfile[],
  denylist?: ReadonlySet<string>,
): TrashModel {
  const deny = denylist ?? new Set<string>();
  const df = new Map<string, number>();
  for (const p of corpus) for (const k of new Set(p.keywords)) df.set(k, (df.get(k) ?? 0) + 1);
  const minLots = Math.max(COMMON_MIN_LOTS, corpus.length * COMMON_MIN_SHARE);
  const common = new Set<string>();
  for (const [k, n] of df) if (n >= minLots) common.add(k);

  // Expressão de motivo presente em muitos lotes da listagem ("capa", "raro") é genérica
  // demais para indicar lixo — descartada (mesmo corte dos termos comuns).
  const phraseCount = new Map<string, number>();
  const tooCommon = (ph: string[]): boolean => {
    const key = ph.join(" ");
    let n = phraseCount.get(key);
    if (n == null) {
      n = 0;
      for (const p of corpus) if (containsPhrase(p.text, ph)) n++;
      phraseCount.set(key, n);
    }
    return n >= minLots;
  };

  const profiles: ExcludedProfile[] = [];
  for (const ex of excluded) {
    const p = trashProfile({ title: ex.title });
    // As keywords gravadas na exclusão já vêm sem o artista daquele lote; preferir elas.
    const kw = (ex.keywords?.length ? ex.keywords : p.keywords).filter(
      (k) => !CONTENT_WORDS.has(k) && !common.has(k) && !deny.has(k),
    );
    profiles.push({
      title: ex.title,
      phrases: reasonPhrases(ex.reason).filter((ph) => !deny.has(ph.join(" ")) && !tooCommon(ph)),
      indicators: p.indicators.filter((i) => !deny.has(i)),
      keywords: Array.from(new Set(kw)),
      strongVinyl: p.strongVinyl,
    });
  }
  return { excluded: profiles, common, denylist: deny };
}

// Termos raros em comum exigidos quando não há motivo nem indicador (camada 3).
const MIN_OVERLAP = 2;

export type ExclusionSignal = { matchedTerms: string[]; excludedTitle: string };

/**
 * Devolve o primeiro lote excluído que explica o lote `lot` como "possível lixo" (ou null),
 * pelas três camadas descritas no topo desta seção. `matchedTerms` são os termos/expressões
 * que causaram o sinal — o clique no badge os nega (`trash_keyword_denylist`).
 */
export function matchPossibleTrash(lot: TrashProfile, model: TrashModel): ExclusionSignal | null {
  const { denylist, common } = model;
  const lotKw = new Set(lot.keywords.filter((k) => !denylist.has(k) && !common.has(k)));
  const lotInd = new Set(lot.indicators.filter((i) => !denylist.has(i)));

  // 1) Motivo informado pelo usuário — o sinal mais forte (vale até para lote "vinil": "kit de
  //    limpeza para vinil" continua sendo kit de limpeza).
  for (const ex of model.excluded) {
    const hit = ex.phrases.find((ph) => containsPhrase(lot.text, ph));
    if (hit) return { matchedTerms: [hit.join(" ")], excludedTitle: ex.title };
  }

  for (const ex of model.excluded) {
    const shared = ex.keywords.filter((k) => lotKw.has(k));
    if (ex.indicators.length) {
      // 2) Indicador de tipo de objeto/formato: o lote precisa ter o MESMO indicador.
      const sharedInd = ex.indicators.filter((i) => lotInd.has(i));
      if (!sharedInd.length) continue;
      const others = shared.filter((k) => !sharedInd.includes(k));
      if (lot.strongVinyl && !others.length) continue; // "LP + DVD bônus" não basta sozinho
      return { matchedTerms: [...sharedInd, ...others], excludedTitle: ex.title };
    }
    // 3) Sem motivo nem indicador: termos raros em comum — nunca contra um lote claramente
    //    vinil quando o excluído não era (o que eles dividem só pode ser conteúdo).
    if (lot.strongVinyl && !ex.strongVinyl) continue;
    if (shared.length >= MIN_OVERLAP) return { matchedTerms: shared, excludedTitle: ex.title };
  }
  return null;
}

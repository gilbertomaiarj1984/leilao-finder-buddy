import { KNOWN_ARTISTS_SEED } from "./known-artists-seed";

export type VinylLot = {
  id: string;
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string; // número do lote exibido (ex.: "123"); "" quando não identificado
  watched: boolean;
  title: string;
  url: string;
  image: string | null;
  price: string;
  dayKey: string; // yyyy-mm-dd
  time: string; // e.g. "19:30h"
  uf: string;
  house: string;
  houseUrl: string;
  artist: string; // "" when unidentified
};

const VINYL_HINTS = [
  "lp",
  "lps",
  "disco",
  "discos",
  "disco de vinil",
  "discos de vinil",
  "vinil",
  "vinis",
  "vinyl",
  "compacto",
  "compactos",
  "bolachao",
  "bolachão",
  "long play",
  "78 rpm",
];

const NON_VINYL_HINTS = ["cd ", " cd", "dvd", "blu-ray", "fita k7", "k7", "cassete", "cassette"];

// Colecionismo GERAL sem NADA a ver com disco (ex-libris, pin/broche, numismática, filatelia,
// perfumaria, couro/bijuteria…) — casas que vendem de tudo às vezes colocam esses itens na
// MESMA categoria "Disco de vinil" do site (ou o filtro `Tipo=129` não é honrado pela casa) e
// eles entram na nossa varredura/captura por não baterem em NENHUM formato de mídia bloqueado
// (CD/DVD/K7…). Cada item vira seu próprio "álbum" no Analytics (preço de uma coisa que não é
// disco). Lista por CATEGORIA de colecionismo, não por marca/evento — cresce conforme aparecem
// casos reais.
const NON_MEDIA_COLLECTIBLE_RE =
  /\b(ex-?libris|pin\s+de\s+lapela|broche|medalh(?:a|ao|oes|as)|moedas?|cedulas?|numismatic\w*|selos?\s+postais?|filatelic\w*|porta-?moedas|carteira\s+de\s+couro|cinto\s+de\s+couro|perfume|colonia|fragrancia|estatueta|porcelana)\b/;
// Callout de DIMENSÃO física ("TAM: 12,4CM X 9CM") — típico de gravura/print/foto/cartão
// postal, NUNCA de um disco (LP/compacto tem tamanho padrão, não descrito item a item).
const PAPER_DIMENSION_RE = /\btam[.:]?\s*\d+(?:[,.]\d+)?\s*cm\s*x\b/;

/**
 * Decodifica entidades HTML de um texto vindo de atributo/markup (`&#34;`, `&amp;`, `&#xE7;`…).
 * Algumas casas colocam a descrição completa do lote no atributo `title` do card (o tooltip
 * do site), e o parser de HTML usado na varredura NÃO decodifica entidades de atributos — daí
 * títulos aparecerem com `&#34;` literal em vez de `"`. Cobre nomeadas comuns + numéricas
 * (decimais e hex).
 *
 * ⚠️ DUPLA codificação: várias casas gravam o texto já escapado DUAS vezes (`&amp;#34;` em vez
 * de `&#34;`) — uma passada só decodifica o `&amp;` externo e deixa `&#34;` visível. Por isso
 * decodificamos em LOOP até a string estabilizar (teto de 5 passadas para evitar patologias).
 */
export function decodeHtmlEntities(s: string): string {
  let prev = s;
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/gi, "&");
    if (next === prev) break;
    prev = next;
  }
  return prev.replace(/\s+/g, " ").trim();
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isVinylTitle(title: string): boolean {
  const t = ` ${normalize(title)} `;
  const hasVinyl = VINYL_HINTS.some((hint) =>
    hint.length <= 3 ? new RegExp(`\\b${hint}\\b`).test(t) : t.includes(hint),
  );
  if (!hasVinyl) return false;
  // Only reject when the title looks like a non-vinyl format and never says vinil/LP disc.
  const mentionsDisc = t.includes("vinil") || /\blps?\b/.test(t) || t.includes("compacto");
  if (!mentionsDisc && NON_VINYL_HINTS.some((hint) => t.includes(hint))) return false;
  return true;
}

/**
 * A varredura já é feita na CATEGORIA "Disco de vinil" (parâmetro `tp`), então
 * TODO lote retornado já é vinil. Portanto NÃO exigimos uma palavra-chave de vinil
 * no título — casas dedicadas a vinil listam por artista/álbum ("Beatles - Abbey
 * Road") sem repetir "vinil/LP", e exigir a palavra descartava esses lotes (bug:
 * casa com 200+ lotes aparecia com 2). Aqui só descartamos o que é claramente de
 * OUTRO formato (CD/DVD/K7) e não menciona vinil.
 */
export function looksNonVinyl(title: string): boolean {
  const t = ` ${normalize(title)} `;
  const mentionsVinyl =
    t.includes("vinil") ||
    t.includes("vinyl") ||
    t.includes("disco") ||
    /\blps?\b/.test(t) ||
    t.includes("compacto") ||
    t.includes("bolachao") ||
    t.includes("long play");
  if (mentionsVinyl) return false;
  return (
    NON_VINYL_HINTS.some((hint) => t.includes(hint)) ||
    NON_MEDIA_COLLECTIBLE_RE.test(t) ||
    PAPER_DIMENSION_RE.test(t)
  );
}

// Sinal FORTE de vinil (formato explícito) — "disco" sozinho NÃO conta (DVD também é "disco").
const VINYL_STRONG_RE =
  /\b(?:lps?|vinil|vinyl|compactos?|bolach[aã]o|long\s*play|78\s*rpm|33\s*rpm)\b/;
// Formatos que NÃO são vinil (inequívocos) — no histórico de vendas/Analytics excluímos o
// lote inteiro quando aparecem SEM sinal forte de vinil. Cobre DVD/HQ/revista/livro/K7/VHS…
const NON_VINYL_SALE_RE =
  /\b(?:dvds?|blu[-\s]?ray|vhs|hqs?|gibis?|quadrinhos?|revistas?|livros?|figurinhas?|fita\s*k7|k7|cass?ete?s?)\b/;

/**
 * No contexto de VENDAS/Analytics: true quando o lote é claramente de OUTRO formato
 * (DVD, HQ/gibi, revista, livro, K7, VHS…), de colecionismo geral sem nada a ver com disco
 * (ex-libris, pin, numismática, perfumaria, couro…) ou traz callout de DIMENSÃO física
 * ("TAM: 12,4CM X 9CM", típico de gravura/print) — e NÃO há sinal forte de vinil no texto. Mais
 * rígido que `looksNonVinyl`: aqui "disco" sozinho não salva o lote (um DVD também é "disco").
 * Serve para EXCLUIR do histórico o que caiu por engano (ex.: grupos "2 dvds", "hqs", itens de
 * colecionismo geral que a casa lista na mesma categoria "Disco de vinil").
 */
export function looksNonVinylSale(text: string): boolean {
  const t = ` ${normalize(text)} `;
  if (VINYL_STRONG_RE.test(t)) return false;
  return (
    NON_VINYL_SALE_RE.test(t) || NON_MEDIA_COLLECTIBLE_RE.test(t) || PAPER_DIMENSION_RE.test(t)
  );
}

/**
 * true quando o status do meu lance é um resultado POSITIVO (cor verde na UI):
 * ganhando agora ("Vencendo") OU já arrematado/vencedor com o leilão encerrado
 * ("Arrematado"/"Vencedor"/"Arrebatado"). Casa os mesmos tokens de "winning" + "won"
 * de `classifyBid` (grouping.ts) para as duas rotas de cor não divergirem — antes só
 * `/venc/` marcava verde, então "Arrematado" (sem "venc") caía como vermelho.
 * "Coberto"/"Coberto e Vendido"/"Não vendido" continuam retornando false.
 */
export function bidIsWinning(status: string): boolean {
  return /venc|arremat|arrebat/i.test(status ?? "");
}

/**
 * Converte um preço em texto BR ("R$ 1.234,56": ponto de milhar, vírgula decimal)
 * para número. Retorna null quando não há valor numérico (ex.: "sem valor", "--").
 */
export function parsePrice(raw: string): number | null {
  const cleaned = (raw ?? "").replace(/[^\d,]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const UNCLASSIFIED_HINTS = [
  "novela",
  "trilha sonora",
  "trilha original",
  "coletanea",
  "coletaneas",
  "sucessos",
  "internacional",
  "nacional",
  "lote com",
  "lote de",
  "diversos",
  "varios",
  "musicas",
  "sertanejo",
  "carnaval",
  "infantil",
  "seleção",
  "selecao",
];

// Rótulos de campo que aparecem no próprio título ("Artista: X | Album: Y") e nunca são
// nomes de artista — usados para descartar candidatos espúrios em `extractArtist`.
const LABEL_WORDS = new Set(["artista", "album", "albuns", "titulo", "faixa", "faixas"]);

const PREFIX_PATTERNS: RegExp[] = [
  /^lote\s*(n?[ºo°]?\s*\d+)?\s*[-:–]?\s*/i,
  /^\d+\s*(lps?|discos?|vinis|compactos?)\b\s*[-:–]?\s*/i,
  /^(belissimo|belíssimo|belo|raro|rarissimo|raríssimo|antigo|otimo|ótimo|excelente)\s+/i,
  /^(lps?|long\s*play|discos?\s*de\s*vinil|disco\s*de\s*vinil|discos?|vinis|vinil|compactos?|compacto|bolach[aã]o|album|álbum)\b\s*[-:–,.]?\s*/i,
];

/** Rótulo do "artista" para lotes que são um conjunto/coleção de vários discos. */
export const LOTE_LABEL = "Lote";

/** Rótulo/sentinela do "artista" para coletâneas (vários artistas, sucessos, trilhas). */
export const COMPILATION_LABEL = "Coletâneas";

/**
 * Balaio do Vinil Analytics para onde vão coletâneas e novelas (curadoria do usuário). O nome
 * casa com o balaio criado à mão via curadoria — como o agrupamento é por `normalizeForMatch`,
 * pequenas diferenças de grafia caem no MESMO grupo.
 */
export const ANALYTICS_COMPILATION_LABEL = "Coletâneas, Novela e etc";

// "Artistas" que na verdade são um balaio de LOTE/lixo de catálogo (não um nome real): o próprio
// "Lote", códigos de casa tipo "Discos5"/"Discos 6" e placeholders de pregão ("Proposta de Lote
// Para Leilão"). Já normalizados (sem acento/caixa/pontuação). Alvo da IA de identificação.
const JUNK_ARTIST_RE = /^discos?\s*\d+$/;
const LOTE_PLACEHOLDER_HINTS = ["proposta de lote", "lote para leilao"];

// Sinais no TÍTULO de que o disco é uma coletânea (vários artistas / sucessos / trilha /
// novela), e não o álbum de um artista específico. Normalizados (sem acento, minúsculo).
const COMPILATION_HINTS = [
  "coletanea",
  "coletaneas",
  "coletania",
  "sucessos",
  "grandes sucessos",
  "as melhores",
  "varios artistas",
  "varios interpretes",
  "various artists",
  "diversos interpretes",
  "diversos artistas",
  "trilha sonora",
  "trilha original",
  "trilha de novela",
  "novela",
  "selecao de sucessos",
];

// Valores de "artista" (vindos da IA ou do título) que representam uma coletânea, não uma
// pessoa/banda. Comparados já normalizados por `normalizeForMatch`.
const VARIOUS_ARTIST_NAMES = new Set([
  "varios",
  "varios artistas",
  "varios interpretes",
  "various",
  "various artists",
  "va",
  "diversos",
  "diversos artistas",
  "diversos interpretes",
  "coletanea",
  "coletaneas",
  "artistas variados",
]);

/** true quando o TÍTULO indica uma coletânea (vários artistas / sucessos / trilha / novela). */
export function isCompilation(title: string): boolean {
  const t = normalize(title);
  return COMPILATION_HINTS.some((hint) => t.includes(hint));
}

/** true quando um nome de "artista" na verdade representa vários artistas (coletânea). */
export function isVariousArtists(name: string): boolean {
  return VARIOUS_ARTIST_NAMES.has(normalizeForMatch(name));
}

// Palavras que confirmam que o título fala de disco(s) — usadas com termos genéricos
// ("diversos", "coleção de") para só classificar como lote quando há contexto de disco.
const DISC_WORD = /\b(lps?|discos?|vinis|vinil|compactos?|bolach[aã]o|bolachoes|long play)\b/;

// Quantidade por extenso ("cinco LPs", "dez discos") — casas descrevem o lote em prosa, sem
// dígito. Mapeado (sem acento) para o número; abaixo de 3 nunca conta como lote (duplo/triplo
// de um mesmo álbum). Cobre até "vinte", o suficiente para os lotes reais observados.
const NUM_WORDS: Record<string, number> = {
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
};
const NUM_WORD_RE = Object.keys(NUM_WORDS).join("|");

// Rótulo de NUMERAÇÃO do lote no início do título ("Lote 45 - ...", "Lote 09 vinil único...",
// "Lote nº 12: ..."), que NÃO indica conjunto de discos — é só o número do item no leilão
// (todo item tem um "lote"). Exige um NÚMERO ou um separador logo após "lote" para ser
// considerado rótulo — "lote surpresa de vinis" (sem número/separador) NÃO é rótulo de
// numeração e segue para a checagem genérica de "lote" abaixo. Removido ANTES de toda checagem
// para não confundir "Lote 45 - LP raro"/"Lote 09 vinil único..." (um disco só, número do
// lote colado no formato) com um lote de VÁRIOS discos.
const LOTE_NUMBER_PREFIX = /^lote\s*(?:n?[ºo°]?\s*\d+\s*[-:–,.]?|[-:–,.])\s*/;

/**
 * true quando o título representa um LOTE de discos (conjunto de vários discos vendidos
 * juntos), e não um álbum específico. Sinais: "lote com/de/composto por/formado por/contendo
 * ...", "kit com/de ...", "coleção de discos", quantidade (3+) de discos em dígito ("20 LPs")
 * OU por extenso ("cinco LPs"), "diversos/vários" + disco, ou a palavra "lote" (fora do rótulo
 * de numeração do início) em qualquer lugar do título junto de uma palavra de disco — cobre
 * frases não previstas nos padrões específicos acima. Discos duplos/triplos de um mesmo álbum
 * (ex.: "2 LPs") NÃO contam como lote.
 */
export function isDiscBundle(title: string): boolean {
  const raw = normalize(title);
  // Remove o RÓTULO de numeração do início ("Lote 45 - ...", "Lote 09 vinil único...") ANTES
  // de qualquer checagem: senão o número do lote (ex.: "09") cola no disc word seguinte
  // ("vinil") e o padrão de QUANTIDADE abaixo interpreta erroneamente "09 vinil" como "9 vinis"
  // — um item de UM disco só virava lote por coincidência de o nº do lote vir logo antes do
  // formato. A partir daqui `t` nunca mais vê esse número/rótulo.
  const t = raw.replace(LOTE_NUMBER_PREFIX, "");
  if (/\b(lote|kit)\s+(com|de|composto\s+(de|por)|formado\s+(de|por)|contendo)\b/.test(t))
    return true;
  if (/\bcolecao de\b/.test(t) && DISC_WORD.test(t)) return true;
  const qty = t.match(
    new RegExp(
      `\\b(\\d+|${NUM_WORD_RE})\\s*(lps?|discos?|vinis|vinil|compactos?|bolach[aã]o|bolachoes)\\b`,
    ),
  );
  if (qty) {
    const rawQty = qty[1]!;
    const n = /^\d+$/.test(rawQty) ? Number(rawQty) : NUM_WORDS[rawQty];
    if (n != null && n >= 3) return true;
  }
  if (/\b(diversos|varios|varias)\b/.test(t) && DISC_WORD.test(t)) return true;
  // "lote" sobrando em qualquer lugar (fora do rótulo já removido) + palavra de disco: cobre
  // frases não previstas acima (ex.: "grande lote de discos", "lote surpresa de vinis").
  if (/\blote\b/.test(t) && DISC_WORD.test(t)) return true;
  return false;
}

// "Grandes Sucessos de X" / "Sucessos de X" / "As Melhores de X" / "O Melhor de X" — um "best
// of" de UM artista específico, não uma coletânea de vários intérpretes. Sem isso, o "de X" no
// FIM do título (sem separador "-") nunca chegava a ser tentado como candidato: a checagem de
// UNCLASSIFIED_HINTS batia em "sucessos"/"melhores" antes de olhar pro nome depois do "de".
const COMPILATION_TAIL_RE =
  /\b(?:grandes\s+sucessos|sucessos|as\s+melhores|melhores|o\s+melhor)\s+d[eo]\s+(.+)$/i;

// "Sucessos de OURO/PRATA/ÉPOCA…" é o NOME DA SÉRIE de coletânea (tipo "Golden Hits"), não um
// artista chamado "Ouro" — sem essa trava, o padrão acima promoveria o qualificador a "artista".
const COMPILATION_SERIES_QUALIFIERS = new Set(["ouro", "prata", "bronze", "platina", "epoca"]);

/**
 * Best-effort artist extraction from a lot title. Returns `LOTE_LABEL` for lots that are a
 * bundle of several discs, and "" when the title looks like a compilation / soundtrack or
 * no artist can be isolated.
 */
export function extractArtist(title: string): string {
  if (isDiscBundle(title)) return LOTE_LABEL;

  let rest = title.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of PREFIX_PATTERNS) {
      const next = rest.replace(pattern, "");
      if (next !== rest) {
        rest = next.trim();
        changed = true;
      }
    }
  }

  // "Grandes Sucessos de Ray Charles" → candidato = "Ray Charles" (tira o padrão ANTES do
  // dash-split abaixo: aqui não há "-", o nome vem depois de "de/do" no fim do título). Só a
  // PRIMEIRA palavra do resto entra na trava do qualificador de série (`.+$` é guloso e pegaria
  // "Ouro - MPB" inteiro em "Sucessos de Ouro - MPB"; o qualificador mora sempre logo após "de").
  const tailMatch = rest.match(COMPILATION_TAIL_RE);
  if (tailMatch) {
    const tail = tailMatch[1]!.trim();
    const tailFirstWord = normalize(tail).split(/[\s\-–—]+/)[0] ?? "";
    if (!COMPILATION_SERIES_QUALIFIERS.has(tailFirstWord)) rest = tail;
  }

  // "ARTISTA - TITULO" / "ARTISTA – TITULO" / "ARTISTA: TITULO" / "ARTISTA. resto". Um "best of"
  // de artista identificável ("Jorge Ben Jor - Grandes Sucessos") tem candidato válido À
  // ESQUERDA do separador mesmo com "sucessos" no título — por isso NÃO descartamos pelo título
  // INTEIRO aqui; a checagem de coletânea roda só no CANDIDATO final (abaixo), que é o nome
  // isolado, não a frase toda. Só falha quando não sobra um nome específico (ex.: "Grandes
  // Sucessos" sozinho, "Trilha Sonora Novela Tieta" sem artista).
  const parts = rest.split(/\s[-–—:]\s|[-–—:](?=\s)|\s[-–—](?=\S)/);
  let candidate = (parts[0] ?? "").trim();

  // Cut trailing sentences / album names / parentheses: "Artista. Produto original..."
  // NÃO corta em "/": bandas reais usam a barra no PRÓPRIO nome ("AC/DC") — cortar ali truncava
  // pra "AC" e o candidato morria no filtro de tamanho mínimo abaixo, ficando sempre sem artista.
  candidate = candidate.split(/["“”(]/)[0]!;
  candidate = candidate.split(/\.\s+|,\s+|;\s+/)[0]!;
  candidate = candidate
    .replace(/[(),.;:]+$/g, "")
    .replace(/^[(),.;:]+/g, "")
    .trim();
  candidate = candidate.replace(/\s+(vol\.?|volume)\s*\d*$/i, "").trim();

  const normCandidate = normalize(candidate);
  if (!normCandidate) return "";
  // Nomes muito curtos são ruído (siglas, "lp", "cd"…) — MAS aceita os curtos com dígito, que são
  // artistas reais ("U2", "U4", "B52"): 1 caractere nunca; 2 caracteres só quando há um dígito.
  if (normCandidate.length < 2) return "";
  if (normCandidate.length < 3 && !/\d/.test(normCandidate)) return "";
  if (normCandidate.split(" ").length > 5) return "";
  if (/^\d+$/.test(normCandidate)) return "";
  // Títulos no formato "LP: Artista: X | Album: Y" deixam o rótulo "Artista"/"Álbum"
  // como 1º token antes do ":"; nunca é um nome de artista real — descarta para não
  // criar um grupo espúrio "Artista" (o valor real vem da identificação da IA).
  if (LABEL_WORDS.has(normCandidate)) return "";
  if (UNCLASSIFIED_HINTS.some((hint) => normCandidate.includes(hint))) return "";
  // Mesma trava, mas com os gatilhos de COLETÂNEA (`isCompilation`) — cobre frases como "As
  // Melhores da MPB" que sobram como candidato inteiro (sem "-"/"de X" pra extrair um nome) e
  // não estão em UNCLASSIFIED_HINTS: sem isso, a frase virava "artista" (ex.: "As Melhores Da
  // Mpb"), inclusive sobrescrevendo um `isVariousArtists` já correto ao rederivar na leitura.
  if (COMPILATION_HINTS.some((hint) => normCandidate.includes(hint))) return "";

  // "ACDC" (casa digitou colado) → "AC/DC" (grafia canônica do bundle) — une com "AC DC"/
  // "AC-DC"/"AC/DC", que já caem na mesma chave via `normalizeForMatch` (separador vira espaço).
  return canonicalizeCollapsedArtist(titleCase(candidate));
}

const LOWER_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "of",
  "the",
  "and",
  "a",
  "o",
  "y",
  "los",
  "las",
  "le",
  "la",
  "des",
  "du",
  "van",
  "von",
]);

export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWER_WORDS.has(word)
        ? word
        : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1),
    )
    .join(" ")
    .trim();
}

export const UNCLASSIFIED_LABEL = "Novelas, coletâneas e não classificados";

// "Artistas" genéricos/lixo que o `extractArtist` produz de títulos ruidosos: categorias
// ("Colecionismo"), formato ("Duplo"), coletânea ("Various Artists", "Various", "Vários"),
// descritor de faixa ("Ao Vivo") ou rótulo solto ("Código"). Não são nomes de artista — o
// valor real precisa vir da IA de identificação. Já normalizados (sem acento, minúsculo).
const GENERIC_ARTISTS = new Set([
  "lote",
  "colecionismo",
  "colecao",
  "acervo",
  "duplo",
  "triplo",
  "quadruplo",
  "various",
  "various artists",
  "va",
  "varios",
  "varios artistas",
  "coletanea",
  "coletaneas",
  "ao vivo",
  "codigo",
  "novela",
  "novelas",
  "trilha sonora",
  "trilha original",
  "importado",
  "nacional",
  "internacional",
  "sucessos",
  "diversos",
  "promocional",
  "single",
  "compacto",
  "selecao",
  "selecoes",
]);

/**
 * true quando o "artista" é genérico/lixo (categoria, formato, coletânea, rótulo solto ou
 * vazio) e NÃO um nome real — casos em que o artista/álbum corretos devem ser buscados pela IA
 * de identificação. Ex.: "Colecionismo", "Duplo", "Various Artists", "Various", "Ao Vivo",
 * "Ao vivo | Código" (resto de parse com "|").
 */
export function isGenericArtist(artist: string | null | undefined): boolean {
  const a = normalize(artist ?? "");
  if (!a) return true; // vazio → agrupa em "não classificados"
  if (a.includes("|")) return true; // resto de "X | Código"
  if (GENERIC_ARTISTS.has(a)) return true;
  if (JUNK_ARTIST_RE.test(a)) return true; // "Discos5", "Discos 6" (código de casa, não artista)
  if (LOTE_PLACEHOLDER_HINTS.some((hint) => a.includes(hint))) return true; // placeholder de lote
  // Rótulo/dica de coletânea como o texto inteiro (não um nome de artista).
  if (UNCLASSIFIED_HINTS.some((hint) => a === hint)) return true;
  return false;
}

/** Parses "20/8/2026 - 19:30h - MG" style info lines. */
export function parseInfoLine(line: string): { dayKey: string; time: string } | null {
  const match = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*([\dh:.]+)/);
  if (!match) return null;
  const [, d, m, y, time] = match;
  const dayKey = `${y}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  return { dayKey, time: time!.replace(/\.$/, "") };
}

export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day keys for today + the next (count - 1) days, in São Paulo time. */
export function upcomingDayKeys(count = 3, now = new Date()): string[] {
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(sp);
    d.setDate(sp.getDate() + i);
    return toDayKey(d);
  });
}

export function formatDayLabel(dayKey: string, dayKeys: string[]): string {
  const index = dayKeys.indexOf(dayKey);
  const [y, m, d] = dayKey.split("-");
  const short = `${d}/${m}`;
  if (index === 0) return `Hoje · ${short}`;
  if (index === 1) return `Amanhã · ${short}`;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short" });
  return `${weekday.replace(".", "")} · ${short}`;
}

/** Instante de início do leilão (dia + hora, fuso São Paulo) em ms, ou null. */
function auctionStartMs(dayKey: string, time: string): number | null {
  const match = time.match(/(\d{1,2})[:h.]?(\d{2})?/);
  if (!match) return null;
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = (match[2] ?? "00").padStart(2, "0");
  const start = new Date(`${dayKey}T${hh}:${mm}:00-03:00`).getTime();
  return Number.isFinite(start) ? start : null;
}

/** true se o horário de início do leilão já passou. */
export function auctionStarted(dayKey: string, time: string, now: number = Date.now()): boolean {
  const start = auctionStartMs(dayKey, time);
  return start !== null && start <= now;
}

/**
 * true quando o leilão é considerado finalizado: passou `graceHours` (padrão 3h)
 * do horário de início. O site não informa o término, então usamos essa janela.
 */
export function auctionFinished(
  dayKey: string,
  time: string,
  now: number = Date.now(),
  graceHours = 3,
): boolean {
  const start = auctionStartMs(dayKey, time);
  return start !== null && now - start >= graceHours * 60 * 60 * 1000;
}

// --- Base de nomes conhecidos (reforço da classificação de artista) ---

/** Normalização para casar nomes: remove acentos e pontuação, baixa a caixa. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Índice preguiçoso: forma COLADA (só letras/números, sem espaço nem pontuação) de cada nome
// conhecido com separador interno → nome canônico do bundle. Ex.: "AC/DC" normaliza por token
// pra "ac dc" (2 palavras, já une "AC/DC"/"AC DC"/"AC-DC"), mas "ACDC" (casas digitam colado,
// sem separador nenhum) normaliza pra "acdc" — 1 palavra DIFERENTE, escapando dessa união. Só
// nomes com mais de uma palavra entram (nome de 1 palavra não tem essa ambiguidade).
let collapsedKnownArtistIndex: Map<string, string> | null = null;
function getCollapsedKnownArtistIndex(): Map<string, string> {
  if (collapsedKnownArtistIndex) return collapsedKnownArtistIndex;
  const map = new Map<string, string>();
  for (const name of KNOWN_ARTISTS_SEED) {
    const spaced = normalizeForMatch(name);
    if (!spaced.includes(" ")) continue;
    const collapsed = spaced.replace(/\s+/g, "");
    if (collapsed.length < 3 || map.has(collapsed)) continue;
    map.set(collapsed, name);
  }
  collapsedKnownArtistIndex = map;
  return map;
}

/**
 * Canonicaliza um nome de artista conhecido por aparecer ora COLADO ("ACDC"), ora com
 * separador ("AC/DC", "AC DC", "AC-DC") — casa contra o bundle de nomes conhecidos pela forma
 * colada e devolve a grafia canônica; sem bater, devolve o nome original inalterado. Casamento
 * é por EXATO (nunca aproximado), então não corre risco de fundir artistas diferentes.
 */
export function canonicalizeCollapsedArtist(name: string): string {
  const collapsed = normalizeForMatch(name).replace(/\s+/g, "");
  if (collapsed.length < 3) return name;
  return getCollapsedKnownArtistIndex().get(collapsed) ?? name;
}

/** Quantidade de acentos numa string (desempate de grafia — mais acentuada é a "correta"). */
function accentScore(s: string): number {
  return (s.normalize("NFD").match(/[\u0300-\u036f]/g) ?? []).length;
}

/**
 * Escolhe a MELHOR grafia entre variações do mesmo nome (mesmo `normalizeForMatch`):
 * mais acentuada, depois mais longa, depois ordem alfabética. Usado para juntar registros
 * que só diferem por acento/caixa/pontuação (ex.: "Alceu Valença" = "Alceu Valenca") num
 * único nome canônico — evita 2 registros para o mesmo artista/álbum.
 */
export function pickCanonical(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (!list.length) return "";
  return list.sort(
    (a, b) => accentScore(b) - accentScore(a) || b.length - a.length || a.localeCompare(b, "pt-BR"),
  )[0]!;
}

/**
 * Relevância de um lote para a busca, para ordenar "mais exato primeiro, parecidos depois".
 * `queryNorm` já vem normalizado (via `normalizeForMatch`). Camadas, da mais forte à mais
 * fraca; 0 = não corresponde (não deve aparecer):
 *   5 — a IDENTIDADE (artista/álbum/título) começa com a frase digitada
 *   4 — a frase digitada aparece contígua na identidade
 *   3 — todos os termos aparecem na identidade (ordem livre)
 *   2 — a frase digitada aparece em qualquer campo (casa/nº do lote inclusos)
 *   1 — todos os termos aparecem em qualquer campo
 * Assim, buscar "clara nunes" põe os discos dela na frente e só depois traz um lote de
 * outra pessoa numa casa que por acaso contém os termos.
 */
export function searchRelevance(identity: string, extra: string, queryNorm: string): number {
  if (!queryNorm) return 1;
  const id = normalizeForMatch(identity);
  const full = normalizeForMatch(`${identity} ${extra}`);
  const tokens = queryNorm.split(" ").filter(Boolean);
  const allIn = (hay: string) => tokens.every((t) => hay.includes(t));
  if (id.startsWith(queryNorm)) return 5;
  if (id.includes(queryNorm)) return 4;
  if (allIn(id)) return 3;
  if (full.includes(queryNorm)) return 2;
  if (allIn(full)) return 1;
  return 0;
}

// Nomes de UMA palavra que também são palavras comuns (PT/EN) e gerariam falsos
// positivos; só entram na base como parte de nomes com 2+ palavras.
const AMBIGUOUS_SINGLE_WORDS = new Set([
  "free",
  "love",
  "zero",
  "cream",
  "sweet",
  "angel",
  "death",
  "family",
  "spirit",
  "war",
  "air",
  "can",
  "yes",
  "mud",
  "egg",
  "dust",
  "fist",
  "toad",
  "bang",
  "art",
  "peso",
  "stress",
  "strike",
  "oriente",
  "sensacao",
  "evolucao",
  "abolicao",
  "overdose",
  "devotos",
  "inocentes",
  "replicantes",
  "chic",
  "mina",
  "jane",
  "nico",
  "sade",
  "dio",
  "jesus",
  "zero",
]);

const LEADING_ARTICLES = ["the ", "os ", "as ", "o ", "a "];

export type KnownArtistIndex = { byNorm: Map<string, string>; maxWords: number };

/** Constrói o índice de busca a partir da lista de nomes canônicos. */
export function buildKnownArtistIndex(names: string[]): KnownArtistIndex {
  const byNorm = new Map<string, string>();
  let maxWords = 1;
  const add = (key: string, canonical: string) => {
    const words = key.split(" ").filter(Boolean);
    if (!words.length) return;
    if (words.length === 1 && (key.length < 4 || AMBIGUOUS_SINGLE_WORDS.has(key))) return;
    if (!byNorm.has(key)) byNorm.set(key, canonical);
    if (words.length > maxWords) maxWords = words.length;
  };
  for (const raw of names) {
    const norm = normalizeForMatch(raw);
    if (norm.length < 2) continue;
    add(norm, raw);
    // Indexa também sem o artigo inicial: "The Beatles" também casa "beatles".
    for (const article of LEADING_ARTICLES) {
      if (norm.startsWith(article)) {
        add(norm.slice(article.length), raw);
        break;
      }
    }
  }
  return { byNorm, maxWords };
}

/**
 * Procura um nome conhecido dentro do título como sequência de palavras inteiras;
 * o maior nome encontrado vence. Retorna "" quando nada casa.
 */
export function matchKnownArtist(title: string, index: KnownArtistIndex): string {
  const words = normalizeForMatch(title).split(" ").filter(Boolean);
  const max = Math.min(index.maxWords, words.length);
  for (let size = max; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const hit = index.byNorm.get(words.slice(i, i + size).join(" "));
      if (hit) return hit;
    }
  }
  return "";
}

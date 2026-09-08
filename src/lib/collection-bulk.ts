import { normalizeForMatch } from "@/lib/vinyl-parse";

/**
 * Um disco interpretado a partir do texto de importação em massa da Coleção. Espelha os campos
 * editáveis de `collection_items` (camelCase). `wonDate` já em ISO (yyyy-mm-dd) ou null.
 * Client-safe: o preview da UI e o servidor de importação usam o MESMO parser.
 */
export type ParsedCollectionDraft = {
  artist: string;
  album: string;
  title: string;
  year: number | null;
  conditionMedia: string;
  conditionSleeve: string;
  wonPrice: string;
  wonDate: string | null;
  house: string;
  uf: string;
  notes: string;
  tags: string[];
};

/** Resultado do parser: os discos reconhecidos e uma mensagem de erro (quando nada casou). */
export type ParsedCollectionBulk = {
  items: ParsedCollectionDraft[];
  error: string | null;
};

const YEAR_RE = /\b(?:19|20)\d{2}\b/;

/** Escala de conservação aceita (mesma do formulário: NM/EX/VG+/VG-/G+/G-). */
const GRADES = ["NM", "EX", "VG+", "VG-", "G+", "G-"] as const;

/**
 * dd/mm/aaaa -> yyyy-mm-dd (coluna `date`), ou null quando não casa OU é inválida. Espelha
 * `brDateToIso` de `collection.server.ts` (validado lá com "00/00/0000" do site).
 */
function brDateToIso(value: string): string | null {
  const m = (value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!day || !month || !year || month > 12 || day > 31 || year < 1900) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) {
    return null;
  }
  return iso;
}

/** Aceita "aaaa-mm-dd" (input date) ou "dd/mm/aaaa" (BR) -> ISO, senão null. */
function toIsoDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return brDateToIso(v);
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Ano de um valor solto (número ou texto com 4 dígitos). */
function toYear(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v) || null;
  const m = asString(v).match(YEAR_RE);
  return m ? Number(m[0]) : null;
}

/** Normaliza um grau de conservação para a escala aceita ("vg+" -> "VG+"); vazio se não casar. */
function toGrade(v: unknown): string {
  const s = asString(v).toUpperCase().replace(/\s+/g, "");
  return (GRADES as readonly string[]).includes(s) ? s : "";
}

/** tags: aceita array ou string "a, b; c" -> lista limpa e sem vazios. */
function toTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(asString) : asString(v).split(/\s*[,;/]\s*/);
  return list.map((t) => t.trim()).filter(Boolean);
}

/** Chaves aceitas para cada campo (sem acento/caixa). O 1º alias existente vence. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const norm = new Map<string, unknown>();
  for (const [k, val] of Object.entries(obj)) {
    norm.set(
      k
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\(s\)/g, "")
        .replace(/[^a-z]/g, ""),
      val,
    );
  }
  for (const k of keys) {
    if (norm.has(k)) return norm.get(k);
  }
  return undefined;
}

const EMPTY_DRAFT: ParsedCollectionDraft = {
  artist: "",
  album: "",
  title: "",
  year: null,
  conditionMedia: "",
  conditionSleeve: "",
  wonPrice: "",
  wonDate: null,
  house: "",
  uf: "",
  notes: "",
  tags: [],
};

/** Objeto JSON (do Gemini) -> draft. Retorna null quando não sobra nem artista nem álbum. */
function draftFromObject(obj: Record<string, unknown>): ParsedCollectionDraft | null {
  const artist = asString(pick(obj, ["artista", "artist"]));
  const album = asString(pick(obj, ["album", "disco"]));
  if (!artist && !album) return null;
  const notes = asString(pick(obj, ["notas", "notes", "obs", "observacoes"]));
  return {
    ...EMPTY_DRAFT,
    artist,
    album,
    title: asString(pick(obj, ["titulo", "title"])),
    year: toYear(pick(obj, ["ano", "year"])),
    conditionMedia: toGrade(pick(obj, ["midia", "media", "vinil"])),
    conditionSleeve: toGrade(pick(obj, ["capa", "sleeve"])),
    wonPrice: asString(pick(obj, ["valor", "preco", "pago", "price"])),
    wonDate: toIsoDate(asString(pick(obj, ["data", "date"]))),
    house: asString(pick(obj, ["casa", "house", "leiloeiro"])),
    uf: asString(pick(obj, ["uf", "estado"])),
    notes,
    tags: toTags(pick(obj, ["tags", "estilo", "estilos", "generos", "genero"])),
  };
}

/**
 * Linha em texto livre `Artista - Álbum (Ano)` -> draft (fallback quando não é JSON). Extrai o
 * ano do último parêntese (como `wantlist-parse.ts`) e separa artista/álbum no 1º " - "/" / ".
 * Uma parte só vira o artista (a Coleção agrupa por artista). Retorna null para linha vazia.
 */
function draftFromLine(line: string): ParsedCollectionDraft | null {
  let body = line.trim();
  if (!body) return null;

  // Numeração inicial: "01." / "1)" / "1 -".
  body = body.replace(/^\s*\d+\s*[.)\-–]\s*/, "").trim();

  let year: number | null = null;
  const paren = body.match(/\(([^()]*)\)\s*$/);
  if (paren && paren.index !== undefined) {
    const ym = paren[1]!.match(YEAR_RE);
    if (ym) {
      year = Number(ym[0]);
      body = body.slice(0, paren.index).trim();
    }
  }

  const parts = body.split(/\s[-–—/]\s/);
  let artist = "";
  let album = "";
  if (parts.length >= 2 && parts[0]!.trim()) {
    artist = parts[0]!.trim();
    album = parts.slice(1).join(" - ").trim();
  } else {
    artist = body.replace(/[\s,;\-–—]+$/, "").trim();
  }
  if (!artist && !album) return null;
  return { ...EMPTY_DRAFT, artist, album, year };
}

/** Extrai o bloco JSON (array) tolerando cercas ```json e prosa ao redor (1º `[` … último `]`). */
function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/** Coleta objetos JSON de um array ou de linhas JSONL (um objeto por linha). */
function collectObjects(text: string): Record<string, unknown>[] | null {
  const block = extractJsonArray(text);
  if (block) {
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        return parsed.filter((o): o is Record<string, unknown> => !!o && typeof o === "object");
      }
    } catch {
      // cai para JSONL abaixo
    }
  }
  // JSONL: uma linha, um objeto.
  const objs: Record<string, unknown>[] = [];
  let any = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().replace(/,\s*$/, "");
    if (!t.startsWith("{") || !t.endsWith("}")) continue;
    any = true;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object") objs.push(o as Record<string, unknown>);
    } catch {
      // ignora a linha inválida
    }
  }
  return any ? objs : null;
}

/**
 * Interpreta o texto colado na importação em massa da Coleção. Formato principal: **JSON**
 * (array ou JSONL) gerado por IA — tolerante a cercas ```json e prosa. Fallback humano: uma
 * linha por disco no formato `Artista - Álbum (Ano)`. De-dup dentro do lote por
 * artista+álbum normalizado (quando há álbum). `error` explica quando nada é reconhecido.
 */
export function parseCollectionBulkText(text: string): ParsedCollectionBulk {
  if (!text || !text.trim()) return { items: [], error: null };

  let drafts: ParsedCollectionDraft[];
  const objects = collectObjects(text);
  if (objects) {
    drafts = objects.map(draftFromObject).filter((d): d is ParsedCollectionDraft => d !== null);
    if (!drafts.length) {
      return { items: [], error: "JSON reconhecido, mas nenhum disco com artista ou álbum." };
    }
  } else if (/[[{]/.test(text)) {
    // Parece JSON mas não parseou.
    return { items: [], error: "JSON inválido — confira o texto colado (aspas/vírgulas)." };
  } else {
    drafts = text
      .split(/\r?\n/)
      .map(draftFromLine)
      .filter((d): d is ParsedCollectionDraft => d !== null);
    if (!drafts.length) return { items: [], error: "Nenhum disco reconhecido no texto." };
  }

  // De-dup dentro do lote (artista+álbum normalizado; só quando há álbum).
  const out: ParsedCollectionDraft[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const key = d.album.trim() ? normalizeForMatch(`${d.artist} ${d.album}`) : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(d);
  }
  return { items: out, error: null };
}

/**
 * Prompt pronto para o usuário copiar e colar numa IA (ex.: Gemini) junto com a lista/fotos dos
 * discos. Instrui a devolver SOMENTE o JSON no formato que `parseCollectionBulkText` consome.
 * Fonte única — a UI lê esta constante.
 */
export const GEMINI_IMPORT_PROMPT = `Você vai me ajudar a cadastrar discos de vinil numa coleção.
A partir da lista (ou fotos) que eu enviar a seguir, devolva SOMENTE um array JSON válido — sem
comentários, sem texto antes ou depois, sem cercas de código. Um objeto por disco, com as chaves:

- "artista": nome do artista (string). Em coletâneas use "Vários Artistas".
- "album": nome do álbum (string).
- "ano": ano de lançamento (número de 4 dígitos) ou null se não souber.
- "midia": conservação do vinil, um de: "NM", "EX", "VG+", "VG-", "G+", "G-" (ou "" se não souber).
- "capa": conservação da capa, mesma escala de "midia" (ou "").
- "valor": valor pago como texto, ex.: "R$ 40,00" (ou "").
- "tags": array de estilos/gêneros musicais, ex.: ["MPB","Samba"] (ou []).
- "notas": observações livres (ou "").

Regras: não invente dados que não estão na lista; deixe "" ou null quando não souber; não repita o
mesmo disco. Exemplo do formato de saída:

[
  {"artista":"Tim Maia","album":"Racional","ano":1975,"midia":"VG+","capa":"VG","valor":"R$ 120,00","tags":["Soul","MPB"],"notas":"fase Cult"},
  {"artista":"Elis Regina","album":"Elis & Tom","ano":1974,"midia":"NM","capa":"EX","valor":"","tags":["MPB","Bossa Nova"],"notas":""}
]

Minha lista de discos é:`;

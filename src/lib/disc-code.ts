// Código de barras / código do disco (nº de catálogo) — funções puras, client-safe.
// Usado pela leitura por câmera na Coleção e pela busca no Discogs (`barcode=`/`catno=`).

export type DiscCode = {
  /** `barcode` = só dígitos (EAN/UPC); `catno` = nº de catálogo/matriz impresso no disco. */
  kind: "barcode" | "catno";
  /** Valor limpo para consultar o Discogs. */
  value: string;
};

/** Dados de um release do Discogs achado pelo código (barras/catálogo) — pré-preenche a Coleção. */
export type DiscogsCodeInfo = {
  releaseId: number;
  artist: string;
  album: string;
  year: number | null;
  cover: string | null;
  tracks: number;
};

/** Soma de verificação GS1 (EAN-8/UPC-A/EAN-13/GTIN-14). */
export function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const nums = digits.split("").map(Number);
  const check = nums.pop()!;
  let sum = 0;
  nums.reverse().forEach((n, i) => {
    sum += n * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Limpa o que o usuário digitou/a câmera leu e classifica: 8–14 dígitos (espaços/hífens
 * ignorados) = código de barras; qualquer outro texto alfanumérico = nº de catálogo.
 * `null` quando não sobra nada aproveitável.
 */
export function parseDiscCode(raw: string): DiscCode | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const digits = text.replace(/[\s-]/g, "");
  if (/^\d{8,14}$/.test(digits)) return { kind: "barcode", value: digits };
  const catno = text.replace(/[^A-Za-z0-9 ./-]/g, "").trim();
  if (catno.length < 3 || !/\d/.test(catno)) return null;
  return { kind: "catno", value: catno.slice(0, 40) };
}

/**
 * Procura candidatos num texto lido por OCR/IA: sequências de 8–14 dígitos (com GTIN válido
 * primeiro) e, se não houver, trechos que parecem nº de catálogo (letras+dígitos).
 */
export function extractDiscCodes(text: string): DiscCode[] {
  const out: DiscCode[] = [];
  const seen = new Set<string>();
  const push = (c: DiscCode | null) => {
    if (c && !seen.has(c.value)) {
      seen.add(c.value);
      out.push(c);
    }
  };
  const compact = (text ?? "").replace(/(?<=\d)[ -](?=\d)/g, "");
  const gtins = [...compact.matchAll(/\d{8,14}/g)].map((m) => m[0]);
  for (const g of gtins.filter(isValidGtin)) push({ kind: "barcode", value: g });
  for (const g of gtins.filter((g) => !isValidGtin(g))) push({ kind: "barcode", value: g });
  for (const line of (text ?? "").split(/[\n;,]/)) {
    const t = line.trim();
    if (/^[A-Za-z]{1,6}[ -]?\d{2,}[A-Za-z0-9 ./-]*$/.test(t)) push(parseDiscCode(t));
  }
  return out;
}

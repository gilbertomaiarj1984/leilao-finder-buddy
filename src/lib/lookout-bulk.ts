/**
 * "De olho" em lote: interpreta uma lista colada/enviada (uma obra por linha) em entradas para a
 * IA resolver artista/álbum/ano. Puro/client-safe. A numeração inicial ("01.", "1)", "1 -") é
 * OPCIONAL; o ano entre parênteses também. A ordem "Álbum (Ano) - Artista" ou "Artista - Álbum"
 * fica a cargo da IA — aqui só se limpa a linha e se guarda o ano como pista.
 */
type LookoutBulkEntry = {
  /** Linha original (para exibir o resultado). */
  raw: string;
  /** Texto limpo (sem numeração/marcadores) que vai para a IA. */
  text: string;
  /** Ano citado na linha, se houver. */
  year: number | null;
};

export const LOOKOUT_BULK_MAX = 200;

const YEAR_RE = /\((?:[^()]*?)\b((?:19|20)\d{2})\b[^()]*\)/;

export function parseLookoutBulk(text: string): LookoutBulkEntry[] {
  const out: LookoutBulkEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    // Marcador/numeração opcional: "01.", "1)", "1 -", "- ", "• ".
    const clean = raw
      .replace(/^[\s\\]*(?:\d+\s*[.)\-–]\s*|[-–•*]\s+)/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length < 2) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ym = clean.match(YEAR_RE);
    out.push({ raw, text: clean.slice(0, 200), year: ym ? Number(ym[1]) : null });
    if (out.length >= LOOKOUT_BULK_MAX) break;
  }
  return out;
}

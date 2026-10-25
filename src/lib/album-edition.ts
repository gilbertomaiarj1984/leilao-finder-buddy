/**
 * Edição de um disco (original × reedição) e identidade "mesmo disco?" — funções PURAS/client-safe.
 *
 * Duas marcas manuais (caixas de seleção, ver `docs/areas/colecao-sondagem-compras.md`):
 *  - `modern`: reedição MODERNA (relançamento recente). É OUTRO disco para o colecionador: não
 *    casa com o original, não conta como "já tenho" do original e não se funde com ele.
 *  - `period`: reedição de ÉPOCA que é o MESMO disco do original mesmo com ano diferente (só
 *    importa para homônimos, onde o ano separaria os discos).
 * Sem marca (`null`) = disco "normal": reedições de época se juntam ao original; para álbum
 * HOMÔNIMO o ano (ou o master do Discogs) decide.
 *
 * Para o LOTE existe ainda o valor `original` (só como sobrescrita manual): "este lote NÃO é
 * reedição", desfazendo a pré-marcação automática por palavras do título.
 */
import { isSelfTitledAlbum, normalizeForMatch, sameAlbumYear } from "./vinyl-parse";

export type Edition = "modern" | "period";
/** Edição de um LOTE: a marca do item + `original` (desfaz a detecção automática). */
export type LotEdition = Edition | "original";

export function isEdition(v: unknown): v is Edition {
  return v === "modern" || v === "period";
}

export function isLotEdition(v: unknown): v is LotEdition {
  return v === "modern" || v === "period" || v === "original";
}

// Sinais no TÍTULO de relançamento recente (já normalizado: sem acento, minúsculo). Só
// PRÉ-MARCAM — a decisão final é do usuário. "Reedição" sozinha entra (a maioria é moderna); a
// de época o usuário desfaz marcando o lote como "original"/"época".
const MODERN_HINTS = [
  /\bree?di[cç]?ao\b/,
  /\brelancamento\b/,
  /\breissue\b/,
  /\bremaster(?:ed|izad[oa]s?)?\b/,
  /\b(?:180|200)\s?(?:g|gr|gramas?)\b/,
  /\bheavy\s?weight\b/,
  /\bvinil\s+(?:colorido|transparente|translucido)\b/,
  /\bcolou?red\s+vinyl\b/,
  /\bpicture\s+disc\b/,
  /\bedicao\s+de\s+(?:20\d{2})\b/,
];

/** true quando o título sugere reedição MODERNA (180g, remasterizado, relançamento…). */
export function detectModernReissue(title: string): boolean {
  const t = normalizeForMatch(title ?? "");
  return MODERN_HINTS.some((re) => re.test(t));
}

/** Edição efetiva de um lote: sobrescrita manual > palavras do título > desconhecida (`null`). */
export function resolveLotEdition(title: string, override?: LotEdition | null): LotEdition | null {
  if (override) return override;
  return detectModernReissue(title) ? "modern" : null;
}

/** Referência a um disco para comparar identidade (nomes já considerados iguais). */
type AlbumRef = {
  artist: string;
  album: string;
  year: number | null | undefined;
  edition?: Edition | null;
  /** Master do Discogs (todas as reedições de um mesmo álbum compartilham o master). */
  masterId?: number | null;
};

/**
 * Dois registros de MESMO artista+álbum (nomes já comparados) são o mesmo disco?
 *  1. reedição moderna × não-moderna → NÃO (o colecionador quer separar);
 *  2. álbum homônimo com master conhecido nos dois lados → igual ⇔ mesmo master (mesmo master =
 *     reedição do mesmo álbum; master diferente = outro álbum com o mesmo nome);
 *  3. duas modernas, ou marca "época" em qualquer lado → SIM (mesmo disco/relançamento);
 *  4. senão a regra do ano (`sameAlbumYear`): só o homônimo de anos diferentes é outro disco.
 */
export function sameAlbum(a: AlbumRef, b: AlbumRef): boolean {
  if ((a.edition === "modern") !== (b.edition === "modern")) return false;
  if (isSelfTitledAlbum(a.artist, a.album) && a.masterId && b.masterId) {
    return a.masterId === b.masterId;
  }
  // Reedições modernas entre si (2014 × 2016) são o mesmo "relançamento", e a marca de época
  // junta o homônimo ao original: o ano só decide quando nenhuma das duas marcas existe.
  if (a.edition === "period" || b.edition === "period" || a.edition === "modern") return true;
  return sameAlbumYear(a.artist, a.album, a.year, b.year);
}

/**
 * Um lote (edição + master do Discogs) pode casar com o item de olho/da Coleção `item`?
 * Rejeita quando: o lote é reedição moderna e o item não é; o item é moderno e o lote é
 * explicitamente original/de época. Lote de edição desconhecida (`null`) não rejeita item
 * moderno (não dá para saber). Para homônimo, masters conhecidos e diferentes também rejeitam.
 */
export function lotEditionAllows(
  item: { artist: string; album: string; edition?: Edition | null; masterId?: number | null },
  lot: { edition: LotEdition | null; masterId?: number | null },
): boolean {
  const itemModern = item.edition === "modern";
  if (lot.edition === "modern" && !itemModern) return false;
  if (itemModern && (lot.edition === "original" || lot.edition === "period")) return false;
  if (
    item.masterId &&
    lot.masterId &&
    item.masterId !== lot.masterId &&
    isSelfTitledAlbum(item.artist, item.album)
  ) {
    return false;
  }
  return true;
}

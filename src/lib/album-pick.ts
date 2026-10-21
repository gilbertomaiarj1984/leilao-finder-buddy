/**
 * Qual álbum vale quando a avaliação (`lot_ai`) e a identificação (`lot_ident`) divergem. Os leitores
 * (telas, Discogs, "já tenho") preferem o da avaliação, que não traz confiança: um palpite dela
 * sobrepunha uma identificação segura e alimentava o Discogs, a tracklist e o perfil do colecionador
 * com o disco errado. Regra: identificação de confiança "alta" não é sobreposta por palpite.
 */
export function albumWithIdentPriority(
  evalAlbum: string | null,
  ident: { album: string | null; confidence: string | null } | null | undefined,
): string | null {
  if (ident?.album && ident.confidence === "alta") return ident.album;
  return evalAlbum;
}

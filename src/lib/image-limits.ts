/**
 * Teto de pixels de entrada do `sharp` (≈ 8000×6000). O padrão do sharp é 268 milhões, que
 * decodificados passam de 1 GB e derrubariam um container de 512 MB: uma imagem pequena em bytes mas
 * com dimensões enormes ("bomba de descompressão") é recusada antes de decodificar.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

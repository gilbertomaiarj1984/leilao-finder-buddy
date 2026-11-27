// Folha de capas: junta as miniaturas (já em disco) dos álbuns de UM artista numa única imagem,
// cada quadro com o número do item na lista enviada à IA. Os provedores de visão do app aceitam
// 1 imagem por pedido; a folha deixa a IA comparar várias capas de uma vez. Os números são
// desenhados com segmentos (sem fonte de sistema), então funcionam em qualquer imagem Docker.
import { collectionPathFromUrl, readCollectionFile } from "./collection-storage.server";

const TILE = 160;
const COLS = 8;
// Segmentos a b c d e f g do display de 7 segmentos, por dígito.
const SEGS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};
const RECT: Record<string, [number, number, number, number]> = {
  a: [1, 0, 8, 2],
  b: [8, 1, 2, 8],
  c: [8, 9, 2, 8],
  d: [1, 16, 8, 2],
  e: [0, 9, 2, 8],
  f: [0, 1, 2, 8],
  g: [1, 8, 8, 2],
};

function badgeSvg(n: number): Buffer {
  const digits = String(n).split("");
  const scale = 1.6;
  const cellW = 13;
  const w = Math.ceil((digits.length * cellW + 8) * scale);
  const h = Math.ceil(26 * scale);
  const rects = digits
    .flatMap((d, i) =>
      [...(SEGS[d] ?? "")].map((seg) => {
        const [x, y, rw, rh] = RECT[seg]!;
        return `<rect x="${4 + i * cellW + x}" y="${4 + y}" width="${rw}" height="${rh}" fill="#fff"/>`;
      }),
    )
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="4" fill="#000" fill-opacity="0.82"/><g transform="scale(${scale})">${rects}</g></svg>`,
  );
}

/**
 * `items[i].image` = URL pública da miniatura (ou null). O quadro `i` recebe o número `i + 1`.
 * Devolve `data:image/jpeg;base64,…` ou `null` se nenhuma capa pôde ser lida.
 */
export async function buildCoverSheet(items: { image?: string | null }[]): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const rows = Math.ceil(items.length / COLS);
    const tiles: { input: Buffer; left: number; top: number }[] = [];
    let found = 0;
    for (let i = 0; i < items.length; i += 1) {
      const left = (i % COLS) * TILE;
      const top = Math.floor(i / COLS) * TILE;
      const rel = items[i]?.image ? collectionPathFromUrl(items[i]!.image!) : null;
      const bytes = rel ? await readCollectionFile(rel) : null;
      if (bytes) {
        try {
          const thumb = await sharp(bytes)
            .resize(TILE - 4, TILE - 4, { fit: "cover" })
            .jpeg({ quality: 80 })
            .toBuffer();
          tiles.push({ input: thumb, left: left + 2, top: top + 2 });
          found += 1;
        } catch {
          /* miniatura inválida: fica o quadro cinza */
        }
      }
      tiles.push({ input: badgeSvg(i + 1), left: left + 4, top: top + 4 });
    }
    if (!found) return null;
    const out = await sharp({
      create: {
        width: COLS * TILE,
        height: rows * TILE,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .composite(tiles)
      .jpeg({ quality: 72 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch (error) {
    console.error("[album-cover-sheet] falha ao montar a folha de capas", error);
    return null;
  }
}

import { normalizeForMatch } from "@/lib/vinyl-parse";

/**
 * Lista copiável da Coleção (botão "Exportar" da tela Coleção). Módulo puro: recebe os discos
 * (só os campos usados) e devolve o texto, uma linha por disco, "Artista — Álbum (ano)".
 * Estado do disco/capa entra só quando preenchido, para não poluir.
 */
type CollectionExportItem = {
  artist: string;
  album: string;
  title: string;
  year: number | null;
  conditionMedia: string;
  conditionSleeve: string;
};

const NO_ARTIST = "(sem artista)";
const NO_ALBUM = "(sem nome do álbum)";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Uma linha: "Artista — Álbum (ano) | Disco VG+ · Capa VG". */
export function formatCollectionLine(item: CollectionExportItem): string {
  const artist = clean(item.artist) || NO_ARTIST;
  const album = clean(item.album) || clean(item.title) || NO_ALBUM;
  const year = item.year ? ` (${item.year})` : "";
  const media = clean(item.conditionMedia);
  const sleeve = clean(item.conditionSleeve);
  const condition = [media ? `Disco ${media}` : "", sleeve ? `Capa ${sleeve}` : ""]
    .filter(Boolean)
    .join(" · ");
  return [`${artist} — ${album}${year}`, condition].filter(Boolean).join(" | ");
}

/** Lista completa com cabeçalho, ordenada por artista e álbum (sem acento/caixa). */
export function formatCollectionList(items: readonly CollectionExportItem[]): string {
  const key = (it: CollectionExportItem) => ({
    artist: normalizeForMatch(it.artist) || "￿",
    album: normalizeForMatch(it.album || it.title),
  });
  const sorted = [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka.artist.localeCompare(kb.artist) || ka.album.localeCompare(kb.album);
  });
  return [`Coleção — ${items.length} disco(s)`, ...sorted.map(formatCollectionLine)].join("\n");
}

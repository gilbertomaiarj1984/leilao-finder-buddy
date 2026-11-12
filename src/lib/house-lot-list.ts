import { parseAiAlbum } from "@/lib/lot-score";

/**
 * Lista copiável de lotes de uma casa (botão ao lado de "pregão presencial"). Módulo puro:
 * recebe os dados já resolvidos de cada lote (IA, estado, preço) e devolve linhas de texto
 * para a área de transferência. Quem monta as entradas é `components/vinyl/house-lot-list.tsx`.
 */
export type HouseListEntry = {
  lote: string;
  artist: string;
  album: string;
  /** "Próximo lance" conhecido (peca.asp); vazio quando não se sabe. */
  nextBid: string;
  /** Valor atual / lance inicial do lote. */
  price: string;
  /** Nenhum lance dado ainda (então o preço mostrado é o do primeiro lance). */
  noBid: boolean;
  /** Ex.: "Disco VG+ · Capa VG · encarte"; vazio quando o estado é desconhecido. */
  condition: string;
  /** Trecho curto relevante (motivo da IA ou descrição do lote). */
  note: string;
};

const NOTE_MAX = 160;

/** Corta em `max` caracteres sem partir palavra, com reticências. */
export function shortNote(text: string | null | undefined, max = NOTE_MAX): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** Artista + álbum do lote: prefere o álbum resolvido pela IA; senão artista efetivo + título. */
export function splitArtistAlbum(
  aiAlbum: string | null | undefined,
  fallbackArtist: string,
  title: string,
): { artist: string; album: string } {
  const parsed = parseAiAlbum(aiAlbum);
  if (parsed.artist || parsed.album) {
    const album = [parsed.album, parsed.year ? `(${parsed.year})` : ""].filter(Boolean).join(" ");
    return { artist: parsed.artist ?? fallbackArtist, album };
  }
  return { artist: fallbackArtist, album: title.replace(/\s+/g, " ").trim() };
}

/** Texto do preço: "sem lance" avisa que o valor é o do 1º lance. */
export function priceLabel(entry: Pick<HouseListEntry, "nextBid" | "price" | "noBid">): string {
  if (entry.noBid) {
    const first = entry.nextBid || entry.price;
    return first ? `1º lance ${first} (SEM LANCE)` : "SEM LANCE";
  }
  if (entry.nextBid) return `próximo lance ${entry.nextBid}`;
  return entry.price ? `atual ${entry.price}` : "valor não informado";
}

/** Uma linha da lista. */
export function formatListEntry(entry: HouseListEntry): string {
  const who = [entry.artist, entry.album].filter(Boolean).join(" — ") || "(sem identificação)";
  const parts = [
    entry.lote ? `Lote ${entry.lote}` : "",
    who,
    priceLabel(entry),
    entry.condition ? `Estado: ${entry.condition}` : "Estado: não informado",
    entry.note ? entry.note : "",
  ];
  return parts.filter(Boolean).join(" | ");
}

/** Lista completa, com cabeçalho (casa + quantidade) e uma linha por lote. */
export function formatHouseList(house: string, entries: readonly HouseListEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => (Number.parseInt(a.lote, 10) || 1e9) - (Number.parseInt(b.lote, 10) || 1e9),
  );
  return [`${house} — ${entries.length} lote(s)`, ...sorted.map(formatListEntry)].join("\n");
}

/** Export geral do dia: uma seção por casa (cada uma no formato da lista por casa), separadas por linha em branco. */
export function formatDayList(
  title: string,
  sections: readonly { house: string; entries: readonly HouseListEntry[] }[],
): string {
  const used = sections.filter((s) => s.entries.length > 0);
  const total = used.reduce((n, s) => n + s.entries.length, 0);
  return [
    `${title} — ${total} lote(s) em ${used.length} casa(s)`,
    ...used.map((s) => `\n${formatHouseList(s.house, s.entries)}`),
  ].join("\n");
}

// Rascunho editável de um disco da Coleção (formulário de adicionar/editar).

import type { Edition } from "@/lib/album-edition";
import type { CollectionItem } from "@/lib/collection.server";

// --- Formulário de edição/adição ---
export type Draft = {
  id: string | null;
  artist: string;
  album: string;
  title: string;
  barcode: string;
  year: string;
  image: string | null;
  wonPrice: string;
  wonDate: string;
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  description: string;
  tags: string;
  edition: Edition | null;
};

export const EMPTY_DRAFT: Draft = {
  id: null,
  artist: "",
  album: "",
  title: "",
  barcode: "",
  year: "",
  image: null,
  wonPrice: "",
  wonDate: "",
  conditionMedia: "",
  conditionSleeve: "",
  notes: "",
  description: "",
  tags: "",
  edition: null,
};

export function toDraft(item: CollectionItem): Draft {
  return {
    id: item.id,
    artist: item.artist,
    album: item.album,
    title: item.title,
    barcode: item.barcode,
    year: item.year == null ? "" : String(item.year),
    image: item.image,
    wonPrice: item.wonPrice,
    wonDate: item.wonDate ?? "",
    conditionMedia: item.conditionMedia,
    conditionSleeve: item.conditionSleeve,
    notes: item.notes,
    description: item.description,
    tags: item.tags.join(", "),
    edition: item.edition,
  };
}

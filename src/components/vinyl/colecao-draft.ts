// Rascunho editável de um disco da Coleção (formulário de adicionar/editar).

import type { CollectionItem } from "@/lib/collection.server";

// --- Formulário de edição/adição ---
export type Draft = {
  id: string | null;
  artist: string;
  album: string;
  title: string;
  year: string;
  image: string | null;
  wonPrice: string;
  wonDate: string;
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  description: string;
  tags: string;
};

export const EMPTY_DRAFT: Draft = {
  id: null,
  artist: "",
  album: "",
  title: "",
  year: "",
  image: null,
  wonPrice: "",
  wonDate: "",
  conditionMedia: "",
  conditionSleeve: "",
  notes: "",
  description: "",
  tags: "",
};

export function toDraft(item: CollectionItem): Draft {
  return {
    id: item.id,
    artist: item.artist,
    album: item.album,
    title: item.title,
    year: item.year == null ? "" : String(item.year),
    image: item.image,
    wonPrice: item.wonPrice,
    wonDate: item.wonDate ?? "",
    conditionMedia: item.conditionMedia,
    conditionSleeve: item.conditionSleeve,
    notes: item.notes,
    description: item.description,
    tags: item.tags.join(", "),
  };
}

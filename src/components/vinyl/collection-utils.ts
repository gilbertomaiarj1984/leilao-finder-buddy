// Helpers puros/client-safe da Coleção. Ficam num `.ts` separado (sem JSX) por causa
// do react-refresh: o componente do card não pode exportar funções junto.
import { formatAiAlbum } from "@/components/vinyl/ai-score-utils";
import type { CollectionItem } from "@/lib/collection.server";

/** Rótulo "Artista — Álbum (Ano)" do disco, reaproveitando o formatador da IA. */
export function collectionLabel(item: CollectionItem): string {
  const base = [item.artist, item.album].filter(Boolean).join(" - ");
  return formatAiAlbum(base, item.year) || item.title || "(sem identificação)";
}

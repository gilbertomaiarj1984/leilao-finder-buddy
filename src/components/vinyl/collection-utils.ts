// Helpers puros/client-safe da Coleção. Ficam num `.ts` separado (sem JSX) por causa
// do react-refresh: o componente do card não pode exportar funções junto.
import { formatAiAlbum } from "@/components/vinyl/ai-score-utils";
import type { CollectionItem } from "@/lib/collection.server";

/** Rótulo "Artista — Álbum (Ano)" do disco, reaproveitando o formatador da IA. */
export function collectionLabel(item: CollectionItem): string {
  const base = [item.artist, item.album].filter(Boolean).join(" - ");
  return formatAiAlbum(base, item.year) || item.title || "(sem identificação)";
}

/** Lê um arquivo como data URL (base64) — formato esperado por `uploadCollectionImage`. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

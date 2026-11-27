// IA que propõe quais álbuns de UM artista são o mesmo disco (Analytics). Só PROPÕE — nada é
// gravado aqui; a tela mostra a proposta e o usuário aceita grupo a grupo. Regras de segurança
// e validação em `album-grouping.ts` (puro). Ver docs/areas/vendas-e-analytics.md.
import {
  ALBUM_GROUPING_SYSTEM,
  buildAlbumGroupingText,
  MAX_GROUPING_ALBUMS,
  validateAlbumGroups,
  type AlbumGroup,
  type GroupingAlbum,
} from "./album-grouping";
import { aiConfigured, resolveAiProvider, resolveGeminiModel } from "./ai-eval.server";
import { runText } from "./ai-provider.server";
import { extractJsonObject } from "./json-extract";

type AlbumGroupingResult = {
  groups: AlbumGroup[];
  provider: string;
  model: string;
  /** Álbuns que não couberam no pedido (artista com mais de `MAX_GROUPING_ALBUMS`). */
  skipped: number;
  /** A IA recebeu a folha de capas junto com os títulos. */
  usedCovers: boolean;
};

export async function proposeAlbumGroups(
  artist: string,
  albumsIn: GroupingAlbum[],
  opts: { useCovers?: boolean } = {},
): Promise<AlbumGroupingResult> {
  if (!aiConfigured()) throw new Error("Nenhuma IA configurada (chave de API ausente).");
  // Os de mais vendas primeiro: se passar do teto, os que ficam de fora são os mais raros.
  const sorted = [...albumsIn].sort((a, b) => b.count - a.count);
  const albums = sorted.slice(0, MAX_GROUPING_ALBUMS);
  if (albums.length < 2) {
    return { groups: [], provider: "", model: "", skipped: 0, usedCovers: false };
  }
  // Folha de capas (opcional): só os quadros que têm miniatura; sem nenhuma, vai só o texto.
  let sheet: string | null = null;
  if (opts.useCovers !== false && albums.some((a) => a.image)) {
    const { buildCoverSheet } = await import("./album-cover-sheet.server");
    sheet = await buildCoverSheet(albums);
  }
  const provider = await resolveAiProvider();
  const geminiModel = await resolveGeminiModel();
  const r = await runText(
    {
      system: ALBUM_GROUPING_SYSTEM,
      maxTokens: 4096,
      text: buildAlbumGroupingText(artist, albums),
      image: sheet,
      json: true,
    },
    provider,
    geminiModel,
  );
  const groups = validateAlbumGroups(extractJsonObject(r.text), albums);
  return {
    groups,
    provider: r.provider,
    model: r.model,
    skipped: sorted.length - albums.length,
    usedCovers: !!sheet,
  };
}

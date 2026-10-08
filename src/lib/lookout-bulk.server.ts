import { titleCase } from "@/lib/vinyl-parse";

import { aiConfigured, resolveAiProvider, resolveGeminiModel } from "./ai-eval.server";
import { runText } from "./ai-provider.server";
import { addLookoutManual, updateLookoutItem, type LookoutRow } from "./lookout.server";

/**
 * "De olho" por texto (lista colada/digitada): a IA (SÓ TEXTO) resolve UMA linha em
 * artista/álbum/ano canônicos e o item é criado sem lote de origem. Chamado linha a linha pela
 * interface (progresso e falha isolada por linha). Gasta créditos de IA, só sob demanda.
 */
const SYSTEM =
  "Você identifica discos de vinil a partir de uma linha de texto livre digitada por um " +
  'colecionador brasileiro. A linha pode vir em qualquer ordem ("Álbum (Ano) - Artista", ' +
  '"Artista - Álbum", "Artista / Álbum") ou ter só o nome do álbum. Use seu conhecimento de ' +
  "música e discografia. Use SEMPRE o nome ARTÍSTICO padrão e canônico do artista (grafia " +
  "oficial, com acentuação correta) e o título oficial do álbum. Se for só um artista, sem " +
  "álbum identificável, devolva album vazio. Responda SOMENTE com um objeto JSON.";

type LookoutTextResult =
  | { status: "added" | "existing"; item: LookoutRow; switched: boolean }
  | { status: "unresolved"; reason: string };

export async function addLookoutFromText(
  text: string,
  yearHint: number | null,
): Promise<LookoutTextResult> {
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const provider = await resolveAiProvider();
  const geminiModel = await resolveGeminiModel();
  const r = await runText(
    {
      system: SYSTEM,
      maxTokens: 150,
      image: null,
      json: true,
      text:
        `Linha: ${JSON.stringify(text)}\n` +
        (yearHint ? `Ano citado: ${yearHint}\n` : "") +
        'Devolva {"artist": "...", "album": "...", "year": 1999 ou null}.',
    },
    provider,
    geminiModel,
  );
  const start = r.text.indexOf("{");
  const end = r.text.lastIndexOf("}");
  let obj: Record<string, unknown> | null = null;
  if (start >= 0 && end > start) {
    try {
      obj = JSON.parse(r.text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      obj = null;
    }
  }
  const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  const artist = s(obj?.["artist"]);
  const album = s(obj?.["album"]);
  if (!artist || !album) {
    return { status: "unresolved", reason: "a IA não identificou artista e álbum" };
  }
  const y = Number(obj?.["year"]);
  const year = Number.isFinite(y) && y >= 1900 && y <= 2100 ? Math.round(y) : yearHint;
  const { item: base, created } = await addLookoutManual({
    artist: titleCase(artist),
    album,
    year,
  });
  const item = base.image ? base : await attachDiscogsCover(base);
  return { status: created ? "added" : "existing", item, switched: r.switched };
}

/**
 * Capa do Discogs (artista/álbum) no mesmo formato da Coleção: baixa, comprime e grava na pasta
 * da coleção (`importCollectionCover`). Best-effort — sem token/capa/erro, o item fica sem imagem.
 */
async function attachDiscogsCover(item: LookoutRow): Promise<LookoutRow> {
  try {
    const { discogsConfigured, searchCoverOptions } = await import("./discogs.server");
    if (!discogsConfigured()) return item;
    const options = await searchCoverOptions(item.artist, item.album);
    const pick = (item.year && options.find((o) => o.year === item.year)) || options[0];
    if (!pick) return item;
    const { importCollectionCover } = await import("./collection.server");
    const { url } = await importCollectionCover(pick.cover);
    return await updateLookoutItem({ id: item.id, image: url });
  } catch (error) {
    console.error("[lookout] não foi possível buscar a capa no Discogs", error);
    return item;
  }
}

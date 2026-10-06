import { parseAiAlbum } from "@/components/vinyl/ai-score-utils";
import { titleCase } from "@/lib/vinyl-parse";

import { aiConfigured, identLotsSyncRows, resolveAiProvider } from "./ai-eval.server";
import { getAllLookout, updateLookoutItem, type LookoutRow } from "./lookout.server";

/**
 * "De olho" — identificação por IA de UM item (v0.110.0), por TEXTO + IMAGEM: o mesmo prompt e
 * parser da identificação dos lotes (`identLotsSyncRows` com capa), aplicado ao snapshot do item
 * (título do lote de origem + foto). Preenche artista/álbum/ano para o casamento funcionar quando
 * o lote marcado não tinha identificação. Gasta créditos de IA, só sob demanda (botão no card).
 * Módulo isolado: nada além do botão/função `identifyLookout` depende dele.
 */
export async function identifyLookoutItem(id: string): Promise<{
  identified: boolean;
  item: LookoutRow | null;
  confidence: string | null;
  usedImage: boolean;
  switched: boolean;
  error: string | null;
  attemptErrors: Partial<Record<"anthropic" | "gemini", string>>;
}> {
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  const item = (await getAllLookout()).find((i) => i.id === id);
  if (!item) throw new Error("Item não encontrado.");
  const provider = await resolveAiProvider();
  const lot = {
    id: item.lotId,
    title: item.title,
    price: "",
    house: item.house,
    image: item.image,
  };
  // Só vale como "com imagem" uma URL http(s) (senão a IA recebe só o texto).
  let usedImage = /^https?:\/\//i.test(item.image ?? "");
  let out = await identLotsSyncRows([lot], true, provider);
  // Algumas casas bloqueiam o acesso à foto: se a chamada com imagem falhou, tenta só pelo texto.
  if (!out.rows.length && usedImage && out.failed > 0) {
    out = await identLotsSyncRows([lot], false, provider);
    usedImage = false;
  }
  const base = {
    usedImage,
    switched: out.switched,
    error: out.error,
    attemptErrors: out.attemptErrors,
  };
  const row = out.rows[0];
  const parsed = parseAiAlbum(row?.album ?? null);
  if (!row || !parsed.album) {
    return { identified: false, item, confidence: row?.confidence ?? null, ...base };
  }
  // Só preenche/melhora: nunca apaga com resultado vazio.
  const updated = await updateLookoutItem({
    id,
    artist: parsed.artist ? titleCase(parsed.artist) : item.artist,
    album: parsed.album,
    year: row.year ?? parsed.year ?? item.year,
  });
  return { identified: true, item: updated, confidence: row.confidence, ...base };
}

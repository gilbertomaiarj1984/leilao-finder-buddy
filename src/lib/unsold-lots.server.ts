/**
 * Lotes SEM lance (não vendidos) de um leilão já terminado — mostrados na linha da casa
 * (`day-tab.tsx`) no lugar do link do pregão presencial, que perde sentido quando os lotes
 * acabam. Busca o catálogo da casa sob demanda (`fetchCatalogData`, mesma fonte usada por
 * `captureFinishedSales`) e devolve o INVERSO do filtro de vendas: lotes sem `sold`. Sem
 * persistência — cache em memória com TTL curto só para não bater o catálogo repetidamente
 * se o usuário abrir/fechar a lista.
 */
import { db } from "@/lib/db-client.server";

import { parseConditionFromText } from "./grading";
import { isPublicHost } from "./leiloesbr-live.server";
import { extractArtist, looksNonVinylSale } from "./vinyl-parse";

type UnsoldLot = {
  idPeca: string;
  lote: string | null;
  title: string;
  artist: string;
  image: string | null;
  url: string;
};

type UnsoldLotsResult = {
  lots: UnsoldLot[];
  total: number; // nº total de lotes do catálogo (vendidos + sem lance) — pro "N de M" na UI
};

// ≤ metade do intervalo de refetch do cliente, mesmo espírito de leiloesbr-presencial.server.ts.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: UnsoldLotsResult }>();

/** Valida e devolve o domínio (origin) da casa a partir da URL do pregão presencial. */
function domainFromPresencialUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Só pregões https são suportados.");
  if (!isPublicHost(url.hostname)) throw new Error("Host do pregão não permitido.");
  if (!/^\/presencial\/presencial\.asp$/i.test(url.pathname)) {
    throw new Error("URL do pregão presencial inválida.");
  }
  return url.origin;
}

export async function getUnsoldLotsForAuction(
  idLeilao: string,
  presencialUrl: string,
): Promise<UnsoldLotsResult> {
  const domain = domainFromPresencialUrl(presencialUrl);
  const key = `${domain}#${idLeilao}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: UnsoldLotsResult = { lots: [], total: 0 };
  try {
    const { looksVinyl, bestCatalogTitle } = await import("./lot-sales.server");
    const { fetchCatalogData } = await import("./leiloesbr-catalog.server");

    const [catalog, knownRows] = await Promise.all([
      fetchCatalogData(domain, idLeilao),
      db
        .from("lots")
        .select("id_peca, title, artist, image")
        .eq("id_leilao", idLeilao)
        .then((r) =>
          r.error
            ? []
            : (r.data as {
                id_peca: string;
                title: string;
                artist: string;
                image: string | null;
              }[]),
        ),
    ]);
    const knownByPeca = new Map(knownRows.map((r) => [r.id_peca, r]));

    const rows: UnsoldLot[] = [];
    for (const [idPeca, data] of catalog) {
      if (data.sold) continue; // já vendido: fora da lista de sem-lance
      if (looksNonVinylSale(`${data.peca ?? ""} ${data.text}`)) continue;
      const known = knownByPeca.get(idPeca);
      const cond = parseConditionFromText(data.text);
      if (!known && !looksVinyl(data.text, cond)) continue;

      const title = known?.title || bestCatalogTitle(data);
      rows.push({
        idPeca,
        lote: data.lote,
        title,
        artist: known?.artist || extractArtist(title),
        image: known?.image ?? null,
        url: `${domain}/peca.asp?ID=${idPeca}`,
      });
    }
    value = { lots: rows, total: catalog.size };
  } catch (error) {
    console.error("[unsold-lots] falha ao buscar lotes sem lance", key, error);
  }

  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

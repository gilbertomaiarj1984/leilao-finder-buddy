/**
 * Lotes SEM lance (não vendidos) de um leilão já terminado — mostrados na linha da casa
 * (`day-tab.tsx`) no lugar do link do pregão presencial, que perde sentido quando os lotes
 * acabam. Busca o catálogo da casa sob demanda (`fetchCatalogData`, mesma fonte usada por
 * `captureFinishedSales`) e devolve o INVERSO do filtro de vendas: lotes sem `sold`. Sem
 * persistência — cache em memória com TTL curto só para não bater o catálogo repetidamente
 * se o usuário abrir/fechar a lista.
 *
 * ⚠️ **Filtro por dia**: o catálogo (`catalogo.asp?Num=<idLeilao>`) traz TODOS os lotes do
 * "leilão" — em casas cujo leilão se estende por mais de um dia (mesmo `idLeilao`, dias
 * diferentes), isso inclui lotes de OUTROS dias, não só o da linha que o usuário está vendo
 * (achado do usuário: lotes do dia seguinte apareciam junto). O catálogo não traz a data do
 * lote, então o único jeito confiável de restringir ao dia certo é cruzar com a tabela `lots`
 * (que grava `day_key` por lote): só entram lotes com correspondência CONHECIDA para o
 * `dayKey` pedido — lotes nunca varridos (fora da janela de scraping) ficam de fora, tanto do
 * total quanto da lista, por não haver como confirmar o dia deles.
 */
import { db } from "@/lib/db-client.server";

import { isPublicHost } from "./leiloesbr-live.server";

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
  // nº de lotes do catálogo CONHECIDOS pro dia pedido (vendidos + sem lance) — pro "N de M" na
  // UI. Não é o total do catálogo inteiro (que pode cobrir outros dias do mesmo leilão).
  total: number;
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
  dayKey: string,
): Promise<UnsoldLotsResult> {
  const domain = domainFromPresencialUrl(presencialUrl);
  const key = `${domain}#${idLeilao}#${dayKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: UnsoldLotsResult = { lots: [], total: 0 };
  try {
    const { fetchCatalogData } = await import("./leiloesbr-catalog.server");

    const [catalog, knownRows] = await Promise.all([
      fetchCatalogData(domain, idLeilao),
      db
        .from("lots")
        .select("id_peca, title, artist, image")
        .eq("id_leilao", idLeilao)
        .eq("day_key", dayKey)
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
    let total = 0;
    for (const [idPeca, data] of catalog) {
      const known = knownByPeca.get(idPeca);
      if (!known) continue; // sem correspondência conhecida PRO DIA pedido — não dá pra confirmar
      total += 1;
      if (data.sold) continue; // já vendido: fora da lista de sem-lance

      rows.push({
        idPeca,
        lote: data.lote,
        title: known.title,
        artist: known.artist,
        image: known.image,
        url: `${domain}/peca.asp?ID=${idPeca}`,
      });
    }
    value = { lots: rows, total };
  } catch (error) {
    console.error("[unsold-lots] falha ao buscar lotes sem lance", key, error);
  }

  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

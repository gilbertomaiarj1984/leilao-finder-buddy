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

import { fetchLotDetails } from "./leiloesbr-lot-details.server";
import { isPublicHost } from "./public-host";
import { isLotePassed } from "./vinyl-parse";

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
// Pregão em andamento muda a cada lote: cache curto (e por lote atual).
const LIVE_CACHE_TTL_MS = 45 * 1000;
const cache = new Map<string, { at: number; value: UnsoldLotsResult }>();

// Conferência na peça (só pregão ao vivo, ver `dropSoldOnPage`): teto de lotes por rodada, e
// memória do resultado — "vendido" nunca volta atrás; "ainda sem venda" vale por pouco tempo.
const VERIFY_MAX = 60;
const VERIFY_UNSOLD_TTL_MS = 2 * 60 * 1000;
const verified = new Map<string, { at: number; sold: boolean }>();

/**
 * Pregão ao vivo: o catálogo pode demorar a marcar um lote recém-vendido (ou nem trazer o valor
 * de venda), então os candidatos a "sem lance" são conferidos na página do PRÓPRIO lote
 * (`peca.asp`, a fonte de verdade — mesmo `MOSTRABTN_CLASS`/`VALOR_VENDA` do catálogo, mas
 * atualizado na hora). Devolve só os que a página NÃO mostra como vendidos. Best-effort: lote
 * que a peça não responde fica na lista (como era antes); acima de `VERIFY_MAX` confere só os
 * primeiros — os demais passam sem conferência.
 */
async function dropSoldOnPage(domain: string, rows: UnsoldLot[]): Promise<UnsoldLot[]> {
  const now = Date.now();
  const key = (r: UnsoldLot) => `${domain}#${r.idPeca}`;
  const pending = rows
    .filter((r) => {
      const v = verified.get(key(r));
      return !v || (!v.sold && now - v.at >= VERIFY_UNSOLD_TTL_MS);
    })
    .slice(0, VERIFY_MAX);
  if (pending.length) {
    const details = await fetchLotDetails(
      pending.map((r) => ({ id: r.idPeca, idPeca: r.idPeca, url: r.url })),
    );
    for (const r of pending)
      verified.set(key(r), { at: now, sold: Boolean(details[r.idPeca]?.sold) });
    if (verified.size > 2000) verified.clear();
  }
  return rows.filter((r) => !verified.get(key(r))?.sold);
}

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
  currentLote: string | null = null,
): Promise<UnsoldLotsResult> {
  const domain = domainFromPresencialUrl(presencialUrl);
  const key = `${domain}#${idLeilao}#${dayKey}#${currentLote ?? ""}`;
  const hit = cache.get(key);
  const ttl = currentLote ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  let value: UnsoldLotsResult = { lots: [], total: 0 };
  try {
    const { fetchCatalogData, isUnsoldCatalogLot } = await import("./leiloesbr-catalog.server");

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
      if (!isUnsoldCatalogLot(data)) continue; // vendido (ou com lances): fora da lista de sem-lance
      if (currentLote && !isLotePassed(data.lote, currentLote)) continue; // ainda por vir

      rows.push({
        idPeca,
        lote: data.lote,
        title: known.title,
        artist: known.artist,
        image: known.image,
        url: `${domain}/peca.asp?ID=${idPeca}`,
      });
    }
    value = { lots: currentLote ? await dropSoldOnPage(domain, rows) : rows, total };
  } catch (error) {
    console.error("[unsold-lots] falha ao buscar lotes sem lance", key, error);
  }

  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

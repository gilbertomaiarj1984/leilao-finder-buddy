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
  /** Valor do lote na listagem (sem lance = lance inicial); "" quando desconhecido. */
  price: string;
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

// Conferência na peça: teto de lotes por rodada, e memória do resultado — "vendido"/"com lance"
// nunca volta atrás; "ainda sem venda" vale por pouco tempo.
const VERIFY_MAX_LIVE = 60;
const VERIFY_MAX_CATALOG = 300;
const VERIFY_CHUNK = 100; // teto de `fetchLotDetails` por chamada
const VERIFY_UNSOLD_TTL_MS = 2 * 60 * 1000;
const verified = new Map<string, { at: number; drop: boolean }>();

/**
 * Confere os candidatos a "sem lance" na página do PRÓPRIO lote (`peca.asp`, a fonte de verdade
 * — atualizada na hora) e descarta os que ela mostra como vendidos OU com lances. Serve a dois
 * casos: (1) pregão ao vivo, em que o catálogo demora a marcar a venda; (2) casas cujo catálogo
 * não traz `QTDLANCE` (RT Leilões e Artes) — sem isso um lote com 10 lances caía em "sem lance".
 * Best-effort: lote que a peça não responde fica na lista; acima de `max` confere só os primeiros.
 */
async function dropSoldOrBidOnPage(
  domain: string,
  rows: UnsoldLot[],
  max: number,
): Promise<UnsoldLot[]> {
  const now = Date.now();
  const key = (r: UnsoldLot) => `${domain}#${r.idPeca}`;
  const pending = rows
    .filter((r) => {
      const v = verified.get(key(r));
      return !v || (!v.drop && now - v.at >= VERIFY_UNSOLD_TTL_MS);
    })
    .slice(0, max);
  for (let i = 0; i < pending.length; i += VERIFY_CHUNK) {
    const chunk = pending.slice(i, i + VERIFY_CHUNK);
    const details = await fetchLotDetails(
      chunk.map((r) => ({ id: r.idPeca, idPeca: r.idPeca, url: r.url })),
    );
    for (const r of chunk) {
      const d = details[r.idPeca];
      verified.set(key(r), { at: now, drop: Boolean(d?.sold) || (d?.bids ?? 0) > 0 });
    }
  }
  if (verified.size > 2000) verified.clear();
  return rows.filter((r) => !verified.get(key(r))?.drop);
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
        .select("id_peca, title, artist, image, price")
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
                price: string;
              }[]),
        ),
    ]);
    const knownByPeca = new Map(knownRows.map((r) => [r.id_peca, r]));

    const rows: UnsoldLot[] = [];
    const noBidInfo = new Set<string>(); // catálogo sem QTDLANCE: não dá pra confiar em "sem lance"
    let total = 0;
    for (const [idPeca, data] of catalog) {
      const known = knownByPeca.get(idPeca);
      if (!known) continue; // sem correspondência conhecida PRO DIA pedido — não dá pra confirmar
      total += 1;
      if (!isUnsoldCatalogLot(data)) continue; // vendido (ou com lances): fora da lista de sem-lance
      if (currentLote && !isLotePassed(data.lote, currentLote)) continue; // ainda por vir

      if (data.bids == null) noBidInfo.add(idPeca);
      rows.push({
        idPeca,
        lote: data.lote,
        title: known.title,
        artist: known.artist,
        image: known.image,
        price: known.price ?? "",
        url: `${domain}/peca.asp?ID=${idPeca}`,
      });
    }
    // Ao vivo: confere todos na peça. Fora do ao vivo: só os de catálogo sem contagem de lances.
    const checked = currentLote
      ? await dropSoldOrBidOnPage(domain, rows, VERIFY_MAX_LIVE)
      : await dropSoldOrBidOnPage(
          domain,
          rows.filter((r) => noBidInfo.has(r.idPeca)),
          VERIFY_MAX_CATALOG,
        );
    const keep = new Set(checked.map((r) => r.idPeca));
    value = {
      lots: currentLote
        ? checked
        : rows.filter((r) => !noBidInfo.has(r.idPeca) || keep.has(r.idPeca)),
      total,
    };
  } catch (error) {
    console.error("[unsold-lots] falha ao buscar lotes sem lance", key, error);
  }

  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

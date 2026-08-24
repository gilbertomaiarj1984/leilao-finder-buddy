import { publicFetch } from "./leiloesbr-auth.server";

/**
 * O nº do lote não existe na listagem geral do leiloesbr — só no catálogo do
 * leilão, que fica no site da CASA. O link de cada lote embute tudo que precisamos:
 *   abre_catalogo.asp?t=1|<dominio-da-casa>|<idLeilao>|<idPeca>
 * A partir daí buscamos `catalogo.asp?Num=<idLeilao>` no domínio da casa e cruzamos
 * `idPeca -> nº do lote`. É 1 requisição por LEILÃO (não por lote).
 */
export function parseAuctionRef(url: string): { domain: string; idLeilao: string } | null {
  const m = url.match(/abre_catalogo\.asp\?t=\d+\|([^|]+)\|(\d+)\|(\d+)/i);
  if (!m) return null;
  let domain = (m[1] ?? "").trim();
  if (!domain) return null;
  if (!/^https?:/i.test(domain)) domain = `http://${domain}`;
  return { domain: domain.replace(/\/+$/, ""), idLeilao: m[2]! };
}

/**
 * Extrai idPeca -> nº do lote do HTML do catálogo da casa SEM depender da classe
 * do container (que varia: destaques usam `.prod-box`, o catálogo completo usa
 * outra estrutura). Casa por POSIÇÃO: cada card tem `peca.asp?ID=<idPeca>` seguido
 * de um bloco `LoteProd ... Lote: <n>`. Para cada ocorrência de peca.asp, procuramos
 * o "Lote:" no trecho até a PRÓXIMA peca.asp — que é o card daquele idPeca.
 */
function parseCatalogLotes(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const matches = [...html.matchAll(/peca\.asp\?ID=\s*(\d+)/gi)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i]![1]!;
    if (map.has(id)) continue;
    const start = (matches[i]!.index ?? 0) + matches[i]![0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? html.length) : html.length;
    const seg = html.slice(start, end);
    const lote =
      seg.match(/LoteProd[\s\S]{0,250}?lote\s*:?\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
      seg.match(/title="Lote-?\s*([0-9]+[a-zA-Z]?)"/i)?.[1];
    if (lote) map.set(id, lote);
  }
  return map;
}

/** Busca o catálogo do leilão (paginando best-effort) e devolve idPeca -> nº do lote. */
export async function fetchLoteMap(domain: string, idLeilao: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const pageUrl =
      page === 1
        ? `${domain}/catalogo.asp?Num=${idLeilao}`
        : `${domain}/catalogo.asp?Num=${idLeilao}&pag=${page}`;
    let html: string;
    try {
      html = await publicFetch(pageUrl, {});
    } catch {
      break;
    }
    let added = 0;
    for (const [id, lote] of parseCatalogLotes(html)) {
      if (!map.has(id)) {
        map.set(id, lote);
        added++;
      }
    }
    // Sem novos itens (catálogo de página única ou fim da paginação) -> encerra.
    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }
  return map;
}

import { publicFetch } from "./leiloesbr-auth.server";

/**
 * O nº do lote não existe na listagem geral do leiloesbr — só no catálogo do
 * leilão, que fica no site da CASA. O link de cada lote embute tudo que precisamos:
 *   abre_catalogo.asp?t=1|<dominio-da-casa>|<idLeilao>|<idPeca>
 * A partir daí buscamos `catalogo.asp?Num=<idLeilao>` no domínio da casa e cruzamos
 * `idPeca -> nº do lote`. É 1 requisição por LEILÃO (não por lote).
 *
 * O MESMO catálogo, DEPOIS do leilão, traz o **valor de venda** de cada lote — então
 * a captura de vendas (histórico) reaproveita esta varredura por leilão, sem ir lote a
 * lote na `peca.asp`. Ver `parseCatalogData`/`fetchCatalogData` abaixo.
 */
export function parseAuctionRef(url: string): { domain: string; idLeilao: string } | null {
  const m = url.match(/abre_catalogo\.asp\?t=\d+\|([^|]+)\|(\d+)\|(\d+)/i);
  if (!m) return null;
  let domain = (m[1] ?? "").trim();
  if (!domain) return null;
  if (!/^https?:/i.test(domain)) domain = `http://${domain}`;
  return { domain: domain.replace(/\/+$/, ""), idLeilao: m[2]! };
}

/** Dado de um lote extraído do card do catálogo da casa. */
export type CatalogLot = {
  lote: string | null;
  sold: boolean; // vendido/arrematado (há valor de venda e não é "não vendido")
  soldPrice: string | null; // valor de venda em texto BR ("R$ 1.234,56")
  text: string; // texto do card (título/descrição curta) — usado para o grading
};

/** Remove tags HTML e normaliza espaços de um trecho de markup. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Valor em reais no formato BR ("R$ 1.234,56" / "R$ 90,00"). Captura o número.
const BRL_RE = /R\$\s*([\d.]{1,12},\d{2})/i;
// Marcadores de lote NÃO vendido no card do catálogo (fail-closed: some da captura).
const UNSOLD_RE = /n[ãa]o\s+vendid|n[ãa]o\s+arrematad|sem\s+lances?|retirad[oa]|deserto/i;
// Título no atributo `title="..."` do card, ignorando o "Lote-NN".
const TITLE_ATTR_RE = /title="((?!Lote-?\s*\d)[^"]{3,200})"/i;

/**
 * Extrai, por posição, os dados de cada lote do HTML do catálogo da casa. Casa por
 * `peca.asp?ID=<idPeca>` e olha o trecho até a PRÓXIMA `peca.asp` (o card daquele lote),
 * exatamente como o mapeamento do nº do lote sempre fez — a estrutura do container varia
 * entre casas, então NÃO dependemos de classes específicas.
 *
 * ⚠️ CALIBRAÇÃO: o valor de venda é lido de forma tolerante (primeiro `R$ x.xxx,xx` do
 * card, exceto quando há marcador de "não vendido"). O layout exato do `catalogo.asp` de
 * cada casa não pôde ser inspecionado deste ambiente (rede bloqueada p/ o domínio das
 * casas) — ao validar em produção com uma página real, ajuste `BRL_RE`/`UNSOLD_RE` e a
 * captura do título se necessário. É **fail-closed**: sem valor claro, `sold=false` e nada
 * é gravado (nunca inventa venda).
 */
export function parseCatalogData(html: string): Map<string, CatalogLot> {
  const map = new Map<string, CatalogLot>();
  const matches = [...html.matchAll(/peca\.asp\?ID=\s*(\d+)/gi)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i]![1]!;
    if (map.has(id)) continue;
    const start = (matches[i]!.index ?? 0) + matches[i]![0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? html.length) : html.length;
    const seg = html.slice(start, end);

    const lote =
      seg.match(/LoteProd[\s\S]{0,250}?lote\s*:?\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
      seg.match(/title="Lote-?\s*([0-9]+[a-zA-Z]?)"/i)?.[1] ??
      null;

    const priceMatch = seg.match(BRL_RE);
    const soldPrice = priceMatch ? `R$ ${priceMatch[1]}` : null;
    const sold = soldPrice !== null && !UNSOLD_RE.test(seg);

    const title = seg.match(TITLE_ATTR_RE)?.[1]?.trim() ?? "";
    const text = title || stripTags(seg).slice(0, 300);

    map.set(id, { lote, sold, soldPrice, text });
  }
  return map;
}

/**
 * Busca o catálogo do leilão (paginando best-effort) e devolve `idPeca -> CatalogLot`.
 * Fonte única da varredura por leilão (nº do lote e captura de venda). 1 req por página.
 */
export async function fetchCatalogData(
  domain: string,
  idLeilao: string,
): Promise<Map<string, CatalogLot>> {
  const map = new Map<string, CatalogLot>();
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
    for (const [id, data] of parseCatalogData(html)) {
      if (!map.has(id)) {
        map.set(id, data);
        added++;
      }
    }
    // Sem novos itens (catálogo de página única ou fim da paginação) -> encerra.
    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }
  return map;
}

/** Compat: `idPeca -> nº do lote` (só onde há número). Derivado de `fetchCatalogData`. */
export async function fetchLoteMap(domain: string, idLeilao: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [id, data] of await fetchCatalogData(domain, idLeilao)) {
    if (data.lote) map.set(id, data.lote);
  }
  return map;
}

import { publicFetch } from "./leiloesbr-auth.server";
import { decodeHtmlEntities } from "./vinyl-parse";

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
 *
 * `parseAuctionRef` mora em `vinyl-parse.ts` (puro/client-safe) — também usado pelo
 * cliente para montar o link do pregão presencial ao lado da casa em Vigiados.
 */
export { parseAuctionRef } from "./vinyl-parse";

/**
 * Categoria "Disco de Vinil" da plataforma LeilõesBR (o filtro que aparece na tela do catálogo
 * dispara `catalogocontentload.asp?...&Tipo=129&...`). Pedindo com este `Tipo` recebemos **só
 * vinil** — em casas GERAIS isso corta os itens aleatórios (livros, DVD, medalhas…) na origem,
 * em vez de baixar tudo e filtrar por heurística. É um pré-filtro: se a casa não etiquetar os
 * lotes com este Tipo (algumas casas de vinil não etiquetam), o retorno vem vazio e caímos no
 * catálogo completo (o `looksVinyl` downstream continua sendo a última barreira).
 */
const VINYL_TIPO = "129";

/** Dado de um lote extraído do card do catálogo da casa. */
export type CatalogLot = {
  lote: string | null;
  sold: boolean; // vendido/arrematado (há valor de venda e não é "não vendido")
  soldPrice: string | null; // valor de venda em texto BR ("R$ 1.234,56")
  text: string; // texto do card (título/descrição curta) — usado para o grading
  // Campos ricos do endpoint JSON (opcionais — o fallback HTML não os traz). Vêm na MESMA
  // varredura por leilão: sinais de demanda, taxa do leiloeiro e valor inicial/contratado.
  views?: number | null; // VISITAS — nº de visualizações do lote (demanda)
  bids?: number | null; // QTDLANCE — nº de lances (demanda)
  feePct?: number | null; // TAXA_LEILOEIRO — comissão do leiloeiro em % (custo real)
  initialPrice?: number | null; // VALOR_CONTRATADO/VALOR_VALUE — valor inicial (p/ desconto/ágio)
  peca?: string | null; // PECA — título curto/curado do lote ("Disco X - Novo"); melhor p/
  // identidade em casas cujo DESCRICAO é prosa (sem "Artista - Álbum").
};

/**
 * Repara **mojibake** de dupla-codificação (#10): algumas casas (ex.: santavelharia) servem o
 * DESCRICAO com o texto UTF-8 re-codificado como se fosse Latin-1 ("descriçÃ£o" → "descriÃ§Ã£o").
 * Como `Response.text()` já decodifica UTF-8, revertemos UMA camada: reinterpreta a string como
 * bytes Latin-1 e re-decodifica em UTF-8. Só age quando a assinatura de UTF-8-lido-como-Latin-1
 * está presente (byte líder C2/C3 seguido de byte de continuação 0x80–0xBF) e o reparo não
 * introduz o caractere de substituição (�) — assim texto já correto passa intacto.
 */
export function fixMojibake(s: string): string {
  if (!s || !/[\u00c2\u00c3\u00e2][\u0080-\u00bf]/.test(s)) return s;
  try {
    const repaired = Buffer.from(s, "latin1").toString("utf8");
    return repaired.includes("�") ? s : repaired;
  } catch {
    return s;
  }
}

/** Converte um valor cru do JSON (string/number) em número, ou null quando não numérico ("--", ""). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

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
// Valor de VENDA rotulado no card ("Valor de venda: R$ 70,00") — fonte preferida.
const SALE_VALUE_RE = /valor\s+de\s+venda[^R$]{0,20}R\$\s*([\d.]{1,12},\d{2})/i;
// Marcadores de que o lote foi VENDIDO ("Lote vendido", "arrematado").
const SOLD_MARKER_RE = /lote\s+vendido|arrematad|\bvendid[oa]\b/i;
// Marcadores de lote NÃO vendido no card do catálogo (fail-closed: some da captura).
const UNSOLD_RE = /n[ãa]o\s+vendid|n[ãa]o\s+arrematad|sem\s+lances?|retirad[oa]|deserto/i;

/** Decodifica as entidades HTML comuns de um texto de atributo. */
const decodeEntities = decodeHtmlEntities;

/**
 * Descritivo do lote = o texto MAIS LONGO entre os atributos que carregam o tooltip do
 * card (`title`/`alt`/`data-*`). É onde o site guarda a descrição completa que aparece ao
 * passar o mouse (ex.: "GILBERTO GIL - RAÇA HUMANA - CAPA VG+ - DISCO VG+/NM - ..."), então
 * traz o estado (Disco/Capa) sem precisar abrir a `peca.asp` lote a lote. Ignora "Lote-NN".
 */
function longestAttr(seg: string): string {
  let best = "";
  for (const m of seg.matchAll(
    /(?:title|alt|data-(?:title|original-title|content|descricao|desc|tooltip))\s*=\s*"([^"]*)"/gi,
  )) {
    const v = decodeEntities(m[1] ?? "");
    if (/^lote-?\s*\d/i.test(v)) continue; // "Lote-4" não é descritivo
    if (v.length > best.length) best = v;
  }
  return best;
}

/**
 * Extrai, por posição, os dados de cada lote do HTML do catálogo da casa. Casa por
 * `peca.asp?ID=<idPeca>` e olha o trecho até o PRÓXIMO lote (id DIFERENTE) — a estrutura do
 * container varia entre casas, então NÃO dependemos de classes específicas.
 *
 * ⚠️ Um mesmo lote costuma repetir o link `peca.asp?ID=` no card (imagem + título), então o
 * "pedaço" do lote vai do 1º link dele até o 1º link do PRÓXIMO id — senão o trecho ficaria
 * truncado entre a imagem e o título, ANTES do "Valor de venda"/"Lote vendido"/descritivo.
 *
 * Valor de venda: preferimos o rótulo "Valor de venda: R$ …"; na falta dele, um marcador de
 * "vendido"/"arrematado" + o 1º `R$` do card. **Fail-closed**: sem valor claro OU com
 * marcador de "não vendido", `sold=false` e nada é gravado (nunca inventa venda). O layout
 * pode variar entre casas — calibrado a partir do catálogo do Discos Esquecidos (leilões br).
 */
export function parseCatalogData(html: string): Map<string, CatalogLot> {
  const map = new Map<string, CatalogLot>();
  const matches = [...html.matchAll(/peca\.asp\?ID=\s*(\d+)/gi)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i]![1]!;
    if (map.has(id)) continue;
    const start = (matches[i]!.index ?? 0) + matches[i]![0].length;
    // Fim do card = 1º link de um id DIFERENTE (pula as repetições do mesmo lote).
    let j = i + 1;
    while (j < matches.length && matches[j]![1] === id) j++;
    const end = j < matches.length ? (matches[j]!.index ?? html.length) : html.length;
    const seg = html.slice(start, end);

    const lote =
      seg.match(/LoteProd[\s\S]{0,250}?lote\s*:?\s*([0-9]+[a-zA-Z]?)/i)?.[1] ??
      seg.match(/title="Lote-?\s*([0-9]+[a-zA-Z]?)"/i)?.[1] ??
      // Fallback genérico: o cabeçalho "LOTE 4" / "Lote nº 4" do próprio card (último recurso,
      // só quando os padrões acima não casam — melhora a cobertura do nº pré-leilão).
      seg.match(/\blote\s*n?[ºo°]?\s*[:.-]?\s*([0-9]+[a-zA-Z]?)\b/i)?.[1] ??
      null;

    const unsold = UNSOLD_RE.test(seg);
    const labeled = seg.match(SALE_VALUE_RE);
    let soldPrice: string | null = null;
    if (labeled) {
      soldPrice = `R$ ${labeled[1]}`;
    } else if (SOLD_MARKER_RE.test(seg)) {
      const brl = seg.match(BRL_RE);
      if (brl) soldPrice = `R$ ${brl[1]}`;
    }
    const sold = soldPrice !== null && !unsold;

    // Descritivo do card, limpo de fragmentos de href/query (ex.: `&ctd=309&tot=&tipo=&artista="`)
    // e de sobras de atributo malformado, que aparecem em alguns catálogos.
    const text = (longestAttr(seg) || stripTags(seg).slice(0, 400))
      .replace(/&\w+=[^\s"<>]*/g, " ")
      .replace(/^[\s"'>]+/, "")
      .replace(/\s+/g, " ")
      .trim();

    map.set(id, { lote, sold, soldPrice, text });
  }
  return map;
}

/**
 * Extrai o array `PECAS` do JSON do endpoint, tolerando as variações de embrulho entre casas:
 *   `[{ "PECAS":[…] }]`                (Discos Esquecidos)
 *   `{ "Catalogo":[{ "PECAS":[…] }] }` (Catavento Discos)
 *   `{ "PECAS":[…] }`
 */
export function extractPecas(parsed: unknown): Record<string, unknown>[] {
  const fromNode = (n: unknown): Record<string, unknown>[] | null => {
    if (!n || typeof n !== "object") return null;
    const o = n as Record<string, unknown>;
    if (Array.isArray(o["PECAS"])) return o["PECAS"] as Record<string, unknown>[];
    for (const v of Object.values(o)) {
      if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
        const inner = (v[0] as Record<string, unknown>)["PECAS"];
        if (Array.isArray(inner)) return inner as Record<string, unknown>[];
      }
    }
    return null;
  };
  if (Array.isArray(parsed)) {
    for (const el of parsed) {
      const r = fromNode(el);
      if (r) return r;
    }
    return [];
  }
  return fromNode(parsed) ?? [];
}

/**
 * Endpoint de DADOS do catálogo (JSON), usado pelo template novo da LeilõesBR. O `catalogo.asp`
 * dessas casas é renderizado por JavaScript (o HTML server-side vem sem os lotes), mas o JS
 * busca os lotes deste endpoint — que o nosso servidor pode chamar direto. Cada peça tem
 * `ID, LOTE, VALOR_VENDA, DESCRICAO, MOSTRABTN_CLASS ('is-vendido'|'is-naovendido')`.
 * ⚠️ `VALOR_VENDA` é o valor REAL (mesmo quando `VALOR_VALUE` vem "--"/escondido nos leilões
 * antigos) — por isso os antigos ainda dão para capturar. Paginado (`limit=30`).
 */
async function fetchCatalogJson(
  domain: string,
  idLeilao: string,
  tipo = "",
): Promise<Map<string, CatalogLot>> {
  const map = new Map<string, CatalogLot>();
  const LIMIT = 30;
  for (let pag = 1; pag <= 80; pag++) {
    const url =
      `${domain}/templates/catalogo/asp/catalogocontentload.asp` +
      `?leilao=${idLeilao}&pesquisa=&irpara=&Dia=&Tipo=${tipo}&artista=&Srt=0&Temtotal=1` +
      `&pag=${pag}&remote=1&limit=${LIMIT}&_=${Date.now()}`;
    let raw: string;
    try {
      raw = await publicFetch(url, {});
    } catch {
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      break; // não é JSON → casa não usa este endpoint (template antigo)
    }
    const pecas = extractPecas(parsed);
    if (pecas.length === 0) break;
    for (const p of pecas as Record<string, unknown>[]) {
      const id = String(p["ID"] ?? "").trim();
      if (!id || map.has(id)) continue;
      const sold = p["MOSTRABTN_CLASS"] === "is-vendido";
      const valor = String(p["VALOR_VENDA"] ?? p["VALOR_VALUE"] ?? "").trim();
      const soldPrice = sold && valor && valor !== "0" ? `R$ ${valor},00` : null;
      const text = decodeEntities(
        fixMojibake(String(p["DESCRICAO"] ?? p["MINI_DESCRICAO"] ?? "").trim()),
      );
      const lote = String(p["LOTE"] ?? "").trim() || null;
      map.set(id, {
        lote,
        sold: sold && soldPrice !== null,
        soldPrice,
        text,
        views: numOrNull(p["VISITAS"]),
        bids: numOrNull(p["QTDLANCE"]),
        feePct: numOrNull(p["TAXA_LEILOEIRO"]),
        initialPrice: numOrNull(p["VALOR_CONTRATADO"] ?? p["VALOR_VALUE"]),
        peca: decodeEntities(fixMojibake(String(p["PECA"] ?? "").trim())) || null,
      });
    }
    if (pecas.length < LIMIT) break; // última página
  }
  return map;
}

/** Fallback: catálogo renderizado no HTML (template antigo, server-side). Paginado. */
async function fetchCatalogHtml(
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
    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }
  return map;
}

/**
 * Busca os lotes de um leilão e devolve `idPeca -> CatalogLot`. Tenta primeiro o endpoint JSON
 * (`catalogocontentload.asp`, template novo — casas de vinil); se não vier JSON, cai no HTML do
 * `catalogo.asp` (template antigo, server-side). Fonte única da varredura por leilão.
 */
export async function fetchCatalogData(
  domain: string,
  idLeilao: string,
): Promise<Map<string, CatalogLot>> {
  // 1) Só vinil (Tipo=129): casas gerais devolvem apenas discos, cortando itens aleatórios na
  //    origem. 2) Se vier vazio (casa não etiqueta esse Tipo), catálogo completo por JSON.
  //    3) Fallback final: HTML server-side (template antigo).
  const vinyl = await fetchCatalogJson(domain, idLeilao, VINYL_TIPO);
  if (vinyl.size) return vinyl;
  const json = await fetchCatalogJson(domain, idLeilao);
  if (json.size) return json;
  return fetchCatalogHtml(domain, idLeilao);
}

/** Compat: `idPeca -> nº do lote` (só onde há número). Derivado de `fetchCatalogData`. */
export async function fetchLoteMap(domain: string, idLeilao: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [id, data] of await fetchCatalogData(domain, idLeilao)) {
    if (data.lote) map.set(id, data.lote);
  }
  return map;
}

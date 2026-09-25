import { publicFetch } from "./leiloesbr-auth.server";
import { auctionHouseDomain } from "./vinyl-parse";

/**
 * Detalhes de UM lote que só existem na página individual (`peca.asp?ID=<idPeca>`, mesma
 * lógica em toda casa — só o domínio muda), nunca na listagem geral nem nas páginas de conta:
 * - **Valor atual** (`VALOR_VALUE`, MESMO JSON `loadData`) — ao vivo, direto da página do
 *   próprio lote. Preferido sobre `price`/`priceById` (varredura geral, cron 3×/dia — fica
 *   defasado, e some de vez quando o leilão entra ao vivo e o lote sai da listagem pública).
 * - **Próximo lance** (`NOVO_VALOR`, JSON `loadData` embutido) — só o lote ABERTO traz isso.
 * - **Resultado da venda**, quando o leilão já terminou — a MESMA página/JSON também traz
 *   `MOSTRABTN_CLASS` ('is-vendido'|'is-naovendido') e `VALOR_VENDA`, os MESMOS campos que
 *   `leiloesbr-catalog.server.ts` já lê com sucesso para o Vinil Analytics (lá vêm do catálogo
 *   do leilão inteiro; aqui, da página do PRÓPRIO lote) — lidos com a mesma técnica de regex
 *   pontual no campo já usada para `NOVO_VALOR`, não um chute de texto livre. É o sinal MAIS
 *   RÁPIDO de "vendido" para quem só VIGIA (sem lance) — a página de vigia não traz status, e
 *   `lot_sales` só é preenchida pelo cron `step=sales` bem depois (e só depois que o LEILÃO
 *   INTEIRO termina — um lote pode já estar vendido num pregão ainda "ao vivo").
 * - **Casas do template ANTIGO** (catálogo HTML server-side, sem o JSON `loadData`): confirmado
 *   contra o HTML real (Robson Gini/Trem das 7) que a peça.asp NÃO embute `MOSTRABTN_CLASS`
 *   nessas casas. O sinal aqui é a CLASSE do botão de lance, que muda quando o leiloeiro bate o
 *   martelo: `<li id="fazerlance" class="is-CoolBtn lotevendido"><span>Lote Vendido</span></li>`
 *   — ver `parseSoldOldTemplate` abaixo (⚠️ NÃO usar marcadores de texto livre tipo "vendido"/
 *   "lote vendido": essa MESMA frase aparece nos Termos e Condições, presentes em TODA peça.asp,
 *   vendida ou não — daria falso positivo sempre).
 *
 * 1 requisição por lote serve os dois — usar só para conjuntos pequenos (vigiados + lances),
 * nunca para a listagem inteira.
 */

export type LotDetails = { currentValue?: string; nextBid?: string; sold?: string };

/** Monta a URL do `peca.asp` no domínio da casa a partir da URL do lote + idPeca. */
function pecaUrl(lotUrl: string, idPeca: string): string | null {
  if (!idPeca) return null;
  const domain = auctionHouseDomain(lotUrl);
  return domain ? `${domain}/peca.asp?id=${idPeca}` : null;
}

/** Formata um valor cru (string numérica BR) do `loadData` em BRL, ou `null` se inválido. */
function formatValor(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Extrai o valor atual (VALOR_VALUE) do HTML da peça e formata em BRL. */
function parseCurrentValue(html: string): string | null {
  const m = html.match(/"VALOR_VALUE":"(\d+(?:[.,]\d+)?)"/);
  return m ? formatValor(m[1]) : null;
}

/** Extrai o próximo lance (NOVO_VALOR) do HTML da peça e formata em BRL. */
function parseNextBid(html: string): string | null {
  const m = html.match(/"NOVO_VALOR":"(\d+(?:[.,]\d+)?)"/);
  return m ? formatValor(m[1]) : null;
}

// Classe do botão de lance quando o leiloeiro já bateu o martelo (template ANTIGO). Token CSS
// só usado nesse estado — não colide com o texto livre "Lote vendido" dos Termos e Condições
// (que também está presente, sem espaço, em toda peça.asp, vendida ou não).
const OLD_TEMPLATE_SOLD_CLASS_RE = /\blotevendido\b/;
// "Valor de venda" e o preço vêm no MESMO bloco, mas em spans SEPARADOS
// (`<span class="is-rs">R$</span> <span class="is-valor">15,00</span>`) — não como texto
// contínuo "R$ 15,00" (por isso não dá pra reaproveitar o `BRL_RE` do catálogo aqui).
const OLD_TEMPLATE_PRICE_RE =
  /valor\s+de\s+venda[\s\S]{0,300}?is-valor"[^>]*>\s*([\d.]{1,12},\d{2})/i;

/** Fallback de texto/classe para casas do template ANTIGO (peça.asp sem JSON `loadData`). */
function parseSoldOldTemplate(html: string): string | undefined {
  if (!OLD_TEMPLATE_SOLD_CLASS_RE.test(html)) return undefined;
  const price = html.match(OLD_TEMPLATE_PRICE_RE)?.[1];
  return price ? `R$ ${price}` : "Vendido";
}

/**
 * Mesmos campos do `loadData` que `leiloesbr-catalog.server.ts` já lê com sucesso do catálogo
 * (`MOSTRABTN_CLASS`, `VALOR_VENDA`) — aqui embutidos na página do PRÓPRIO lote. `is-naovendido`
 * é um sinal EXPLÍCITO de "não vendido" (fail-closed: undefined, sem cair no fallback abaixo).
 * Quando o campo nem existe (casa do template ANTIGO, sem esse JSON), cai em
 * `parseSoldOldTemplate` (classe do botão de lance, ver acima).
 */
function parseSold(html: string): string | undefined {
  const status = html.match(/"MOSTRABTN_CLASS":"([^"]*)"/)?.[1];
  if (status === "is-vendido") {
    const valor = html.match(/"VALOR_VENDA":"([^"]*)"/)?.[1]?.trim();
    return valor && valor !== "0" ? `R$ ${valor},00` : "Vendido";
  }
  if (status === "is-naovendido") return undefined;
  return parseSoldOldTemplate(html);
}

async function fetchOne(target: {
  id: string;
  idPeca: string;
  url: string;
}): Promise<[string, LotDetails] | null> {
  const url = pecaUrl(target.url, target.idPeca);
  if (!url) return null;
  try {
    // Referer da própria casa (não o padrão leiloesbr.com.br de `publicFetch`) — ver o
    // mesmo fix em `leiloesbr-catalog.server.ts` (v0.85.0): Referer de origem cruzada
    // pro domínio da casa zera a resposta em silêncio (HTTP 200 vazio, nunca um erro).
    const domain = auctionHouseDomain(target.url);
    const html = await publicFetch(url, domain ? { referer: `${domain}/` } : {});
    const details: LotDetails = {};
    const currentValue = parseCurrentValue(html);
    if (currentValue) details.currentValue = currentValue;
    const nextBid = parseNextBid(html);
    if (nextBid) details.nextBid = nextBid;
    const sold = parseSold(html);
    if (sold) details.sold = sold;
    return details.currentValue || details.nextBid || details.sold ? [target.id, details] : null;
  } catch {
    return null;
  }
}

/**
 * Busca os detalhes de cada lote, com concorrência limitada e um teto de alvos (protege o
 * tempo do servidor). Chave/dedup por `id` (`${idLeilao}-${idPeca}`), NUNCA por `idPeca`
 * sozinho — `idPeca` é só único DENTRO de uma casa/leilão; casas diferentes (instalações
 * independentes da mesma plataforma) reaproveitam os mesmos números, então dedupar ou
 * indexar só por `idPeca` já misturou o resultado de venda de um lote vigiado com outro lote
 * (de outra casa) que só coincidia no `idPeca`. Best-effort: lotes que falharem ou não
 * trouxerem nada de útil simplesmente ficam de fora do mapa.
 */
export async function fetchLotDetails(
  targets: { id: string; idPeca: string; url: string }[],
): Promise<Record<string, LotDetails>> {
  const byId = new Map<string, { idPeca: string; url: string }>(); // id -> {idPeca, url} (dedup por lote)
  for (const t of targets) {
    if (t?.id && t?.idPeca && t?.url && !byId.has(t.id))
      byId.set(t.id, { idPeca: t.idPeca, url: t.url });
  }
  const list = [...byId].slice(0, 100).map(([id, v]) => ({ id, idPeca: v.idPeca, url: v.url }));
  const out: Record<string, LotDetails> = {};
  const CONCURRENCY = 8;
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const item = list[cursor++]!;
      const res = await fetchOne(item);
      if (res) out[res[0]] = res[1];
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  return out;
}

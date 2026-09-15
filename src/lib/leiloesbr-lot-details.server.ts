import { publicFetch } from "./leiloesbr-auth.server";
import { auctionHouseDomain } from "./vinyl-parse";

/**
 * Detalhes de UM lote que só existem na página individual (`peca.asp?ID=<idPeca>`, mesma
 * lógica em toda casa — só o domínio muda), nunca na listagem geral nem nas páginas de conta:
 * - **Próximo lance** (`NOVO_VALOR`, JSON `loadData` embutido) — só o lote ABERTO traz isso.
 * - **Resultado da venda**, quando o leilão já terminou — a MESMA página/JSON também traz
 *   `MOSTRABTN_CLASS` ('is-vendido'|'is-naovendido') e `VALOR_VENDA`, os MESMOS campos que
 *   `leiloesbr-catalog.server.ts` já lê com sucesso para o Vinil Analytics (lá vêm do catálogo
 *   do leilão inteiro; aqui, da página do PRÓPRIO lote) — lidos com a mesma técnica de regex
 *   pontual no campo já usada para `NOVO_VALOR`, não um chute de texto livre. É o sinal MAIS
 *   RÁPIDO de "vendido" para quem só VIGIA (sem lance) — a página de vigia não traz status, e
 *   `lot_sales` só é preenchida pelo cron `step=sales` bem depois.
 *
 * 1 requisição por lote serve os dois — usar só para conjuntos pequenos (vigiados + lances),
 * nunca para a listagem inteira.
 */

export type LotDetails = { nextBid?: string; sold?: string };

/** Monta a URL do `peca.asp` no domínio da casa a partir da URL do lote + idPeca. */
function pecaUrl(lotUrl: string, idPeca: string): string | null {
  if (!idPeca) return null;
  const domain = auctionHouseDomain(lotUrl);
  return domain ? `${domain}/peca.asp?id=${idPeca}` : null;
}

/** Extrai o próximo lance (NOVO_VALOR) do HTML da peça e formata em BRL. */
function parseNextBid(html: string): string | null {
  const m = html.match(/"NOVO_VALOR":"(\d+(?:[.,]\d+)?)"/);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Mesmos campos do `loadData` que `leiloesbr-catalog.server.ts` já lê com sucesso do catálogo
 * (`MOSTRABTN_CLASS`, `VALOR_VENDA`) — aqui embutidos na página do PRÓPRIO lote. Fail-closed:
 * campo ausente ou `is-naovendido` → `undefined` (sem tarja por esse sinal; `lot_sales` e
 * `bidStatus` continuam valendo como fallback).
 */
function parseSold(html: string): string | undefined {
  const status = html.match(/"MOSTRABTN_CLASS":"([^"]*)"/)?.[1];
  if (status !== "is-vendido") return undefined;
  const valor = html.match(/"VALOR_VENDA":"([^"]*)"/)?.[1]?.trim();
  return valor && valor !== "0" ? `R$ ${valor},00` : "Vendido";
}

async function fetchOne(target: {
  id: string;
  idPeca: string;
  url: string;
}): Promise<[string, LotDetails] | null> {
  const url = pecaUrl(target.url, target.idPeca);
  if (!url) return null;
  try {
    const html = await publicFetch(url, {});
    const details: LotDetails = {};
    const nextBid = parseNextBid(html);
    if (nextBid) details.nextBid = nextBid;
    const sold = parseSold(html);
    if (sold) details.sold = sold;
    return details.nextBid || details.sold ? [target.id, details] : null;
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

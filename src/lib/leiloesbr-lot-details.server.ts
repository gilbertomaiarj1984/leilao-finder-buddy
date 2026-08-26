import { publicFetch } from "./leiloesbr-auth.server";
import { parseAuctionRef } from "./leiloesbr-catalog.server";

/**
 * Próximo lance (o valor mínimo do próximo lance) NÃO existe na listagem geral nem
 * nas páginas de conta — só na página do lote (`peca.asp`), que embute um JSON
 * `loadData` com `data[0].NOVO_VALOR` (o próximo lance já calculado pelo site) e
 * `VALOR_VALUE` (valor atual). Só o lote ABERTO traz `NOVO_VALOR` (os itens de
 * `listalotes` não), então é 1 requisição por lote — usar só para conjuntos pequenos
 * (vigiados + lances), nunca para a listagem inteira.
 */

/** Monta a URL do `peca.asp` no domínio da casa a partir da URL do lote + idPeca. */
function pecaUrl(lotUrl: string, idPeca: string): string | null {
  if (!idPeca) return null;
  // A URL já pode ser a da peça (stretched-link das páginas de conta).
  if (/peca\.asp/i.test(lotUrl)) {
    try {
      const abs = /^https?:/i.test(lotUrl) ? lotUrl : `https://${lotUrl.replace(/^\/+/, "")}`;
      const u = new URL(abs);
      return `${u.protocol}//${u.host}/peca.asp?id=${idPeca}`;
    } catch {
      /* cai no parseAuctionRef abaixo */
    }
  }
  // Listagem geral: abre_catalogo.asp?t=1|<domínio>|<idLeilao>|<idPeca>.
  const ref = parseAuctionRef(lotUrl);
  if (ref) return `${ref.domain}/peca.asp?id=${idPeca}`;
  return null;
}

/** Extrai o próximo lance (NOVO_VALOR) do HTML da peça e formata em BRL. */
function parseNextBid(html: string): string | null {
  const m = html.match(/"NOVO_VALOR":"(\d+(?:[.,]\d+)?)"/);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function fetchOne(target: { idPeca: string; url: string }): Promise<[string, string] | null> {
  const url = pecaUrl(target.url, target.idPeca);
  if (!url) return null;
  try {
    const html = await publicFetch(url, {});
    const nb = parseNextBid(html);
    return nb ? [target.idPeca, nb] : null;
  } catch {
    return null;
  }
}

/**
 * Busca o próximo lance de cada lote (por `idPeca`), com concorrência limitada e um
 * teto de alvos (protege o tempo do servidor). Best-effort: lotes que falharem ou não
 * trouxerem NOVO_VALOR simplesmente ficam de fora do mapa.
 */
export async function fetchNextBids(
  targets: { idPeca: string; url: string }[],
): Promise<Record<string, string>> {
  const byPeca = new Map<string, string>(); // idPeca -> url (dedup por peça)
  for (const t of targets) {
    if (t?.idPeca && t?.url && !byPeca.has(t.idPeca)) byPeca.set(t.idPeca, t.url);
  }
  const list = [...byPeca].slice(0, 100).map(([idPeca, url]) => ({ idPeca, url }));
  const out: Record<string, string> = {};
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

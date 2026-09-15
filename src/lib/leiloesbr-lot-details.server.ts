import { publicFetch } from "./leiloesbr-auth.server";
import { auctionHouseDomain } from "./vinyl-parse";

/**
 * Detalhes de UM lote que só existem na página individual (`peca.asp`), nunca na listagem
 * geral nem nas páginas de conta:
 * - **Próximo lance** (`NOVO_VALOR`, JSON `loadData` embutido) — só o lote ABERTO traz isso.
 * - **Resultado da venda**, quando o leilão já terminou — mesmos marcadores de texto do
 *   catálogo (`leiloesbr-catalog.server.ts`: "Valor de venda: R$ …"/"Lote vendido"/"não
 *   vendido"), aqui aplicados ao texto corrido da página (1 lote só, sem precisar segmentar).
 *   É o sinal MAIS RÁPIDO de "vendido" para quem só VIGIA (sem lance) — a página de vigia não
 *   traz status, e `lot_sales` só é preenchida pelo cron `step=sales` bem depois.
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

// Mesmos marcadores de "vendido" do catálogo (`leiloesbr-catalog.server.ts`), aqui contra o
// texto corrido da página do lote (um único lote, não precisa segmentar por `peca.asp?ID=`).
const SALE_VALUE_RE = /valor\s+de\s+venda[^R$]{0,20}R\$\s*([\d.]{1,12},\d{2})/i;
const SOLD_MARKER_RE = /lote\s+vendido|arrematad|\bvendid[oa]\b/i;
const UNSOLD_RE = /n[ãa]o\s+vendid|n[ãa]o\s+arrematad|sem\s+lances?|retirad[oa]|deserto/i;
const BRL_RE = /R\$\s*([\d.]{1,12},\d{2})/i;

/** Fail-closed: "não vendido" nunca marca; sem marcador claro de venda, retorna `undefined`. */
function parseSold(html: string): string | undefined {
  if (UNSOLD_RE.test(html)) return undefined;
  const labeled = html.match(SALE_VALUE_RE);
  if (labeled) return `R$ ${labeled[1]}`;
  if (SOLD_MARKER_RE.test(html)) {
    const brl = html.match(BRL_RE);
    return brl ? `R$ ${brl[1]}` : "Vendido";
  }
  return undefined;
}

async function fetchOne(target: {
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
    return details.nextBid || details.sold ? [target.idPeca, details] : null;
  } catch {
    return null;
  }
}

/**
 * Busca os detalhes de cada lote (por `idPeca`), com concorrência limitada e um teto de
 * alvos (protege o tempo do servidor). Best-effort: lotes que falharem ou não trouxerem nada
 * de útil simplesmente ficam de fora do mapa.
 */
export async function fetchLotDetails(
  targets: { idPeca: string; url: string }[],
): Promise<Record<string, LotDetails>> {
  const byPeca = new Map<string, string>(); // idPeca -> url (dedup por peça)
  for (const t of targets) {
    if (t?.idPeca && t?.url && !byPeca.has(t.idPeca)) byPeca.set(t.idPeca, t.url);
  }
  const list = [...byPeca].slice(0, 100).map(([idPeca, url]) => ({ idPeca, url }));
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

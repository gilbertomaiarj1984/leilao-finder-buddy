import { authFetch, BASE_URL } from "./leiloesbr-auth.server";

/**
 * Um lance dado pelo usuário, lido da página "Meus lances" (conta_site.asp?l=4).
 * O valor ATUAL do lote não vem daqui — é casado por `id` com a varredura geral.
 */
export type MyBid = {
  id: string; // `${idLeilao}-${idPeca}` — mesma chave da varredura (parseCard)
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string;
  title: string;
  myBid: string; // "R$70,00" — o valor do MEU lance
  status: string; // "Coberto" | "Vencendo" | "Vencedor" | "Não vendido" | ...
  url: string;
  image: string | null;
  date: string; // dd/mm/yyyy
  house: string;
  uf: string;
  watched: boolean; // se o lote também está sendo vigiado
};

const looksAnonymous = (html: string) => !html.includes("data-watch") && !html.includes("data-fav");

const decode = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function parseBidChunk(chunk: string): MyBid | null {
  const flat = chunk.replace(/\s+/g, " ");
  const grab = (re: RegExp) => decode(flat.match(re)?.[1] ?? "");

  // idPeca,email,idLeilao,base — presente no botão de vigia (ou favorito) do card.
  const data = (
    flat.match(/data-watch="([^"]+)"/)?.[1] ??
    flat.match(/data-fav="([^"]+)"/)?.[1] ??
    ""
  ).split(",");
  const idPeca = data[0]?.trim() || flat.match(/peca\.asp\?ID=(\d+)/)?.[1] || "";
  if (!idPeca) return null;

  const idLeilao = data[2]?.trim() || flat.match(/leilao\.asp\?Num=(\d+)/)?.[1] || "";
  const dateMatch = flat.match(/(\d{2}\/\d{2}\/\d{4})/);

  return {
    id: `${idLeilao}-${idPeca}`,
    idPeca,
    idLeilao,
    base: data[3]?.trim() ?? "0",
    lote: grab(/title="Lote-?([^"]*)"/),
    // O título completo fica no atributo title (aspas simples) do link do product-title.
    title: grab(/product-title.*?<a [^>]*title='([^']+)'/) || grab(/<\/span><br>\s*([^<]+)/),
    myBid: grab(/<b class="pb-1"[^>]*>([^<]+)</),
    status: grab(/class='lstatus[^']*'[^>]*title='([^']+)'/),
    url: grab(/<a href="([^"]+)"[^>]*class="stretched-link"/) || BASE_URL,
    image: grab(/<img[^>]*src="([^"]+)"/) || null,
    date: dateMatch?.[1] ?? "",
    house: grab(/ellipsis-overflow">(?:<a[^>]*>)?([^<]+?)\s*-\s*<span class="pesq-uf"/),
    uf: grab(/class="pesq-uf">([^<]+)</),
    watched: /class="[^"]*\bwatch\b[^"]*\bativo\b[^"]*"/.test(flat),
  };
}

/**
 * Lê todos os lances do usuário direto da conta (conta_site.asp?l=4).
 * t=0 (peças), s=0 (leilões em andamento), b=0 (base LeilõesBR). Best-effort.
 */
export async function listMyBidsFromSite(): Promise<MyBid[]> {
  const seen = new Set<string>();
  const out: MyBid[] = [];

  for (let page = 1; page <= 20; page++) {
    const html = await authFetch(
      `${BASE_URL}/conta_site.asp?l=4&t=0&s=0&b=0&id=0&p=&order=0&pag=${page}`,
      {},
      page === 1 ? looksAnonymous : undefined,
    );

    let added = 0;
    for (const chunk of html.split('<div class="oc-item').slice(1)) {
      const bid = parseBidChunk(chunk);
      if (!bid || seen.has(bid.idPeca)) continue;
      seen.add(bid.idPeca);
      out.push(bid);
      added++;
    }

    if (added === 0) break;
    if (!html.includes(`pag=${page + 1}`)) break;
  }

  return out;
}

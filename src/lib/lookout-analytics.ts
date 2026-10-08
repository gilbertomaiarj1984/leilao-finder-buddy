import { buildAnalytics, type AnalyticsAliases, type SaleRow } from "@/lib/analytics";
import {
  buildLotIdentity,
  LOOKOUT_CONFIDENT_MIN,
  matchLookoutForLot,
  yearVerdict,
  type LookoutCandidate,
  type LookoutLinks,
} from "@/lib/lookout-match";

/**
 * "De olho" × Vinil Analytics (v0.109.0) — módulo ISOLADO e puro: acha, nas vendas já agregadas
 * pelo Analytics (`buildAnalytics`: reidentificação por IA, correções por venda, apelidos de
 * artista/álbum, exclusões, kits/não-vinil fora, singular/plural unidos), os álbuns que são o
 * MESMO disco de um item de olho, e devolve as vendas desses álbuns. Soma-se ao casamento direto
 * venda a venda (`lookout-matches.server.ts`), que continua existindo.
 *
 * Para DESLIGAR a função inteira: `LOOKOUT_HISTORY_FROM_ANALYTICS = false` em
 * `lookout-matches.server.ts` (ou reverter o commit v0.109.0 — nada mais depende deste arquivo).
 */

/** Anos citados num texto (título da venda). */
function yearsIn(text: string): Set<number> {
  return new Set([...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0])));
}

type AnalyticsHistoryHit = {
  itemId: string;
  score: number;
  sale: SaleRow;
  /** Disco de nome genérico sem ano validável nesta venda: fica "a validar" pelo usuário. */
  pending: boolean;
};

/** Álbum agregado sem nome definido — nunca casa com um disco específico. */
const UNIDENTIFIED_ALBUM = "(álbum não identificado)";

export function analyticsHistoryForItems(input: {
  sales: SaleRow[];
  aliases: AnalyticsAliases;
  cands: readonly LookoutCandidate[];
  links?: LookoutLinks;
  /** Ano conhecido da venda por outra fonte (ex.: `lot_ident.year`). */
  yearOf?: (lotId: string) => number | null;
}): AnalyticsHistoryHit[] {
  const { sales, aliases, cands, links, yearOf } = input;
  if (!cands.length || !sales.length) return [];
  // Lotes de origem por item (um item "juntado" tem vários: o principal e os dos álbuns juntados).
  const originsByItem = new Map<string, Set<string>>();
  for (const c of cands) {
    const set = originsByItem.get(c.item.id) ?? new Set<string>();
    set.add(c.item.lotId);
    originsByItem.set(c.item.id, set);
  }
  const candByItem = new Map(cands.map((c) => [c.item.id, c]));
  const out: AnalyticsHistoryHit[] = [];
  for (const artist of buildAnalytics(sales, aliases)) {
    for (const album of artist.albums) {
      if (album.album === UNIDENTIFIED_ALBUM) continue;
      // O álbum agregado faz o papel de um "lote": artista e álbum já canônicos (pós-apelidos).
      const identity = buildLotIdentity({
        title: `${artist.artist} ${album.album}`,
        artist: artist.artist,
        album: `${artist.artist} - ${album.album}`,
      });
      // Sem o filtro de ano aqui: o álbum agregado junta vendas de VÁRIOS anos; o ano é conferido
      // venda a venda logo abaixo (disco de nome genérico, ex.: homônimo do artista).
      const hit = matchLookoutForLot(cands, "", identity, undefined, { yearGate: false });
      if (!hit || hit.score < LOOKOUT_CONFIDENT_MIN) continue;
      const origins = originsByItem.get(hit.itemId);
      const cand = candByItem.get(hit.itemId);
      for (const sale of album.sales) {
        if (origins?.has(sale.lot_id)) continue; // o próprio lote marcado não é "aparição anterior"
        const link = links?.[sale.lot_id];
        if (link === false) continue; // descartado pelo usuário
        let pending = false;
        if (cand && link !== hit.itemId) {
          const years = yearsIn(sale.title);
          const known = yearOf?.(sale.lot_id);
          if (known) years.add(known);
          const verdict = yearVerdict(cand.item, cand.cand, years);
          if (verdict === "reject") continue; // outro disco do mesmo artista
          pending = verdict === "pending";
        }
        out.push({ itemId: hit.itemId, score: pending ? 0.7 : hit.score, sale, pending });
      }
    }
  }
  return out;
}

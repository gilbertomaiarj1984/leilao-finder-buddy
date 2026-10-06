import { buildAnalytics, type AnalyticsAliases, type SaleRow } from "@/lib/analytics";
import {
  buildLotIdentity,
  LOOKOUT_CONFIDENT_MIN,
  matchLookoutForLot,
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

type AnalyticsHistoryHit = {
  itemId: string;
  score: number;
  sale: SaleRow;
};

/** Álbum agregado sem nome definido — nunca casa com um disco específico. */
const UNIDENTIFIED_ALBUM = "(álbum não identificado)";

export function analyticsHistoryForItems(input: {
  sales: SaleRow[];
  aliases: AnalyticsAliases;
  cands: readonly LookoutCandidate[];
  links?: LookoutLinks;
}): AnalyticsHistoryHit[] {
  const { sales, aliases, cands, links } = input;
  if (!cands.length || !sales.length) return [];
  const originByItem = new Map(cands.map((c) => [c.item.id, c.item.lotId]));
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
      const hit = matchLookoutForLot(cands, "", identity);
      if (!hit || hit.score < LOOKOUT_CONFIDENT_MIN) continue;
      const origin = originByItem.get(hit.itemId);
      for (const sale of album.sales) {
        if (sale.lot_id === origin) continue; // o próprio lote marcado não é "aparição anterior"
        if (links?.[sale.lot_id] === false) continue; // descartado pelo usuário
        out.push({ itemId: hit.itemId, score: hit.score, sale });
      }
    }
  }
  return out;
}

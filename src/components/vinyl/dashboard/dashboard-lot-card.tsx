import { LotCard } from "@/components/vinyl/lot-card";
import type { VinylLot } from "@/lib/vinyl-parse";

import type { DashboardData } from "./use-dashboard-data";

/**
 * `LotCard` completo da listagem do dia (nota da IA, Discogs, estado, vigia, lance agendado, de
 * olho, coleção, excluir…) já ligado aos dados e ações da home (`DashboardData`). Usado na grade
 * do dia, na busca e no cartão aberto de "Lotes sem lance" — um ponto só para as props.
 */
export function DashboardLotCard({ d, lot }: { d: DashboardData; lot: VinylLot }) {
  const watched = d.watchedIds.size ? d.watchedIds.has(lot.idPeca) : lot.watched;
  return (
    <LotCard
      lot={{
        ...lot,
        watched,
        price: d.currentPriceFor(lot.id, lot.price),
        lote: lot.lote || d.loteById.get(lot.idPeca) || "",
        myBid: d.myBidById.get(lot.idPeca),
        nextBid: d.nextBidById.get(lot.id),
      }}
      busy={d.pending === lot.idPeca}
      ai={d.aiFor(lot)}
      market={d.marketFor(lot)}
      album={d.albumFor(lot)}
      condition={d.conditionFor(lot)}
      demand={d.demandFor(lot)}
      owned={d.ownedFor(lot)}
      {...d.lookoutProps(lot)}
      onOpenOwned={() => d.setOwnedPanelLot(lot)}
      onEditTags={d.editTags(lot.id)}
      bidStatus={d.bidStatusById.get(lot.idPeca)}
      sold={d.soldById.get(lot.id)}
      possibleTrash={d.possibleTrashFor(lot)}
      onExclude={() => d.setExcludeTarget({ id: lot.id, title: lot.title })}
      onDismissTrash={() => {
        const signal = d.possibleTrashFor(lot);
        if (signal) d.dismissTrashMutation.mutate(signal.matchedTerms);
      }}
      onToggle={() =>
        d.toggle.mutate({
          idPeca: lot.idPeca,
          idLeilao: lot.idLeilao,
          base: lot.base,
          watch: !watched,
        })
      }
    />
  );
}

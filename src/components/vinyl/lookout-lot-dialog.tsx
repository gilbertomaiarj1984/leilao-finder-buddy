import { LotCard } from "@/components/vinyl/lot-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLotCardData } from "@/components/vinyl/use-lot-card-data";
import type { LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";

/**
 * Cartão COMPLETO do lote (o mesmo `LotCard` da home: nota da IA, Discogs, estado Disco/Capa,
 * demanda, tags, vigia…) aberto ao clicar num lote "por vir" da página `/olho`. Os dados vêm das
 * mesmas consultas (mesmo cache) da home.
 */
export function LookoutLotDialog({
  lot,
  item,
  watching,
  busy,
  onWatch,
  onClose,
}: {
  lot: LookoutUpcoming | null;
  item: LookoutItem | null;
  watching: boolean;
  busy: boolean;
  onWatch: (m: LookoutUpcoming) => void;
  onClose: () => void;
}) {
  const { ai, market, album, condition, demand } = useLotCardData(
    lot ? { id: lot.lotId, title: lot.title, uf: lot.uf } : null,
  );

  return (
    <Dialog open={lot != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-3">
        <DialogTitle className="sr-only">Lote por vir</DialogTitle>
        <DialogDescription className="sr-only">
          Cartão completo do lote, com avaliação da IA, mercado, estado e ações.
        </DialogDescription>
        {lot ? (
          <LotCard
            lot={{
              id: lot.lotId,
              title: lot.title,
              url: lot.url,
              image: lot.image,
              price: lot.price,
              time: lot.time,
              house: lot.house,
              uf: lot.uf,
              dayKey: lot.dayKey,
              watched: watching,
              lote: lot.lote,
            }}
            busy={busy}
            showDate
            onToggle={() => onWatch(lot)}
            ai={ai}
            market={market}
            album={album}
            condition={condition}
            demand={demand}
            lookout={{ on: true, hit: null, maxPrice: item?.maxPrice ?? null }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

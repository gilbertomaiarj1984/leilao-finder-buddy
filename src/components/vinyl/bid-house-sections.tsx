import { ChevronDown, ChevronRight, ChevronUp, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { catalogUrlFromLot } from "@/lib/vinyl-parse";
import type { OwnedHit } from "@/lib/wantlist-match";

import { BidStatBadges } from "./badges";
import { computeBidStats } from "./grouping";
import { LotCard } from "./lot-card";

/** Um lance com a URL da casa preenchida (casada pelo nome) para agrupar por casa. */
export type BidCard = {
  id: string;
  idPeca: string;
  idLeilao: string;
  base: string;
  lote: string;
  title: string;
  myBid: string;
  status: string;
  url: string;
  image: string | null;
  date: string;
  house: string;
  houseUrl: string;
  time?: string;
  uf: string;
  watched: boolean;
};

/**
 * Renderiza os lances agrupados por casa de leilão, com o mesmo layout dos vigiados:
 * cada casa vira uma seção com os cartões dos lotes onde você deu lance.
 */
export function BidHouseSections({
  houses,
  pending,
  loteById,
  priceById,
  nextBidById,
  albumById,
  soldById,
  ownedFor,
  onOpenOwned,
  onToggle,
  isHouseOpen,
  onToggleHouse,
  onCloseAll,
}: {
  houses: { house: string; houseUrl: string; lots: BidCard[] }[];
  pending: string | null;
  loteById: Map<string, string>;
  priceById: Map<string, string>;
  nextBidById: Map<string, string>;
  albumById?: Map<string, string>;
  soldById?: Map<string, string>;
  ownedFor?: (lot: { id: string }) => OwnedHit | null;
  onOpenOwned?: (bid: { id: string; title: string }) => void;
  onToggle: (bid: { idPeca: string; idLeilao: string; base: string; watch: boolean }) => void;
  /** Casas iniciam abertas; se ausente, todas ficam sempre abertas (sem recolher). */
  isHouseOpen?: (house: string) => boolean;
  onToggleHouse?: (house: string) => void;
  onCloseAll?: () => void;
}) {
  return (
    <div className="space-y-8">
      {onCloseAll && houses.length > 1 ? (
        <button
          type="button"
          onClick={onCloseAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          Fechar todas
        </button>
      ) : null}
      {houses.map((houseGroup) => {
        const isOpen = isHouseOpen ? isHouseOpen(houseGroup.house) : true;
        return (
          <section key={houseGroup.house} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
              {onToggleHouse ? (
                <button
                  type="button"
                  onClick={() => onToggleHouse(houseGroup.house)}
                  aria-expanded={isOpen}
                  className="flex items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {houseGroup.house}
                  </span>
                </button>
              ) : (
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {houseGroup.house}
                </h2>
              )}
              <Badge variant="secondary">{houseGroup.lots.length} lance(s)</Badge>
              <BidStatBadges stats={computeBidStats(houseGroup.lots)} />
              {houseGroup.houseUrl && houseGroup.houseUrl !== "#" ? (
                <a
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  href={
                    (houseGroup.lots[0] && catalogUrlFromLot(houseGroup.lots[0])) ??
                    houseGroup.houseUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  site da casa <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            {isOpen ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {houseGroup.lots.map((bid) => (
                  <LotCard
                    key={bid.id}
                    lot={{
                      title: bid.title,
                      url: bid.url,
                      image: bid.image,
                      // Valor atual não vem na página de lances — casado por id com a varredura.
                      price: priceById.get(bid.id) ?? "",
                      nextBid: nextBidById.get(bid.id),
                      time: "",
                      house: bid.house,
                      uf: bid.uf,
                      dayKey: bid.date,
                      watched: bid.watched,
                      lote: bid.lote || loteById.get(bid.idPeca) || "",
                      myBid: bid.myBid,
                    }}
                    busy={pending === bid.idPeca}
                    bidStatus={bid.status}
                    sold={soldById?.get(bid.id)}
                    album={albumById?.get(bid.id) ?? null}
                    owned={ownedFor?.(bid) ?? null}
                    onOpenOwned={
                      onOpenOwned ? () => onOpenOwned({ id: bid.id, title: bid.title }) : undefined
                    }
                    onToggle={() =>
                      onToggle({
                        idPeca: bid.idPeca,
                        idLeilao: bid.idLeilao,
                        base: bid.base,
                        watch: !bid.watched,
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

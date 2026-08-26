import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";

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
  onToggle,
}: {
  houses: { house: string; houseUrl: string; lots: BidCard[] }[];
  pending: string | null;
  loteById: Map<string, string>;
  priceById: Map<string, string>;
  nextBidById: Map<string, string>;
  onToggle: (bid: { idPeca: string; idLeilao: string; base: string; watch: boolean }) => void;
}) {
  return (
    <div className="space-y-8">
      {houses.map((houseGroup) => (
        <section key={houseGroup.house} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {houseGroup.house}
            </h2>
            <Badge variant="secondary">{houseGroup.lots.length} lance(s)</Badge>
            <BidStatBadges stats={computeBidStats(houseGroup.lots)} />
            {houseGroup.houseUrl && houseGroup.houseUrl !== "#" ? (
              <a
                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                href={houseGroup.houseUrl}
                target="_blank"
                rel="noreferrer"
              >
                site da casa <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
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
                  nextBid: nextBidById.get(bid.idPeca),
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
        </section>
      ))}
    </div>
  );
}

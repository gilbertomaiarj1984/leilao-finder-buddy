import { ChevronDown, ChevronRight, ChevronUp, ExternalLink } from "lucide-react";

import { HouseLight } from "@/components/vinyl/house-light";
import { HouseUf } from "@/components/vinyl/house-uf";
import { Badge } from "@/components/ui/badge";

import type { Condition } from "@/lib/grading";
import { catalogUrlFromLot } from "@/lib/vinyl-parse";
import type { OwnedHit } from "@/lib/wantlist-match";

import type { LotAi, LotMarket } from "./ai-score-utils";
import { BidStatBadges } from "./badges";
import { computeBidStats, splitByAuction } from "./grouping";
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
  aiFor,
  marketFor,
  conditionFor,
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
  /** Nota da IA, mercado (Discogs) e estado do lote do lance — iguais aos dos cartões das outras abas. */
  aiFor?: (lot: { id: string; title?: string }) => LotAi | undefined;
  marketFor?: (lot: { id: string; uf?: string; title?: string }) => LotMarket | undefined;
  conditionFor?: (lot: { id?: string; title?: string }) => Condition;
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
        // Casa com lances em mais de um pregão: um bloco "Catálogo N" por pregão.
        const auctions = splitByAuction(houseGroup.lots);
        const multi = auctions.length > 1;
        const renderCard = (bid: BidCard) => (
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
            ai={aiFor?.(bid)}
            market={marketFor?.(bid)}
            condition={conditionFor?.(bid)}
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
        );
        return (
          <section
            key={houseGroup.house}
            data-house-nav={houseGroup.house}
            className="scroll-mt-32 space-y-3"
          >
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
              <HouseUf house={houseGroup.house} />
              <HouseLight house={houseGroup.house} />
              <Badge variant="secondary">{houseGroup.lots.length} lance(s)</Badge>
              {multi ? <Badge variant="outline">{auctions.length} catálogos</Badge> : null}
              <BidStatBadges stats={computeBidStats(houseGroup.lots)} />
              {houseGroup.houseUrl && houseGroup.houseUrl !== "#" ? (
                <a
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  href={
                    multi
                      ? houseGroup.houseUrl
                      : ((houseGroup.lots[0] && catalogUrlFromLot(houseGroup.lots[0])) ??
                        houseGroup.houseUrl)
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  site da casa <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            {!isOpen ? null : multi ? (
              <div className="space-y-6 border-l-2 border-border pl-3 sm:pl-5">
                {auctions.map((auction) => {
                  // A chave do bloco reaproveita `isHouseOpen`/`onToggleHouse` (quem chama a
                  // interpola na própria chave de recolher).
                  const catKey = `${houseGroup.house}|${auction.idLeilao}`;
                  const catOpen = isHouseOpen ? isHouseOpen(catKey) : true;
                  const catalogUrl =
                    (auction.lots[0] && catalogUrlFromLot(auction.lots[0])) ?? houseGroup.houseUrl;
                  return (
                    <div key={auction.idLeilao} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {onToggleHouse ? (
                          <button
                            type="button"
                            onClick={() => onToggleHouse(catKey)}
                            aria-expanded={catOpen}
                            className="flex items-center gap-2 text-left"
                          >
                            {catOpen ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="text-base font-semibold text-foreground">
                              Catálogo {auction.idLeilao}
                            </span>
                          </button>
                        ) : (
                          <span className="text-base font-semibold text-foreground">
                            Catálogo {auction.idLeilao}
                          </span>
                        )}
                        <Badge variant="secondary">{auction.lots.length} lance(s)</Badge>
                        <BidStatBadges stats={computeBidStats(auction.lots)} />
                        {catalogUrl && catalogUrl !== "#" ? (
                          <a
                            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            href={catalogUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ver catálogo <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                      {catOpen ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {auction.lots.map(renderCard)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {houseGroup.lots.map(renderCard)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

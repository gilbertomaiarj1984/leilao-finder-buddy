import { ExternalLink } from "lucide-react";

import type { HouseAuctionInfo } from "@/components/vinyl/grouping";
import { HouseLotListButton } from "@/components/vinyl/house-lot-list";
import { PresencialLink } from "@/components/vinyl/presencial-link";

import type { DashboardData } from "./use-dashboard-data";

/**
 * Grupo de ações do lado direito do cabeçalho de uma casa/pregão: "lista" (texto para copiar),
 * link do pregão presencial e "site da casa"/"ver catálogo". Um ponto só para o Dia, os
 * catálogos (`AuctionSection`), Vigiados e "Lotes sem lance".
 */
export function AuctionHeaderActions({
  d,
  house,
  houseUrl,
  info,
  lots,
  noBidIds,
  linkLabel = "site da casa",
}: {
  d: DashboardData;
  house: string;
  houseUrl: string;
  info: HouseAuctionInfo | null;
  lots: Parameters<typeof HouseLotListButton>[0]["lots"];
  noBidIds?: ReadonlySet<string> | null;
  linkLabel?: string;
}) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3">
      <HouseLotListButton d={d} house={house} lots={lots} noBidIds={noBidIds} />
      {info?.presencialUrl ? (
        <PresencialLink
          presencialUrl={info.presencialUrl}
          idLeilao={info.idLeilao}
          dayKey={info.dayKey}
          status={info.status}
        />
      ) : null}
      <a
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        href={info?.catalogUrl ?? houseUrl}
        target="_blank"
        rel="noreferrer"
      >
        {linkLabel} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

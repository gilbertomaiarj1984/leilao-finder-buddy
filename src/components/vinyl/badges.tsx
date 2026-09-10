import { Clock, Eye, Trophy } from "lucide-react";

import type { AuctionStatus, BidStats, HouseAuctionInfo, HouseStats } from "./grouping";

const AUCTION_STATUS_LABEL: Record<AuctionStatus, string> = {
  upcoming: "Em breve",
  live: "Ao vivo agora",
  ended: "Encerrado",
};

const AUCTION_STATUS_CLASS: Record<AuctionStatus, string> = {
  upcoming: "bg-secondary text-muted-foreground",
  live: "bg-primary/15 text-primary",
  ended: "bg-muted text-muted-foreground",
};

/** Horário do leilão + status (em breve/ao vivo/encerrado), ao lado do nome da casa. */
export function AuctionStatusInline({ info }: { info: HouseAuctionInfo | null }) {
  if (!info?.time) return null;
  return (
    <span
      title="Horário do pregão presencial desta casa"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Clock className="h-3.5 w-3.5" />
      {info.time}
      {info.status ? (
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${AUCTION_STATUS_CLASS[info.status]}`}
        >
          {info.status === "live" ? (
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
          ) : null}
          {AUCTION_STATUS_LABEL[info.status]}
        </span>
      ) : null}
    </span>
  );
}

/** Contadores ao lado do nome da casa: vigia, lance verde e lance vermelho. */
export function HouseStatBadges({ stats }: { stats: HouseStats }) {
  return (
    <>
      {stats.vigia > 0 ? (
        <span
          title="Lotes vigiados"
          className="inline-flex items-center gap-1 rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400"
        >
          <Eye className="h-3 w-3" />
          {stats.vigia}
        </span>
      ) : null}
      {stats.green > 0 ? (
        <span
          title="Lotes com lance ganhando (verde)"
          className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
        >
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
          {stats.green}
        </span>
      ) : null}
      {stats.red > 0 ? (
        <span
          title="Lotes com lance coberto (vermelho)"
          className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
        >
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
          {stats.red}
        </span>
      ) : null}
    </>
  );
}

/** Contadores de lances ao lado do nome da casa: vencendo, vencedor, coberto e perdido. */
export function BidStatBadges({ stats }: { stats: BidStats }) {
  return (
    <>
      {stats.winning > 0 ? (
        <span
          title="Lances vencendo (ganhando agora)"
          className="inline-flex items-center gap-1 rounded bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
        >
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
          {stats.winning}
        </span>
      ) : null}
      {stats.won > 0 ? (
        <span
          title="Lances vencedores (leilão já encerrado)"
          className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
        >
          <Trophy className="h-3 w-3" />
          {stats.won}
        </span>
      ) : null}
      {stats.covered > 0 ? (
        <span
          title="Lances cobertos (alguém cobriu o seu lance)"
          className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
        >
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
          {stats.covered}
        </span>
      ) : null}
      {stats.lost > 0 ? (
        <span
          title="Lances não vendidos / encerrados sem arremate"
          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
        >
          <span className="h-2 w-2 rounded-full bg-muted-foreground/60" aria-hidden />
          {stats.lost}
        </span>
      ) : null}
    </>
  );
}

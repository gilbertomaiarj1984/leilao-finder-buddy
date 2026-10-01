import { Clock, Eye, Trophy } from "lucide-react";
import type { ReactNode } from "react";

import type { AuctionStatus, BidStats, HouseAuctionInfo, HouseStats } from "./grouping";
import { LiveLotNow } from "./live-lot-now";

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

/**
 * Horário do leilão + status (em breve/ao vivo/encerrado), ao lado do nome da casa. Ao vivo,
 * mostra também o lote em pregão agora (`LiveLotNow`).
 */
export function AuctionStatusInline({ info }: { info: HouseAuctionInfo | null }) {
  if (!info?.time) return null;
  return (
    <>
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
      {info.status === "live" && info.presencialUrl ? (
        <LiveLotNow url={info.presencialUrl} />
      ) : null}
    </>
  );
}

const HOUSE_STAT_BADGES: {
  key: keyof HouseStats;
  title: string;
  className: string;
  icon: ReactNode;
}[] = [
  {
    key: "vigia",
    title: "Lotes vigiados",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    icon: <Eye className="h-3 w-3" />,
  },
  {
    key: "green",
    title: "Lotes com lance ganhando (verde)",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
    icon: <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />,
  },
  {
    key: "red",
    title: "Lotes com lance coberto (vermelho)",
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
    icon: <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />,
  },
];

/**
 * Contadores ao lado do nome da casa: vigia, lance verde e lance vermelho. Com `onToggle`
 * viram botões de filtro (`active` = os filtros marcados, destacados com anel; vários ao mesmo tempo).
 */
export function HouseStatBadges({
  stats,
  active,
  onToggle,
}: {
  stats: HouseStats;
  active?: ReadonlySet<keyof HouseStats>;
  onToggle?: (key: keyof HouseStats) => void;
}) {
  return (
    <>
      {HOUSE_STAT_BADGES.map(({ key, title, className, icon }) => {
        if (stats[key] <= 0) return null;
        const base = `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${className}`;
        if (!onToggle) {
          return (
            <span key={key} title={title} className={base}>
              {icon}
              {stats[key]}
            </span>
          );
        }
        const on = active?.has(key) ?? false;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={on}
            title={`${title} — ${on ? "clique para limpar o filtro" : "clique para filtrar"}`}
            className={`${base} cursor-pointer transition-shadow hover:ring-1 hover:ring-current ${
              on ? "ring-2 ring-current" : ""
            }`}
          >
            {icon}
            {stats[key]}
          </button>
        );
      })}
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

import { Eye, Trophy } from "lucide-react";

import type { BidStats, HouseStats } from "./grouping";

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

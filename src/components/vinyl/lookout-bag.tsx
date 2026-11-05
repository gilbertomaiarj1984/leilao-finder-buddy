import { Binoculars, ShoppingBag } from "lucide-react";

import { lookoutLabel, type LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";

/** "2026-11-08" → "08/11". */
function shortDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return m && d ? `${d}/${m}` : dayKey;
}

/**
 * Sacola do artista (v0.187.0): TUDO que aparecer dele em leilões futuros, antes dos álbuns de
 * olho. O lote que também casa com um álbum de olho aparece aqui com o selo "também em álbum: X".
 * Clicar abre o lote (o mesmo diálogo dos lotes "por vir").
 */
export function LookoutBag({
  artist,
  lots,
  items,
  watchedIds,
  onOpenLot,
}: {
  artist: string;
  lots: readonly LookoutUpcoming[];
  items: readonly LookoutItem[];
  watchedIds: ReadonlySet<string>;
  onOpenLot: (lot: LookoutUpcoming) => void;
}) {
  const itemById = new Map(items.map((i) => [i.id, i]));
  return (
    <section
      aria-label={`Sacola de ${artist}`}
      className="space-y-1.5 rounded-lg border border-primary/60 bg-primary/5 p-2"
    >
      <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
        <ShoppingBag className="h-4 w-4 text-primary" />
        Sacola · tudo de {artist}
        <span className="text-xs font-normal text-muted-foreground">
          ({lots.length} lote{lots.length === 1 ? "" : "s"})
        </span>
      </h3>
      {lots.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum lote por vir deste artista agora.</p>
      ) : (
        <ul className="space-y-1">
          {lots.map((m) => {
            const album = m.inAlbum ? itemById.get(m.itemId) : undefined;
            return (
              <li key={m.lotId}>
                <button
                  type="button"
                  onClick={() => onOpenLot(m)}
                  className="flex w-full min-w-0 items-center gap-2 rounded border border-border bg-card px-2 py-1.5 text-left hover:bg-accent/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-foreground">
                      {m.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {m.house} · {shortDay(m.dayKey)}
                      {m.time ? ` ${m.time}` : ""}
                      {m.lote ? ` · lote ${m.lote}` : ""}
                      {watchedIds.has(m.idPeca) ? " · vigiado" : ""}
                    </span>
                    {album ? (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded border border-emerald-500/70 px-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <Binoculars className="h-3 w-3" />
                        também em álbum: {lookoutLabel(album)}
                      </span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                    {m.price}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

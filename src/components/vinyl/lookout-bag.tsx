import { Binoculars, ExternalLink, Eye, ShoppingBag } from "lucide-react";
import { useState } from "react";

import { dealLabel, dealTone } from "@/components/vinyl/ai-score-utils";
import { Button } from "@/components/ui/button";
import { lookoutLabel, type LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";
import { lotOpenUrl } from "@/lib/vinyl-parse";

/** Quantos lotes aparecem antes de "Mostrar todos" (a sacola de um artista pode ser longa). */
const BAG_PAGE = 30;

function brl(n: number | null | undefined): string {
  return n == null ? "—" : `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/** "2026-11-08" → "08/11". */
function shortDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return m && d ? `${d}/${m}` : dayKey;
}

/**
 * Sacola do artista (v0.187.0): TUDO que aparecer dele em leilões futuros, antes dos álbuns de
 * olho. Cada lote usa o mesmo formato das linhas de "Por vir" (foto, título, casa/dia, valor,
 * Discogs, veredicto, Vigiar, abrir). O lote que também casa com um álbum de olho leva o selo
 * "também em álbum: X". Clicar abre o cartão completo do lote.
 */
export function LookoutBag({
  artist,
  lots,
  items,
  watchedIds,
  watchLoading,
  busyWatch,
  onWatch,
  onOpenLot,
}: {
  artist: string;
  lots: readonly LookoutUpcoming[];
  items: readonly LookoutItem[];
  watchedIds: ReadonlySet<string>;
  watchLoading: boolean;
  busyWatch: string | null;
  onWatch: (lot: LookoutUpcoming) => void;
  onOpenLot: (lot: LookoutUpcoming) => void;
}) {
  const [all, setAll] = useState(false);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const shown = all ? lots : lots.slice(0, BAG_PAGE);
  return (
    <section
      aria-label={`Sacola de ${artist}`}
      className="space-y-2 rounded-lg border border-primary/60 bg-primary/5 p-2"
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
        <ul className="space-y-2">
          {shown.map((m) => {
            const album = m.inAlbum ? itemById.get(m.itemId) : undefined;
            const watching = watchedIds.has(m.idPeca);
            return (
              <li
                key={m.lotId}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a")) return;
                  onOpenLot(m);
                }}
                className="flex cursor-pointer flex-wrap items-center gap-3 rounded border border-border bg-background p-2 hover:bg-accent/30"
                title="Clique para abrir o cartão completo do lote"
              >
                {m.image ? (
                  <img
                    src={m.image}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 shrink-0 rounded object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1 text-xs">
                  <p className="line-clamp-2 text-sm text-foreground" title={m.title}>
                    {m.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                    <span>
                      {m.house} · {shortDay(m.dayKey)}
                      {m.time ? ` ${m.time}` : ""}
                      {m.uf ? ` · ${m.uf}` : ""}
                    </span>
                    <span className="font-semibold text-primary">Atual {m.price || "—"}</span>
                    {m.marketLowBr != null ? (
                      <span title="Faixa no mercado BR (Discogs, com frete)">
                        Discogs BR {brl(m.marketLowBr)}
                        {m.marketHighBr != null ? `–${brl(m.marketHighBr)}` : ""}
                      </span>
                    ) : null}
                    {m.marketVerdict !== "indefinido" ? (
                      <span className={`font-medium ${dealTone(m.marketVerdict)}`}>
                        {dealLabel(m.marketVerdict)} vs. mercado
                      </span>
                    ) : null}
                    {m.aiScore != null ? <span>IA {m.aiScore}</span> : null}
                  </p>
                  {album ? (
                    <span className="mt-1 inline-flex items-center gap-1 rounded border border-emerald-500/70 px-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <Binoculars className="h-3 w-3" />
                      também em álbum: {lookoutLabel(album)}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={watching ? "default" : "outline"}
                    onClick={() => onWatch(m)}
                    disabled={watchLoading || busyWatch === m.lotId}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    {watching ? "Vigiando" : "Vigiar"}
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <a
                      href={lotOpenUrl(m.url, m.title, m.lote)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Abrir lote no leiloeiro"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {lots.length > BAG_PAGE ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Mostrar menos" : `Mostrar todos (${lots.length})`}
        </Button>
      ) : null}
    </section>
  );
}

import { useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { houseKey, LEVEL_META, NEGATIVE_TAGS, type HouseSummary } from "@/lib/house-rating";
import { useHouseRatingsQuery } from "@/lib/queries";
import { LevelDot } from "@/components/vinyl/level-dot";
import { cn } from "@/lib/utils";

/**
 * Semáforo da casa (verde/amarelo/laranja/vermelho), ao lado do nome em qualquer tela. Sem
 * avaliação, mostra uma bolinha tracejada. Ao parar o mouse (ou tocar) abre o detalhamento:
 * tags mais marcadas e anotações recentes das compras avaliadas. A avaliação em si é feita
 * por compra, na página Compras.
 */
export function HouseLight({ house, className }: { house: string; className?: string }) {
  const { data } = useHouseRatingsQuery();
  const summary: HouseSummary | undefined = data?.houses[houseKey(house)];
  const level = summary?.level ?? null;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  const tip = level
    ? `${house}: ${LEVEL_META[level].label} (${summary?.rated} compra(s) avaliada(s))`
    : `${house}: sem avaliação`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={(e) => e.stopPropagation()}
          aria-label={tip}
          className={cn("inline-flex shrink-0 items-center rounded-full p-1", className)}
        >
          <LevelDot level={level} className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-1.5rem)] p-3 text-xs"
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <HouseLightDetail house={house} summary={summary} />
      </PopoverContent>
    </Popover>
  );
}

function HouseLightDetail({ house, summary }: { house: string; summary?: HouseSummary }) {
  const level = summary?.level ?? null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <LevelDot level={level} className="h-4 w-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{house}</p>
          <p className="text-muted-foreground">
            {level
              ? `${LEVEL_META[level].label} · ${summary?.rated} compra(s) avaliada(s)`
              : "Sem avaliação"}
          </p>
        </div>
      </div>
      {!level ? (
        <p className="text-muted-foreground">
          Avalie uma compra desta casa na página Compras para ver o detalhamento aqui.
        </p>
      ) : null}
      {summary?.tags.length ? (
        <div className="flex flex-wrap gap-1">
          {summary.tags.map(({ tag, count }) => (
            <span
              key={tag}
              className={cn(
                "rounded-full border px-2 py-0.5",
                (NEGATIVE_TAGS as readonly string[]).includes(tag)
                  ? "border-red-500/50 text-red-400"
                  : "border-green-500/50 text-green-400",
              )}
            >
              {tag}
              {count > 1 ? ` ×${count}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      {summary?.notes.length ? (
        <ul className="space-y-1.5 border-t border-border pt-2">
          {summary.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <LevelDot level={n.level} className="mt-0.5 h-2.5 w-2.5" />
              <div className="min-w-0">
                <p className="text-foreground">{n.note}</p>
                <p className="truncate text-muted-foreground">{n.title}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

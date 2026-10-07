import { useRef, useState, type ComponentProps } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { CollectionCard } from "@/components/vinyl/collection-card";
import { collectionLabel } from "@/components/vinyl/collection-utils";
import type { CollectionItem } from "@/lib/collection.server";

type CardProps = Omit<ComponentProps<typeof CollectionCard>, "item">;

/**
 * Linha da visão "Títulos". Ao parar o mouse (ou tocar, no celular) abre o CARD COMPLETO do
 * disco flutuando ao lado, com Editar/Reprocessar/Remover/tags/tracklist — a linha em si fica
 * enxuta. Ações que abrem outro diálogo (editar, trocar capa) fecham o card antes.
 */
export function CollectionTitleRow({
  item,
  cardProps,
}: {
  item: CollectionItem;
  cardProps: CardProps;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const closeThen = <A extends unknown[]>(fn?: (...a: A) => void) =>
    fn
      ? (...a: A) => {
          setOpen(false);
          fn(...a);
        }
      : undefined;

  const details = [
    item.conditionMedia && `Mídia ${item.conditionMedia}`,
    item.conditionSleeve && `Capa ${item.conditionSleeve}`,
    item.wonPrice && `Pago ${item.wonPrice}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <li
          className="cursor-pointer px-3 py-2 text-sm hover:bg-secondary/60"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={show}
        >
          <p className="truncate text-foreground">{collectionLabel(item)}</p>
          {details ? <p className="truncate text-xs text-muted-foreground">{details}</p> : null}
        </li>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="max-h-[85vh] w-80 overflow-y-auto p-0"
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CollectionCard
          item={item}
          {...cardProps}
          onEdit={closeThen(cardProps.onEdit)}
          onPickCover={closeThen(cardProps.onPickCover)}
        />
      </PopoverContent>
    </Popover>
  );
}

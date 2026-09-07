import { ExternalLink, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CollectionItem } from "@/lib/collection.server";

export function CollectionCard({
  item,
  busy,
  onEdit,
  onRemove,
}: {
  item: CollectionItem;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const artistLine = item.artist || "(sem artista)";
  const albumLine =
    [item.album, item.year ? `(${item.year})` : ""].filter(Boolean).join(" ") ||
    item.title ||
    "(sem álbum)";
  const alt = [item.artist, item.album].filter(Boolean).join(" - ") || item.title || "disco";

  return (
    <article className="relative flex flex-col overflow-hidden rounded-md border border-border bg-card">
      {item.sourceUrl ? (
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="block bg-secondary">
          <CardImage image={item.image} alt={alt} />
        </a>
      ) : (
        <div className="block bg-secondary">
          <CardImage image={item.image} alt={alt} />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          {/* 1ª linha: artista · 2ª linha: álbum + ano */}
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {artistLine}
          </p>
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={albumLine}>
            {albumLine}
          </p>
        </div>

        {item.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {item.wonPrice ? (
            <span className="font-semibold text-primary" title="Valor pago">
              Pago {item.wonPrice}
            </span>
          ) : null}
          {item.conditionMedia ? (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
              title="Estado da mídia"
            >
              Mídia {item.conditionMedia}
            </span>
          ) : null}
          {item.conditionSleeve ? (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
              title="Estado da capa"
            >
              Capa {item.conditionSleeve}
            </span>
          ) : null}
        </div>

        {/* Descritivo do disco (buscado pela IA) */}
        {item.description ? (
          <p className="line-clamp-4 text-xs leading-snug text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {item.notes ? (
          <p className="line-clamp-3 text-xs italic text-muted-foreground/90">{item.notes}</p>
        ) : null}

        <div className="mt-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onEdit} disabled={busy}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRemove}
            disabled={busy}
            aria-label="Remover disco da coleção"
            title="Remover da coleção"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          {item.sourceUrl ? (
            <Button size="sm" variant="ghost" asChild>
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir lote no leiloeiro"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CardImage({ image, alt }: { image: string | null; alt: string }) {
  return image ? (
    <img src={image} alt={alt} loading="lazy" className="h-44 w-full object-contain p-2" />
  ) : (
    <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
      sem imagem
    </div>
  );
}

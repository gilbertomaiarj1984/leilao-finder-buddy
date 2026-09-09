import { ExternalLink, Pencil, RotateCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LotTags } from "@/components/vinyl/ai-score";
import { scoreTone } from "@/components/vinyl/ai-score-utils";
import type { CollectionItem } from "@/lib/collection.server";
import { normalizeGrade, scoreCondition } from "@/lib/grading";

export function CollectionCard({
  item,
  busy,
  reprocessing = false,
  onEdit,
  onRemove,
  onReprocess,
  onTagsChange,
}: {
  item: CollectionItem;
  busy: boolean;
  reprocessing?: boolean;
  // Opcionais: quando ausentes, o botão correspondente não é renderizado (modo
  // somente-leitura — ex.: o card exibido no painel de relação da home).
  onEdit?: () => void;
  onRemove?: () => void;
  onReprocess?: () => void;
  onTagsChange?: (next: string[]) => void;
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

        {/* Tags: preenchidas pela IA, mas editáveis (mesmo padrão dos lotes: × remove, + tag adiciona). */}
        {onTagsChange ? (
          <LotTags tags={item.tags} onEdit={onTagsChange} />
        ) : item.tags.length ? (
          <LotTags tags={item.tags} />
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
          {/* Faixa/Score Final derivados dos graus (Disco × Capa). */}
          {(() => {
            const { score, faixa } = scoreCondition(
              normalizeGrade(item.conditionMedia),
              normalizeGrade(item.conditionSleeve),
            );
            return score !== null && faixa ? (
              <span
                className={`rounded px-1.5 py-0.5 font-semibold ${scoreTone(score)}`}
                title={`Score Final ${score} — ${faixa.full}`}
              >
                {faixa.label} · {score}
              </span>
            ) : null;
          })()}
        </div>

        {/* Descritivo do disco (buscado pela IA) — rolável para ler o texto todo. */}
        {item.description ? (
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap pr-1 text-xs leading-snug text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {item.notes ? (
          <p className="line-clamp-3 text-xs italic text-muted-foreground/90">{item.notes}</p>
        ) : null}

        {onEdit || onRemove || onReprocess || item.sourceUrl ? (
          <div className="mt-auto flex items-center gap-2">
            {onEdit ? (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={onEdit}
                disabled={busy}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            ) : null}
            {onReprocess ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onReprocess}
                disabled={busy || reprocessing}
                aria-label="Reprocessar identificação pela IA"
                title="Reprocessar pela IA (só texto): refaz artista/álbum/ano e o descritivo, sobrescrevendo o atual."
              >
                <RotateCw className={`h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />
              </Button>
            ) : null}
            {onRemove ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRemove}
                disabled={busy || reprocessing}
                aria-label="Remover disco da coleção"
                title="Remover da coleção"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
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
        ) : null}
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

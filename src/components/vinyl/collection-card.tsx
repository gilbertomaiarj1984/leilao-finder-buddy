import { useState } from "react";
import { ExternalLink, ImageIcon, Lightbulb, Pencil, RotateCw, Trash2, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LotTags } from "@/components/vinyl/ai-score";
import { scoreTone } from "@/components/vinyl/ai-score-utils";
import { LotTracklistHover } from "@/components/vinyl/tracklist-hover";
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
  onPickCover,
  onFetchTracklist,
  tracklistLoading = false,
  onMenuOpenChange,
}: {
  item: CollectionItem;
  busy: boolean;
  reprocessing?: boolean;
  // Opcionais: quando ausentes, o botão correspondente não é renderizado (modo
  // somente-leitura — ex.: o card exibido no painel de relação da home).
  onEdit?: () => void;
  onRemove?: () => void;
  // Reprocessa pela IA: "image" = pela capa; "text" = pelo nome do artista e álbum; `hint` = dica
  // livre do usuário (prioridade máxima para a IA, vale nos dois modos).
  onReprocess?: (mode: "image" | "text", hint?: string) => void;
  onTagsChange?: (next: string[]) => void;
  // Clicar na imagem abre o seletor de capa do Discogs (o link do leilão segue no rodapé).
  onPickCover?: () => void;
  // Sem tracklist, o botão fica clicável e busca SÓ a tracklist (IA) para este disco.
  onFetchTracklist?: () => void;
  tracklistLoading?: boolean;
  // Avisa quando o menu do reprocessar abre/fecha (o card flutuante se mantém aberto enquanto isso).
  onMenuOpenChange?: (open: boolean) => void;
}) {
  const artistLine = item.artist || "(sem artista)";
  const albumLine =
    [item.album, item.year ? `(${item.year})` : ""].filter(Boolean).join(" ") ||
    item.title ||
    "(sem álbum)";
  const [reprocessOpen, setReprocessOpenState] = useState(false);
  const [hint, setHint] = useState("");
  const [hintWithImage, setHintWithImage] = useState(true);
  const setReprocessOpen = (o: boolean) => {
    setReprocessOpenState(o);
    onMenuOpenChange?.(o);
  };
  const alt = [item.artist, item.album].filter(Boolean).join(" - ") || item.title || "disco";

  return (
    <article className="relative flex flex-col overflow-hidden rounded-md border border-border bg-card">
      {onPickCover ? (
        <button
          type="button"
          onClick={onPickCover}
          title="Trocar capa (buscar no Discogs)"
          className="block w-full bg-secondary"
        >
          <CardImage image={item.image} alt={alt} />
        </button>
      ) : item.sourceUrl ? (
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="block bg-secondary">
          <CardImage image={item.image} alt={alt} />
        </a>
      ) : (
        <div className="block bg-secondary">
          <CardImage image={item.image} alt={alt} />
        </div>
      )}

      {/* Tracklist própria do disco ou a da avaliação do lote de origem; sem nenhuma, o botão busca. */}
      <div className="absolute right-2 top-2 z-10">
        <LotTracklistHover
          lotId={item.lotId ?? item.originLotId}
          title={alt}
          own={item.tracklist}
          onRequest={onFetchTracklist}
          loading={tracklistLoading}
          refresh={
            item.tracklist?.length && onFetchTracklist
              ? { onClick: onFetchTracklist, pending: tracklistLoading }
              : undefined
          }
        />
      </div>

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
          {/* Mídia/Capa/Faixa/Score, com a regra padrão do app: só um lado conhecido → o
              outro é ESPELHADO com o mesmo grau (nunca fica "só Mídia" ou "só Capa"). */}
          {(() => {
            const { media, sleeve, score, faixa } = scoreCondition(
              normalizeGrade(item.conditionMedia),
              normalizeGrade(item.conditionSleeve),
            );
            return (
              <>
                {media ? (
                  <span
                    className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
                    title="Estado da mídia"
                  >
                    Mídia {media}
                  </span>
                ) : null}
                {sleeve ? (
                  <span
                    className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
                    title="Estado da capa"
                  >
                    Capa {sleeve}
                  </span>
                ) : null}
                {score !== null && faixa ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${scoreTone(score)}`}
                    title={`Score Final ${score} — ${faixa.full}`}
                  >
                    {faixa.label} · {score}
                  </span>
                ) : null}
              </>
            );
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
              <Popover open={reprocessOpen} onOpenChange={setReprocessOpen}>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || reprocessing}
                    aria-label="Reprocessar identificação pela IA"
                    title="Reprocessar pela IA: refaz artista/álbum/ano e o descritivo, sobrescrevendo o atual."
                  >
                    <RotateCw className={`h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  collisionPadding={12}
                  className="w-72 max-w-[calc(100vw-1.5rem)] space-y-1 p-2"
                >
                  <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
                    Atualizar pela IA com base…
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left"
                    disabled={!item.image}
                    title={item.image ? undefined : "Este disco não tem capa"}
                    onClick={() => {
                      setReprocessOpen(false);
                      onReprocess("image");
                    }}
                  >
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    <span>1 · Na imagem da capa</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left"
                    onClick={() => {
                      setReprocessOpen(false);
                      onReprocess("text");
                    }}
                  >
                    <Type className="h-4 w-4 shrink-0" />
                    <span>2 · No nome do artista e do álbum</span>
                  </Button>
                  <div className="space-y-2 border-t border-border px-2 pb-1 pt-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Lightbulb className="h-4 w-4 shrink-0" />3 · Com uma dica minha
                    </p>
                    <textarea
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      rows={3}
                      maxLength={600}
                      placeholder='Ex.: LP de 1979, selo Philips, tem a faixa "Sampa"…'
                      className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    {item.image ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={hintWithImage}
                          onChange={(e) => setHintWithImage(e.target.checked)}
                        />
                        Usar também a capa
                      </label>
                    ) : null}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!hint.trim()}
                      onClick={() => {
                        setReprocessOpen(false);
                        onReprocess(item.image && hintWithImage ? "image" : "text", hint.trim());
                      }}
                    >
                      Identificar com a dica
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
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

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LevelDot } from "@/components/vinyl/level-dot";
import { savePurchaseRating } from "@/lib/house-rating.functions";
import {
  LEVEL_META,
  NEGATIVE_TAGS,
  POSITIVE_TAGS,
  RATING_LEVELS,
  type PurchaseRating,
  type RatingLevel,
} from "@/lib/house-rating";
import { queryKeys } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Avaliação da experiência com UMA compra: semáforo (obrigatório), tags e anotação (opcionais).
 * O semáforo da casa, mostrado em todo o app, é a agregação das compras avaliadas dela.
 */
export function PurchaseRatingDialog({
  open,
  onOpenChange,
  purchaseId,
  house,
  title,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseId: string;
  house: string;
  title: string;
  current: PurchaseRating | undefined;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(savePurchaseRating);
  const [level, setLevel] = useState<RatingLevel | null>(current?.level ?? null);
  const [tags, setTags] = useState<string[]>(current?.tags ?? []);
  const [note, setNote] = useState(current?.note ?? "");

  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      save({ data: { purchaseId, ...(remove || !level ? {} : { level, tags, note }) } }),
    onSuccess: async (_r, remove) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.houseRatings });
      toast.success(remove ? "Avaliação removida" : "Avaliação salva");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar"),
  });

  const toggle = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Avaliar {house || "a casa"}</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATING_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
                title={LEVEL_META[l].hint}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-md border-2 px-2 py-3 text-xs",
                  level === l ? "border-primary bg-secondary" : "border-transparent bg-muted",
                )}
              >
                <LevelDot level={l} className="h-5 w-5" />
                <span className="font-medium text-foreground">{LEVEL_META[l].label}</span>
              </button>
            ))}
          </div>
          {level ? <p className="text-xs text-muted-foreground">{LEVEL_META[level].hint}</p> : null}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Motivos (opcional)</p>
            <div className="flex flex-wrap gap-1.5">
              {POSITIVE_TAGS.map((t) => (
                <TagButton key={t} tag={t} on={tags.includes(t)} kind="pos" onClick={toggle} />
              ))}
              {NEGATIVE_TAGS.map((t) => (
                <TagButton key={t} tag={t} on={tags.includes(t)} kind="neg" onClick={toggle} />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rating-note" className="text-xs text-muted-foreground">
              Anotação (opcional)
            </label>
            <textarea
              id="rating-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: disco veio riscado, sem resposta ao e-mail"
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {current ? (
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(true)}
            >
              Remover avaliação
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={!level || mutation.isPending} onClick={() => mutation.mutate(false)}>
            Salvar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagButton({
  tag,
  on,
  kind,
  onClick,
}: {
  tag: string;
  on: boolean;
  kind: "pos" | "neg";
  onClick: (tag: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onClick(tag)}
      className={cn(
        "rounded-full border px-3 py-1 text-xs",
        kind === "pos" ? "border-green-500/50 text-green-400" : "border-red-500/50 text-red-400",
        on && (kind === "pos" ? "bg-green-500/20" : "bg-red-500/20"),
      )}
    >
      {kind === "pos" ? "+ " : "− "}
      {tag}
    </button>
  );
}

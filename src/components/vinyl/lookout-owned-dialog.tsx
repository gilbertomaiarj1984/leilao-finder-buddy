import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lookoutLabel, type LookoutItem, type LookoutOwnedHit } from "@/lib/lookout-match";

/**
 * Discos de olho que JÁ estão na Coleção: confirma quais marcar como adquiridos (saem da lista
 * ativa e vão para "Arquivados"; as vigias dos lotes deles são removidas, como em "Adquirido").
 */
export function LookoutOwnedDialog({
  open,
  onOpenChange,
  hits,
  items,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hits: readonly LookoutOwnedHit[];
  items: readonly LookoutItem[];
  /** Marca cada item como adquirido (um a um). */
  onConfirm: (itemIds: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // A cada abertura: os casamentos confiantes vêm marcados; os incertos, não.
  useEffect(() => {
    if (open) setPicked(new Set(hits.filter((h) => h.confident).map((h) => h.itemId)));
  }, [open, hits]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm([...picked]);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Discos que você já tem</DialogTitle>
          <DialogDescription>
            Estes discos de olho parecem já estar na sua Coleção. Marque os que quer tirar da lista
            (ficam em &quot;Arquivados&quot; como adquiridos e as vigias deles são removidas).
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {hits.map((h) => {
            const item = items.find((i) => i.id === h.itemId);
            if (!item) return null;
            return (
              <li key={h.itemId}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(h.itemId)}
                    onChange={() => toggle(h.itemId)}
                    disabled={busy}
                  />
                  <span className="min-w-0">
                    <span className="break-words font-medium">{lookoutLabel(item)}</span>
                    <span className="block break-words text-xs text-muted-foreground">
                      Coleção: {lookoutLabel(h.owned)}
                      {h.confident ? "" : " · incerto, confira"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={busy || !picked.size} onClick={() => void confirm()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Tirar {picked.size} da lista
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

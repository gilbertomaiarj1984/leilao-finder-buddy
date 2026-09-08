import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CollectionCard } from "@/components/vinyl/collection-card";
import type { CollectionItem } from "@/lib/collection.server";
import { normalizeForMatch } from "@/lib/vinyl-parse";
import type { OwnedResolution } from "@/lib/wantlist-match";

/**
 * Painel de RELAÇÃO de um lote com a Coleção ("já tenho"). Mostra o card do disco
 * relacionado (quando há), com ações de confirmar / "não tenho" / reativar detecção
 * automática, e um seletor para relacionar/trocar por qualquer disco da Coleção.
 */
export function OwnedPanel({
  open,
  onClose,
  lotTitle,
  resolution,
  relatedItem,
  collection,
  busy,
  onConfirm,
  onReject,
  onReactivate,
  onLink,
}: {
  open: boolean;
  onClose: () => void;
  lotTitle: string;
  resolution: OwnedResolution;
  relatedItem: CollectionItem | null;
  collection: CollectionItem[];
  busy: boolean;
  onConfirm: () => void; // confirmar o disco sugerido/detectado (vira vínculo)
  onReject: () => void; // "não tenho este disco" (fica cinza; alimenta o aprendizado)
  onReactivate: () => void; // voltar ao automático (limpa override + aprendizado do lote)
  onLink: (itemId: string) => void; // relacionar/trocar por um disco escolhido
}) {
  const kind = resolution.kind;
  const statusLabel =
    kind === "linked"
      ? "Confirmado por você"
      : kind === "auto"
        ? `Detectado automaticamente${resolution.kind === "auto" ? ` — ${Math.round(resolution.hit.score * 100)}%` : ""}`
        : kind === "suggested"
          ? "Sugerido pelo aprendizado — confirme se é este"
          : kind === "rejected"
            ? "Você marcou como “não tenho”"
            : "Sem relação com a Coleção";

  const showConfirm = kind === "auto" || kind === "suggested";
  const canReject = relatedItem != null; // só faz sentido negar quando há um disco em questão
  const canReactivate = kind === "linked" || kind === "rejected";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Relação com a Coleção</DialogTitle>
          <DialogDescription className="line-clamp-2">{lotTitle}</DialogDescription>
        </DialogHeader>

        <p className="text-xs font-medium text-muted-foreground">{statusLabel}</p>

        {relatedItem ? (
          <CollectionCard item={relatedItem} busy={busy} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Este lote não está relacionado a nenhum disco da sua Coleção.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {showConfirm ? (
            <Button size="sm" onClick={onConfirm} disabled={busy}>
              Confirmar que é este
            </Button>
          ) : null}
          {canReject ? (
            <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
              Não tenho este disco
            </Button>
          ) : null}
          {canReactivate ? (
            <Button size="sm" variant="ghost" onClick={onReactivate} disabled={busy}>
              Reativar detecção automática
            </Button>
          ) : null}
        </div>

        <CollectionPicker
          collection={collection}
          busy={busy}
          excludeId={relatedItem?.id}
          heading={relatedItem ? "Relacionar a outro disco" : "Relacionar a um disco da Coleção"}
          onPick={onLink}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Busca + lista rolável de discos da Coleção para escolher um a relacionar. */
function CollectionPicker({
  collection,
  busy,
  excludeId,
  heading,
  onPick,
}: {
  collection: CollectionItem[];
  busy: boolean;
  excludeId?: string;
  heading: string;
  onPick: (itemId: string) => void;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const norm = normalizeForMatch(q);
    const base = collection.filter((it) => it.id !== excludeId);
    const list = !norm
      ? base
      : base.filter((it) =>
          normalizeForMatch(`${it.artist} ${it.album} ${it.title}`).includes(norm),
        );
    return list.slice(0, 40);
  }, [collection, q, excludeId]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">{heading}</p>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por artista, álbum ou título…"
      />
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {results.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum disco encontrado.</p>
        ) : (
          results.map((it) => (
            <button
              key={it.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(it.id)}
              className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-2 text-left hover:bg-accent disabled:opacity-50"
            >
              <img
                src={it.image ?? ""}
                alt=""
                loading="lazy"
                className="h-10 w-10 shrink-0 rounded object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {it.artist || "(sem artista)"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[it.album, it.year ? `(${it.year})` : ""].filter(Boolean).join(" ") ||
                    it.title ||
                    "(sem álbum)"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

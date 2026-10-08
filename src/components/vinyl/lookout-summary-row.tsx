import { Binoculars, GripVertical } from "lucide-react";
import { useState } from "react";

import { lookoutLabel, type LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";

/** Tipo de arrastar entre cartões (o mesmo do cartão detalhado). */
const LOOKOUT_DRAG_TYPE = "application/x-lookout-item";

/**
 * Linha-resumo de um disco "de olho" na página `/olho`: clicar abre o cartão detalhado (diálogo)
 * com todas as informações e ações. Arrastar uma linha sobre outra junta os dois álbuns.
 */
export function LookoutSummaryRow({
  item,
  upcoming,
  watchedIds,
  onOpen,
  onMerge,
}: {
  item: LookoutItem;
  upcoming: LookoutUpcoming[];
  watchedIds: ReadonlySet<string>;
  onOpen: () => void;
  onMerge: (sourceId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const archived = item.status !== "active";
  const news = upcoming.filter((m) => m.isNew).length;
  const watching = upcoming.filter((m) => watchedIds.has(m.idPeca)).length;
  const terms = item.terms ?? [];
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!archived}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(LOOKOUT_DRAG_TYPE, item.id);
        e.dataTransfer.setData("text/plain", lookoutLabel(item));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (archived || !e.dataTransfer.types.includes(LOOKOUT_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const sourceId = e.dataTransfer.getData(LOOKOUT_DRAG_TYPE);
        if (archived || !sourceId || sourceId === item.id) return;
        e.preventDefault();
        onMerge(sourceId);
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent/40 ${
        archived ? "border-border opacity-70" : "border-fuchsia-500/60"
      } ${dragOver ? "ring-2 ring-fuchsia-500" : ""}`}
      title="Clique para abrir o cartão detalhado (arraste sobre outro para juntar)"
    >
      {item.image ? (
        <img
          src={item.image}
          alt=""
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-secondary">
          <Binoculars className="h-5 w-5 text-muted-foreground/50" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {lookoutLabel(item) || item.title || "Disco sem identificação"}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {archived ? (
            <span>{item.status === "acquired" ? "Adquirido" : "Desistido"}</span>
          ) : (
            <span>
              {upcoming.length} por vir
              {news ? ` (${news} novo${news === 1 ? "" : "s"})` : ""}
            </span>
          )}
          {watching ? <span>{watching} vigiando</span> : null}
          {item.merged?.length ? <span>+{item.merged.length} juntado(s)</span> : null}
          {terms.length ? <span>palavras: {terms.join(", ")}</span> : null}
          {item.maxPrice != null ? (
            <span>teto R$ {item.maxPrice.toFixed(2).replace(".", ",")}</span>
          ) : null}
        </p>
      </div>
      {!archived ? (
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      ) : null}
    </div>
  );
}

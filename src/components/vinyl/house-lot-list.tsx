import { ClipboardList, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { DashboardData } from "@/components/vinyl/dashboard/use-dashboard-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Condition } from "@/lib/grading";
import {
  formatDayList,
  formatHouseList,
  shortNote,
  splitArtistAlbum,
  type HouseListEntry,
} from "@/lib/house-lot-list";

type ListLot = {
  id: string;
  idPeca: string;
  title: string;
  artist?: string;
  lote?: string;
  price?: string;
};

/** "Disco VG+ · Capa VG · encarte" a partir do estado resolvido; vazio quando desconhecido. */
function conditionText(condition: Condition | null | undefined): string {
  if (!condition) return "";
  const parts = [
    condition.media ? `Disco ${condition.media}` : "",
    condition.sleeve ? `Capa ${condition.sleeve}` : "",
    condition.insert === "sim" ? "com encarte" : condition.insert === "nao" ? "sem encarte" : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Botão "lista" da linha da casa (ao lado de "pregão presencial"): abre uma janela com os lotes
 * que estão na tela (já com o filtro ativo — sem lance / vigiados / lances / artista / valor) em
 * texto pronto para copiar. As entradas são montadas só quando a janela abre.
 */
export function HouseLotListButton({
  d,
  house,
  lots,
  noBidIds,
}: {
  d: DashboardData;
  house: string;
  lots: readonly ListLot[];
  /** `idPeca` dos lotes sem lance quando o filtro "Sem lance" está ligado (consulta ao catálogo). */
  noBidIds?: ReadonlySet<string> | null;
}) {
  const [open, setOpen] = useState(false);
  if (lots.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        title="Lista dos lotes desta casa (com o filtro atual) para copiar"
      >
        <ClipboardList className="h-3 w-3" /> lista
      </button>
      {open ? (
        <HouseLotListDialog
          d={d}
          house={house}
          lots={lots}
          noBidIds={noBidIds}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Entradas do texto a partir dos lotes na tela (IA, estado e preço já resolvidos pelo dashboard). */
function buildEntries(
  d: DashboardData,
  lots: readonly ListLot[],
  noBidIds?: ReadonlySet<string> | null,
): HouseListEntry[] {
  return lots.map((lot) => {
    const ai = d.aiFor(lot);
    const condition = d.conditionFor(lot);
    const { artist, album } = splitArtistAlbum(d.albumFor(lot), lot.artist ?? "", lot.title);
    const price = d.currentPriceFor(lot.id, lot.price ?? "");
    return {
      lote: lot.lote || d.loteById.get(lot.idPeca) || "",
      artist,
      album,
      nextBid: d.nextBidById.get(lot.id) ?? "",
      price,
      noBid: Boolean(noBidIds?.has(lot.idPeca)) || d.demandFor(lot)?.bids === 0,
      condition: conditionText(condition),
      note: shortNote(ai?.reason || condition?.raw || lot.title),
    };
  });
}

type DayExportSection = { house: string; lots: readonly ListLot[] };

/**
 * Botão "Exportar dia" (fim do painel flutuante de casas, só desktop): mesma janela da lista por
 * casa, mas com os lotes de TODAS as casas do dia que estão na tela (filtros já aplicados),
 * separados por casa. As entradas só são montadas quando a janela abre.
 */
export function DayLotListButton({
  d,
  title,
  sections,
  noBidIds,
}: {
  d: DashboardData;
  title: string;
  sections: readonly DayExportSection[];
  noBidIds?: ReadonlySet<string> | null;
}) {
  const [open, setOpen] = useState(false);
  const total = sections.reduce((n, s) => n + s.lots.length, 0);
  if (total === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-primary hover:bg-accent"
        title="Lista de todos os lotes de todas as casas do dia (com o filtro atual) para copiar"
      >
        <ClipboardList className="h-3.5 w-3.5" /> Exportar dia
        <span className="ml-auto tabular-nums text-muted-foreground">{total}</span>
      </button>
      {open ? (
        <DayLotListDialog
          d={d}
          title={title}
          sections={sections}
          noBidIds={noBidIds}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function DayLotListDialog({
  d,
  title,
  sections,
  noBidIds,
  onClose,
}: {
  d: DashboardData;
  title: string;
  sections: readonly DayExportSection[];
  noBidIds?: ReadonlySet<string> | null;
  onClose: () => void;
}) {
  const built = sections.map((s) => ({
    house: s.house,
    entries: buildEntries(d, s.lots, noBidIds),
  }));
  const total = built.reduce((n, s) => n + s.entries.length, 0);
  return (
    <ListDialog
      title={`Exportar dia — ${title}`}
      description={`${total} lote(s) em ${built.length} casa(s), conforme o filtro que está na tela.`}
      text={formatDayList(title, built)}
      onClose={onClose}
    />
  );
}

function HouseLotListDialog({
  d,
  house,
  lots,
  noBidIds,
  onClose,
}: {
  d: DashboardData;
  house: string;
  lots: readonly ListLot[];
  noBidIds?: ReadonlySet<string> | null;
  onClose: () => void;
}) {
  const entries = buildEntries(d, lots, noBidIds);
  return (
    <ListDialog
      title={`Lista — ${house}`}
      description={`${entries.length} lote(s), conforme o filtro que está na tela.`}
      text={formatHouseList(house, entries)}
      onClose={onClose}
    />
  );
}

export function ListDialog({
  title,
  description,
  text,
  onClose,
  copyLabel = "Copiar lista",
}: {
  title: string;
  description: string;
  text: string;
  onClose: () => void;
  copyLabel?: string;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Lista copiada");
    } catch {
      toast.error("Não consegui copiar — selecione o texto e copie manualmente");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          value={text}
          rows={14}
          onFocus={(e) => e.currentTarget.select()}
          className="max-h-[60vh] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
          <Button size="sm" onClick={copy}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> {copyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

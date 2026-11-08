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
  const entries: HouseListEntry[] = lots.map((lot) => {
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
  const text = formatHouseList(house, entries);

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
          <DialogTitle className="text-base">Lista — {house}</DialogTitle>
          <DialogDescription>
            {entries.length} lote(s), conforme o filtro que está na tela.
          </DialogDescription>
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
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar lista
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

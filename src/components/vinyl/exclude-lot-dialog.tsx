import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirmação de exclusão DEFINITIVA de um lote (DELETE físico, sem desfazer — ver
 * src/lib/lot-exclusion.server.ts). Um único diálogo controlado pelo pai (mesmo padrão do
 * `OwnedPanel`): `target` é o lote em questão, `null` fecha.
 */
export function ExcludeLotDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: { id: string; title: string } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={target != null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setReason("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">Excluir lote</DialogTitle>
          <DialogDescription className="line-clamp-2">{target?.title}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Some da listagem e das próximas varreduras — não tem como desfazer. O sistema aprende com
          os termos do título para sinalizar lotes parecidos como "possível lixo" (sem escondê-los
          automaticamente).
        </p>
        <textarea
          placeholder="Motivo (opcional) — ex.: joia, não é vinil, lote de outro tipo…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? "Excluindo…" : "Excluir para sempre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

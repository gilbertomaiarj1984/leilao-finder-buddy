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
          este lote para sinalizar parecidos como "possível lixo" (sem escondê-los automaticamente).
        </p>
        <p className="text-sm text-muted-foreground">
          <strong>O que é o objeto?</strong> Escreva o que torna isto lixo (ex.: "máquina de
          costura", "kit de limpeza") — cada expressão (separe por vírgula) passa a marcar qualquer
          lote que a tenha no título.
        </p>
        <textarea
          placeholder="Ex.: máquina de costura, kit de limpeza (opcional)"
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

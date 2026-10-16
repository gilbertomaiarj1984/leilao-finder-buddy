import { Binoculars } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lookoutLabel, type LookoutItem } from "@/lib/lookout-match";

/**
 * Ao marcar "de olho" um disco de um artista que já tem discos na lista, deixa escolher entre
 * inserir em um deles (os parecidos primeiro) ou criar um disco novo.
 */
export function LookoutAskDialog({
  label,
  candidates,
  onChoose,
  onCancel,
}: {
  /** Rótulo do lote que está sendo marcado, ou null com o diálogo fechado. */
  label: string | null;
  candidates: readonly LookoutItem[];
  onChoose: (choice: "new" | string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={label != null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Binoculars className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />
            Este artista já está de olho
          </DialogTitle>
          <DialogDescription>
            {label ? `"${label}"` : ""} é o mesmo disco de algum destes ou é um disco novo? Inserir
            no existente junta os dois (o De olho reconhece os dois nomes).
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id}>
              <Button
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                onClick={() => onChoose(c.id)}
              >
                Inserir em: {lookoutLabel(c) || c.title}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onChoose("new")}>Criar novo disco</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

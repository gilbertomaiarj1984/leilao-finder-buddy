import { Loader2, Pin, Star } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * «Meus interesses» — parte do perfil do colecionador (De olho + interesses). A lista que o usuário
 * escreve é editável; os artistas dos discos que ele está de olho entram sozinhos (somente leitura)
 * e podem ser «fixados» na lista manual para continuar valendo se o disco sair do De olho.
 */
export function InterestsDialog({
  interests,
  fromLookout,
  onSave,
  saving,
}: {
  /** Lista manual do usuário. */
  interests: string[];
  /** Artistas vindos do De olho que ainda não estão na lista manual. */
  fromLookout: string[];
  onSave: (items: string[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const pin = (name: string) =>
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n${name}` : name));
  const total = interests.length + fromLookout.length;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setText(interests.join("\n"));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Star className="mr-2 h-4 w-4" />
          Meus interesses
          {total ? (
            <Badge variant="secondary" className="ml-2">
              {total}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meus interesses</DialogTitle>
          <DialogDescription>
            Um por linha: artistas, álbuns ou gêneros que você curte. Os lotes que combinam ganham
            destaque (⭐) na nota e entram no perfil que a IA recebe. Os artistas dos discos que
            você está de olho já contam como interesse, sem precisar digitar.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"Ex.:\nRaul Seixas\nJazz\nClube da Esquina\nTim Maia"}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {fromLookout.length ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Do De olho ({fromLookout.length}) — toque para fixar na sua lista
            </p>
            <div className="flex flex-wrap gap-1.5">
              {fromLookout.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => pin(name)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  title="Fixar na lista manual (continua valendo mesmo se o disco sair do De olho)"
                >
                  <Pin className="h-3 w-3" />
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(text.split("\n"));
              setOpen(false);
            }}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

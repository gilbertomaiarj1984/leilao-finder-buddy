// Diálogos da página Análise (interesses e Sondagem).

import { Check, Crosshair, Loader2, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/persisted-state";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeForMatch } from "@/lib/vinyl-parse";
import { parseWantlistText } from "@/lib/wantlist-parse";
import { type WantItem } from "@/lib/queries";

export function InterestsDialog({
  interests,
  onSave,
  saving,
}: {
  interests: string[];
  onSave: (items: string[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
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
          {interests.length ? (
            <Badge variant="secondary" className="ml-2">
              {interests.length}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meus interesses</DialogTitle>
          <DialogDescription>
            Um por linha: artistas, álbuns ou gêneros que você curte. Os lotes que combinam ganham
            destaque (⭐) na nota.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={"Ex.:\nRaul Seixas\nJazz\nClube da Esquina\nTim Maia"}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
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

type EditDraft = { id: string; work: string; year: string; note: string };

/**
 * Diálogo da "sondagem": cola texto para importar, pesquisa, edita, marca o que já adquiri
 * e remove — tudo persistido no banco (`wantlist_items`). Serve de input extra para a
 * análise (os lotes que casam com a lista ganham 🎯).
 */
export function SondagemDialog({
  items,
  loading,
  onImport,
  onAdd,
  onUpdate,
  onDelete,
  busy,
}: {
  items: WantItem[];
  loading: boolean;
  onImport: (text: string) => void;
  onAdd: (v: { work: string; year: number | null; note: string }) => void;
  onUpdate: (v: {
    id: string;
    work?: string;
    year?: number | null;
    note?: string;
    acquired?: boolean;
  }) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [search, setSearch] = usePersistedState("wantlist-search", "");
  const [showAcquired, setShowAcquired] = usePersistedState("wantlist-show-acquired", true);
  const [edit, setEdit] = useState<EditDraft | null>(null);

  const pending = items.filter((i) => !i.acquired).length;
  const previewCount = useMemo(
    () => (importText.trim() ? parseWantlistText(importText).length : 0),
    [importText],
  );

  const visible = useMemo(() => {
    const q = normalizeForMatch(search);
    return items.filter((i) => {
      if (!showAcquired && i.acquired) return false;
      if (q && !normalizeForMatch(`${i.work} ${i.note}`).includes(q)) return false;
      return true;
    });
  }, [items, search, showAcquired]);

  const startEdit = (i: WantItem) =>
    setEdit({ id: i.id, work: i.work, year: i.year?.toString() ?? "", note: i.note });
  const startAdd = () => setEdit({ id: "new", work: "", year: "", note: "" });

  const saveEdit = () => {
    if (!edit) return;
    const work = edit.work.trim();
    if (!work) {
      toast.error("Informe a obra.");
      return;
    }
    const year = edit.year.trim() ? Number(edit.year) || null : null;
    if (edit.id === "new") onAdd({ work, year, note: edit.note.trim() });
    else onUpdate({ id: edit.id, work, year, note: edit.note.trim() });
    setEdit(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setEdit(null);
          setImportText("");
          setSearch("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Crosshair className="mr-2 h-4 w-4" />
          Sondagem
          {pending ? (
            <Badge variant="secondary" className="ml-2">
              {pending}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sondagem — obras que estou caçando</DialogTitle>
          <DialogDescription>
            Cole seu rascunho (uma obra por linha, ex.: <code>01. Tim Maia (1970)</code>). Depois
            pesquise, edite e marque o que já adquiriu. Os lotes que casam com a lista ganham 🎯 na
            análise.
          </DialogDescription>
        </DialogHeader>

        {/* Importar por texto */}
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">
            Importar colando texto
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder={
                "01. Tim Maia (1970)\n02. Tim Maia (1973)\n03. Tim Maia Racional, Vol. 1 (1975 - Fase Cult/Rara)\n[Bônus/Cult: Tim Maia Racional, Vol. 2 (1975)]"
              }
              className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {previewCount ? `${previewCount} obra(s) reconhecida(s)` : "Cole o texto acima"}
              </span>
              <Button
                size="sm"
                disabled={busy || previewCount === 0}
                onClick={() => {
                  onImport(importText);
                  setImportText("");
                }}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Importar {previewCount ? `(${previewCount})` : ""}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Não apaga o que já existe; ignora duplicatas (obra + ano).
            </p>
          </div>
        </details>

        {/* Busca + controles */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar na sondagem…"
            className="h-9 max-w-xs"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showAcquired}
              onChange={(e) => setShowAcquired(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Mostrar adquiridos
          </label>
          <Button variant="outline" size="sm" className="ml-auto" onClick={startAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Adicionar obra
          </Button>
        </div>

        {/* Formulário de edição / novo item */}
        {edit ? (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium text-foreground">
              {edit.id === "new" ? "Nova obra" : "Editar obra"}
            </p>
            <Input
              value={edit.work}
              onChange={(e) => setEdit({ ...edit, work: e.target.value })}
              placeholder="Obra (ex.: Tim Maia Racional, Vol. 1)"
            />
            <div className="flex flex-wrap gap-2">
              <Input
                value={edit.year}
                onChange={(e) => setEdit({ ...edit, year: e.target.value })}
                placeholder="Ano"
                inputMode="numeric"
                className="w-24"
              />
              <Input
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                placeholder="Observação (opcional)"
                className="min-w-[12rem] flex-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>
                <X className="mr-1 h-4 w-4" />
                Cancelar
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Lista */}
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            Nenhuma obra ainda. Importe seu rascunho acima ou adicione manualmente.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Nada encontrado com esses filtros.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {visible.map((i) => (
              <li key={i.id} className="flex items-start gap-2 p-2.5">
                <input
                  type="checkbox"
                  checked={i.acquired}
                  onChange={(e) => onUpdate({ id: i.id, acquired: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  title="Marcar como adquirido"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      i.acquired
                        ? "text-sm text-muted-foreground line-through"
                        : "text-sm font-medium text-foreground"
                    }
                  >
                    {i.work}
                    {i.year ? <span className="text-muted-foreground"> ({i.year})</span> : null}
                  </p>
                  {i.note ? <p className="text-xs text-muted-foreground">{i.note}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(i)}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(i.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

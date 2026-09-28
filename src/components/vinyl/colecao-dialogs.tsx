// Diálogos da página Coleção (importação em massa e edição de disco).

import { Camera, Copy } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GradeSelect } from "@/components/vinyl/grade-select";
import { GEMINI_IMPORT_PROMPT, parseCollectionBulkText } from "@/lib/collection-bulk";
import { Draft } from "@/components/vinyl/colecao-draft";

export function BulkImportDialog({
  open,
  importing,
  onImport,
  onClose,
}: {
  open: boolean;
  importing: boolean;
  onImport: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseCollectionBulkText(text), [text]);
  const preview = parsed.items.slice(0, 12);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(GEMINI_IMPORT_PROMPT);
      toast.success("Prompt copiado. Cole na IA junto com sua lista de discos.");
    } catch {
      toast.error("Não foi possível copiar automaticamente — selecione e copie o texto.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setText("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar em massa</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Peça a uma IA (ex.: Gemini) para gerar a lista dos seus discos e cole o resultado abaixo.
          Copie o prompt pronto, cole na IA com sua lista/fotos, e traga o JSON de volta para cá.
        </p>

        <details className="rounded-md border border-border">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground">
            <span>Prompt para a IA (Gemini)</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                void copyPrompt();
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar prompt
            </Button>
          </summary>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-border p-3 text-xs text-muted-foreground">
            {GEMINI_IMPORT_PROMPT}
          </pre>
        </details>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            '[\n  {"artista":"Tim Maia","album":"Racional","ano":1975,"midia":"VG+","capa":"VG"},\n  {"artista":"Elis Regina","album":"Elis & Tom","ano":1974}\n]\n\nou, uma linha por disco:\nTim Maia - Racional (1975)'
          }
          className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="text-xs text-muted-foreground">
          {parsed.error ? (
            <span className="text-destructive">{parsed.error}</span>
          ) : parsed.items.length ? (
            `${parsed.items.length} disco(s) reconhecido(s)`
          ) : (
            "Cole o JSON (ou uma linha por disco) acima."
          )}
        </div>

        {preview.length ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-card/40 p-2 text-xs">
            {preview.map((d, i) => (
              <li key={i} className="truncate text-foreground">
                {[d.artist, d.album].filter(Boolean).join(" — ") || d.title || "(sem nome)"}
                {d.year ? <span className="text-muted-foreground"> ({d.year})</span> : null}
              </li>
            ))}
            {parsed.items.length > preview.length ? (
              <li className="text-muted-foreground">
                …e mais {parsed.items.length - preview.length}.
              </li>
            ) : null}
          </ul>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onImport(text)}
            disabled={importing || parsed.items.length === 0}
          >
            {importing
              ? "Importando…"
              : `Importar${parsed.items.length ? ` (${parsed.items.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function EditDialog({
  draft,
  saving,
  artistNames,
  onChange,
  onClose,
  onSave,
  onUpload,
}: {
  draft: Draft | null;
  saving: boolean;
  artistNames: string[];
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
  onUpload: (file: File) => Promise<string>;
}) {
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => draft && onChange({ ...draft, ...patch });

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await onUpload(file);
      set({ image: url });
      toast.success("Foto enviada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar a foto");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Editar disco" : "Adicionar disco"}</DialogTitle>
        </DialogHeader>
        {draft ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Foto (capa)">
                <div className="flex items-center gap-3">
                  {draft.image ? (
                    <img
                      src={draft.image}
                      alt=""
                      className="h-20 w-20 shrink-0 rounded bg-secondary object-contain"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-secondary text-[11px] text-muted-foreground">
                      sem foto
                    </div>
                  )}
                  <div className="flex flex-col items-start gap-1">
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploading || saving}
                      onChange={handleFile}
                      className="text-xs file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:text-foreground"
                    />
                    {/* Câmera do celular: abre direto para bater a foto do disco. No desktop o
                        `capture` é ignorado e cai no seletor de arquivo — inofensivo. */}
                    <input
                      ref={cameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={uploading || saving}
                      onChange={handleFile}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => cameraRef.current?.click()}
                      disabled={uploading || saving}
                    >
                      <Camera className="mr-2 h-4 w-4" />
                      Tirar foto
                    </Button>
                    {uploading ? (
                      <span className="text-xs text-muted-foreground">Enviando…</span>
                    ) : draft.image ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => set({ image: null })}
                        disabled={saving}
                      >
                        Remover foto
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Field>
            </div>
            <Field label="Artista">
              <Input
                list="collection-artist-options"
                value={draft.artist}
                placeholder="Selecione um artista ou escreva um novo"
                onChange={(e) => set({ artist: e.target.value })}
              />
              <datalist id="collection-artist-options">
                {artistNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Álbum">
              <Input value={draft.album} onChange={(e) => set({ album: e.target.value })} />
            </Field>
            <Field label="Ano">
              <Input
                value={draft.year}
                inputMode="numeric"
                onChange={(e) => set({ year: e.target.value })}
              />
            </Field>
            <Field label="Estado da mídia">
              <GradeSelect
                value={draft.conditionMedia}
                onChange={(v) => set({ conditionMedia: v })}
                ariaLabel="Estado da mídia"
              />
            </Field>
            <Field label="Estado da capa">
              <GradeSelect
                value={draft.conditionSleeve}
                onChange={(v) => set({ conditionSleeve: v })}
                ariaLabel="Estado da capa"
              />
            </Field>
            <Field label="Valor pago">
              <Input
                value={draft.wonPrice}
                placeholder="R$ 0,00"
                onChange={(e) => set({ wonPrice: e.target.value })}
              />
            </Field>
            <Field label="Data do arremate">
              <Input
                type="date"
                value={draft.wonDate}
                onChange={(e) => set({ wonDate: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Tags (separadas por vírgula)">
                <Input
                  value={draft.tags}
                  placeholder="MPB, prioridade, raro"
                  onChange={(e) => set({ tags: e.target.value })}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Descritivo do disco (preenchido pela IA — editável)">
                <textarea
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={3}
                  placeholder="Descrição do disco (artista, estilo, época, relevância)…"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Notas">
                <textarea
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </Field>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

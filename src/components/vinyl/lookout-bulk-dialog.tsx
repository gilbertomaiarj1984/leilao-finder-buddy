import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOOKOUT_BULK_MAX, parseLookoutBulk } from "@/lib/lookout-bulk";
import { lookoutLabel } from "@/lib/lookout-match";
import { addLookoutByText } from "@/lib/lookout.functions";

type LineResult = {
  raw: string;
  state: "pending" | "running" | "added" | "existing" | "unresolved" | "error";
  label?: string;
  detail?: string;
};

/**
 * Cria vários "de olho" de uma vez a partir de uma lista colada/enviada (.txt/.csv) ou de um
 * nome digitado: a IA resolve artista/álbum/ano linha a linha (numeração opcional).
 */
export function LookoutBulkDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado a cada item criado e ao final (para recarregar a lista). */
  onDone: () => void;
}) {
  const run = useServerFn(addLookoutByText);
  const [text, setText] = useState("");
  const [results, setResults] = useState<LineResult[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const entries = parseLookoutBulk(text);

  const patch = (i: number, p: Partial<LineResult>) =>
    setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const start = async () => {
    if (!entries.length || busy) return;
    setBusy(true);
    setResults(entries.map((e) => ({ raw: e.raw, state: "pending" })));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      patch(i, { state: "running" });
      try {
        const r = await run({ data: { text: e.text, year: e.year } });
        if (r.status === "unresolved") {
          patch(i, { state: "unresolved", detail: r.reason });
        } else {
          patch(i, { state: r.status, label: lookoutLabel(r.item) });
          onDone();
        }
      } catch (error) {
        const msg = (error as Error)?.message || "falha";
        patch(i, { state: "error", detail: msg });
        // Sem chave de IA / quota: não adianta insistir nas demais linhas.
        if (/IA não está configurada/i.test(msg)) break;
      }
    }
    setBusy(false);
    onDone();
  };

  const added = results.filter((r) => r.state === "added").length;
  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Adicionar à lista De olho</DialogTitle>
          <DialogDescription>
            Cole ou envie uma lista (uma obra por linha) ou digite um artista / álbum. A IA
            identifica artista e álbum de cada linha, um a um, e cria o &quot;de olho&quot; — sem
            precisar achar o disco num leilão. Numeração e ano são opcionais. Ex.:{" "}
            <em>Abbey Road (1969) - The Beatles</em>
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={8}
          placeholder={
            "01. The Dark Side of the Moon (1973) - Pink Floyd\nAbbey Road - The Beatles\nTim Maia Racional Vol. 1"
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Lista de discos"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,.md,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void f.text().then((t) => setText((prev) => (prev ? `${prev}\n${t}` : t)));
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Enviar arquivo
          </Button>
          <span className="text-xs text-muted-foreground">
            {entries.length} linha(s){entries.length >= LOOKOUT_BULK_MAX ? " (limite)" : ""} · gasta
            créditos de IA
          </span>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={busy || !entries.length}
            onClick={() => void start()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Identificar e ficar de olho
          </Button>
        </div>
        {results.length ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {added} adicionado(s) de {results.length}
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {results.map((r, i) => (
                <li key={`${i}-${r.raw}`} className="flex items-start gap-2">
                  {r.state === "added" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : r.state === "existing" ? (
                    <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : r.state === "unresolved" || r.state === "error" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : r.state === "running" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <span className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="break-words">{r.label ?? r.raw}</span>
                    {r.state === "existing" ? (
                      <span className="text-muted-foreground"> · já estava na lista</span>
                    ) : null}
                    {r.detail ? <span className="text-muted-foreground"> · {r.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

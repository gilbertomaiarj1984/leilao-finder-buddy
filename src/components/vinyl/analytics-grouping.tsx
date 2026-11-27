// Piloto: "Agrupar álbuns (IA)" por artista. A IA só PROPÕE os grupos; nada é gravado até o
// usuário aceitar (mesmo mecanismo de apelidos de álbum da curadoria manual, que sempre vence).
import { useState } from "react";

import { useServerFn } from "@tanstack/react-start";
import { Combine, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type ArtistAgg } from "@/lib/analytics";
import { proposeAlbumGrouping } from "@/lib/analytics.functions";
import type { AlbumGroup } from "@/lib/album-grouping";

type Proposal = { groups: AlbumGroup[]; provider: string; model: string; skipped: number };

export function AlbumGroupingButton({
  artist,
  onApplyAlbum,
}: {
  artist: ArtistAgg;
  onApplyAlbum: (keys: string[], name: string) => void;
}) {
  const propose = useServerFn(proposeAlbumGrouping);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const byKey = new Map(artist.albums.map((a) => [a.key, a]));

  const run = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy || artist.albums.length < 2) return;
    setBusy(true);
    try {
      const res = await propose({
        data: {
          artist: artist.artist,
          albums: artist.albums.map((a) => ({
            key: a.key,
            name: a.album,
            count: a.count,
            sample: a.sales[0]?.title,
          })),
        },
      });
      setProposal(res);
      // Pré-seleciona só os grupos sem aviso.
      setPicked(new Set(res.groups.flatMap((g, i) => (g.warnings.length ? [] : [i]))));
      setOpen(true);
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível pedir o agrupamento à IA");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const apply = () => {
    if (!proposal) return;
    let n = 0;
    proposal.groups.forEach((g, i) => {
      if (!picked.has(i)) return;
      const rawKeys = g.keys.flatMap((k) => byKey.get(k)?.sourceKeys ?? []);
      if (!rawKeys.length) return;
      onApplyAlbum(
        [...new Set(rawKeys)].map((k) => `${artist.key}|${k}`),
        g.name,
      );
      n += 1;
    });
    setOpen(false);
    if (n) toast.success(`${n} grupo(s) de álbuns aplicado(s)`);
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy || artist.albums.length < 2}
        title="Agrupar álbuns repetidos deste artista com a IA (você confere antes de salvar)"
        aria-label="Agrupar álbuns com IA"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Combine className="h-4 w-4" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agrupar álbuns de {artist.artist}</DialogTitle>
          </DialogHeader>
          {proposal && proposal.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              A IA não achou álbuns repetidos para juntar com segurança.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Marque os grupos que são o MESMO disco. Os que têm aviso vêm desmarcados. Nada é
                salvo até clicar em Aplicar; dá para desfazer pelo lápis do álbum.
              </p>
              {proposal?.groups.map((g, i) => (
                <label
                  key={g.keys.join("|")}
                  className="flex cursor-pointer gap-2 rounded border border-border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    onChange={() => toggle(i)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="font-semibold text-foreground">{g.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {g.keys
                        .map((k) => {
                          const a = byKey.get(k);
                          return a ? `${a.album} (${a.count})` : k;
                        })
                        .join(" · ")}
                    </span>
                    {g.warnings.map((w) => (
                      <span key={w} className="block text-xs text-amber-600">
                        ⚠ {w}
                      </span>
                    ))}
                  </span>
                </label>
              ))}
              {proposal?.skipped ? (
                <p className="text-xs text-muted-foreground">
                  {proposal.skipped} álbum(ns) com poucas vendas ficaram de fora desta rodada.
                </p>
              ) : null}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {proposal?.model ? `IA: ${proposal.provider} · ${proposal.model}` : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Fechar
              </Button>
              {proposal?.groups.length ? (
                <Button onClick={apply} disabled={picked.size === 0}>
                  Aplicar {picked.size} grupo(s)
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

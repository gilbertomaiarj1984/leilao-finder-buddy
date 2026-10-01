// Seletor de capa: busca releases no Discogs e deixa o usuário escolher a melhor imagem.

import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { importCollectionCover, searchCollectionCovers } from "@/lib/collection.functions";
import type { CoverOption } from "@/lib/discogs.server";

export function CoverPickerDialog({
  open,
  artist,
  album,
  onClose,
  onPick,
}: {
  open: boolean;
  artist: string;
  album: string;
  onClose: () => void;
  /** Recebe a URL já importada (arquivo local da coleção) da capa escolhida. */
  onPick: (url: string) => void | Promise<void>;
}) {
  const search = useServerFn(searchCollectionCovers);
  const importCover = useServerFn(importCollectionCover);
  const [qArtist, setQArtist] = useState(artist);
  const [qAlbum, setQAlbum] = useState(album);
  const [options, setOptions] = useState<CoverOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  async function runSearch(a: string, t: string) {
    setSearching(true);
    try {
      setOptions((await search({ data: { artist: a, album: t } })) as CoverOption[]);
    } catch (e) {
      setOptions([]);
      toast.error(e instanceof Error ? e.message : "Falha ao buscar no Discogs");
    } finally {
      setSearching(false);
    }
  }

  // A cada abertura: pré-preenche com artista/álbum atuais e já busca.
  useEffect(() => {
    if (!open) return;
    setQArtist(artist);
    setQAlbum(album);
    setOptions(null);
    if (artist.trim() || album.trim()) void runSearch(artist, album);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function pick(opt: CoverOption) {
    setPicking(opt.cover);
    try {
      const res = (await importCover({ data: { url: opt.cover } })) as { url: string };
      await onPick(res.url);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível usar esta capa");
    } finally {
      setPicking(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Escolher capa (Discogs)</DialogTitle>
          <DialogDescription>Clique na capa que melhor representa o disco.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(qArtist, qAlbum);
          }}
        >
          <Input
            value={qArtist}
            placeholder="Artista"
            onChange={(e) => setQArtist(e.target.value)}
          />
          <Input value={qAlbum} placeholder="Álbum" onChange={(e) => setQAlbum(e.target.value)} />
          <Button type="submit" size="sm" disabled={searching || picking !== null}>
            <Search className="mr-2 h-4 w-4" />
            Buscar
          </Button>
        </form>
        {searching ? (
          <p className="text-sm text-muted-foreground">Buscando…</p>
        ) : options && options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada encontrado. Ajuste artista/álbum e busque de novo.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {(options ?? []).map((opt) => (
              <button
                key={opt.cover}
                type="button"
                disabled={picking !== null}
                onClick={() => void pick(opt)}
                className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-1 text-left text-[11px] hover:border-primary disabled:opacity-60"
              >
                <img
                  src={opt.thumb}
                  alt={opt.title}
                  loading="lazy"
                  className="aspect-square w-full object-contain"
                />
                <span className="line-clamp-2 leading-tight text-foreground">
                  {picking === opt.cover ? "Importando…" : opt.title}
                </span>
                {opt.year ? <span className="text-muted-foreground">{opt.year}</span> : null}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

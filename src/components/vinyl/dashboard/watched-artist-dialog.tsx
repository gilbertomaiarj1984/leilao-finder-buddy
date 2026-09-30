import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeForMatch } from "@/lib/vinyl-parse";

type ArtistChoice = { key: string; artist: string; sourceKeys: string[]; lots: number };

/**
 * Corrigir o nome de um artista nos Vigiados: renomear e/ou juntar com outros artistas da lista.
 * Usa os mesmos apelidos do Analytics (`analytics_artist_aliases`), então a correção vale nas
 * duas telas. Montado só quando aberto (estado inicial vem das props).
 */
export function WatchedArtistDialog({
  artist,
  all,
  hasAlias,
  onClose,
  onApply,
  onClear,
}: {
  artist: ArtistChoice;
  all: ArtistChoice[];
  hasAlias: boolean;
  onClose: () => void;
  onApply: (sourceKeys: string[], name: string) => void;
  onClear: (sourceKeys: string[]) => void;
}) {
  const [name, setName] = useState(artist.artist);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filterNorm = normalizeForMatch(filter);
  const candidates = useMemo(
    () =>
      all
        .filter((a) => a.key !== artist.key)
        .filter((a) => !filterNorm || normalizeForMatch(a.artist).includes(filterNorm)),
    [all, artist.key, filterNorm],
  );
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const save = () => {
    const target = name.trim() || artist.artist;
    const merged = all.filter((a) => selected.has(a.key));
    const sourceKeys = [...new Set([...artist.sourceKeys, ...merged.flatMap((a) => a.sourceKeys)])];
    onApply(sourceKeys, target);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrigir artista</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Nome do artista</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Juntar com outros artistas (os lotes passam a aparecer neste grupo)
            </span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar artista para juntar…"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum artista encontrado.</p>
              ) : (
                candidates.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggle(a.key)}
                      aria-pressed={on}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                        on ? "bg-secondary" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex-1 truncate text-foreground">{a.artist}</span>
                      <span className="text-xs text-muted-foreground">{a.lots} lote(s)</span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A correção é lembrada: variações desses nomes caem sempre neste grupo, também nos
              Vigiados futuros e no Analytics.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {hasAlias ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClear(artist.sourceKeys);
                  onClose();
                }}
                title="Voltar ao agrupamento automático"
              >
                Desfazer correção
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeForMatch } from "@/lib/vinyl-parse";

type ArtistChoice = { key: string; artist: string; sourceKeys: string[]; lots: number };

/** Lista de artistas com busca e escolha ÚNICA (o destino do que está sendo movido). */
function ArtistPicker({
  options,
  selected,
  onSelect,
}: {
  options: ArtistChoice[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const filterNorm = normalizeForMatch(filter);
  const shown = useMemo(
    () => options.filter((a) => !filterNorm || normalizeForMatch(a.artist).includes(filterNorm)),
    [options, filterNorm],
  );
  return (
    <div className="flex flex-col gap-2">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Buscar artista de destino…"
      />
      <div className="max-h-56 overflow-y-auto rounded border border-border">
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Nenhum artista encontrado.</p>
        ) : (
          shown.map((a) => {
            const on = selected === a.key;
            return (
              <button
                key={a.key}
                type="button"
                onClick={() => onSelect(on ? null : a.key)}
                aria-pressed={on}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                  on ? "bg-secondary" : ""
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
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
    </div>
  );
}

/**
 * Corrigir um artista nos Vigiados. Escolher um destino LEVA este artista para o selecionado
 * (vale o nome do destino); sem destino, só renomeia. Usa os mesmos apelidos do Analytics
 * (`analytics_artist_aliases`), então a correção vale nas duas telas.
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
  const [target, setTarget] = useState<string | null>(null);
  const options = useMemo(() => all.filter((a) => a.key !== artist.key), [all, artist.key]);
  const targetChoice = options.find((a) => a.key === target);
  const save = () => {
    onApply(artist.sourceKeys, targetChoice ? targetChoice.artist : name.trim() || artist.artist);
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
            <span className="text-muted-foreground">Renomear</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!targetChoice}
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Ou levar «{artist.artist}» para outro artista (passa a usar o nome dele)
            </span>
            <ArtistPicker options={options} selected={target} onSelect={setTarget} />
            <p className="text-xs text-muted-foreground">
              A correção é lembrada: variações desse nome caem sempre no artista escolhido, também
              nos Vigiados futuros e no Analytics.
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
                {targetChoice ? `Levar para ${targetChoice.artist}` : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mover um álbum para outro artista. O destino vem da lista ou é digitado (artista que ainda não
 * aparece nos Vigiados). Grava a correção por lote (mesmo mecanismo das vendas do Analytics).
 */
export function WatchedAlbumDialog({
  album,
  fromArtist,
  all,
  moved,
  onClose,
  onMove,
  onUndo,
}: {
  album: string;
  fromArtist: ArtistChoice;
  all: ArtistChoice[];
  /** Algum lote do álbum já tem correção manual → mostra "Desfazer". */
  moved: boolean;
  onClose: () => void;
  onMove: (artistName: string) => void;
  onUndo: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const options = useMemo(() => all.filter((a) => a.key !== fromArtist.key), [all, fromArtist.key]);
  const targetChoice = options.find((a) => a.key === target);
  const finalName = targetChoice ? targetChoice.artist : typed.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mover álbum para outro artista</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-foreground">
            «{album}» <span className="text-muted-foreground">(hoje em {fromArtist.artist})</span>
          </p>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">Artista de destino</span>
            <ArtistPicker
              options={options}
              selected={target}
              onSelect={(k) => {
                setTarget(k);
                if (k) setTyped("");
              }}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Ou digite o nome do artista</span>
            <Input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (e.target.value) setTarget(null);
              }}
              placeholder="Artista que ainda não está na lista"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {moved ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onUndo();
                  onClose();
                }}
                title="Voltar ao artista identificado automaticamente"
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
              <Button
                size="sm"
                disabled={!finalName}
                onClick={() => {
                  onMove(finalName);
                  onClose();
                }}
              >
                Mover
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmação do arrastar-e-soltar (evita mesclar sem querer). */
export function ConfirmMoveDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-foreground">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" onClick={onConfirm}>
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

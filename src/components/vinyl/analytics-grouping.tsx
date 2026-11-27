// "Agrupar álbuns (IA)": a IA olha os títulos E as capas dos álbuns de um artista (ou de vários,
// na varredura) e SINALIZA quais parecem ser o mesmo disco; o usuário confere e só então juntamos
// (apelidos de álbum, o mesmo mecanismo da curadoria manual, que sempre vence e se desfaz pelo
// lápis do álbum). Nada é gravado antes do clique em "Juntar".
import { useRef, useState } from "react";

import { useServerFn } from "@tanstack/react-start";
import { Combine, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type ArtistAgg } from "@/lib/analytics";
import { proposeAlbumGrouping } from "@/lib/analytics.functions";
import type { AlbumGroup } from "@/lib/album-grouping";

type Proposal = {
  groups: AlbumGroup[];
  provider: string;
  model: string;
  skipped: number;
  usedCovers: boolean;
};

/** Um grupo aceito: chaves já no escopo do artista (`artistKey|albumSourceKey`) + nome final. */
export type AlbumMergeItem = { keys: string[]; name: string };

function albumsPayload(artist: ArtistAgg) {
  return artist.albums.map((a) => ({
    key: a.key,
    name: a.album,
    count: a.count,
    sample: a.sales[0]?.title,
    // Primeira venda do álbum que tenha miniatura da capa.
    image: a.sales.find((s) => s.image)?.image ?? null,
  }));
}

function toMergeItems(artist: ArtistAgg, groups: AlbumGroup[]): AlbumMergeItem[] {
  const byKey = new Map(artist.albums.map((a) => [a.key, a]));
  return groups.flatMap((g) => {
    const raw = g.keys.flatMap((k) => byKey.get(k)?.sourceKeys ?? []);
    return raw.length
      ? [{ keys: [...new Set(raw)].map((k) => `${artist.key}|${k}`), name: g.name }]
      : [];
  });
}

/** Pré-seleciona só os de confiança alta e sem aviso. */
function defaultPicked(groups: AlbumGroup[]): Set<number> {
  return new Set(
    groups.flatMap((g, i) => (g.confidence === "alta" && !g.warnings.length ? [i] : [])),
  );
}

function GroupList({
  artist,
  groups,
  picked,
  onToggle,
}: {
  artist: ArtistAgg;
  groups: AlbumGroup[];
  picked: Set<number>;
  onToggle: (i: number) => void;
}) {
  const byKey = new Map(artist.albums.map((a) => [a.key, a]));
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => (
        <label
          key={g.keys.join("|")}
          className="flex cursor-pointer gap-2 rounded border border-border p-2 text-sm"
        >
          <input
            type="checkbox"
            checked={picked.has(i)}
            onChange={() => onToggle(i)}
            className="mt-1"
          />
          <span className="flex-1">
            <span className="font-semibold text-foreground">{g.name}</span>
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                g.confidence === "alta"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {g.confidence === "alta" ? "provável igual" : "conferir"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {g.keys
                .map((k) => {
                  const a = byKey.get(k);
                  return a ? `${a.album} (${a.count})` : k;
                })
                .join(" · ")}
            </span>
            {g.reason ? (
              <span className="block text-xs italic text-muted-foreground">{g.reason}</span>
            ) : null}
            {g.warnings.map((w) => (
              <span key={w} className="block text-xs text-amber-600">
                ⚠ {w}
              </span>
            ))}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Botão no cabeçalho do artista: agrupa os álbuns daquele artista. */
export function AlbumGroupingButton({
  artist,
  onApplyBatch,
}: {
  artist: ArtistAgg;
  onApplyBatch: (items: AlbumMergeItem[]) => void;
}) {
  const propose = useServerFn(proposeAlbumGrouping);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const run = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy || artist.albums.length < 2) return;
    setBusy(true);
    try {
      const res = await propose({ data: { artist: artist.artist, albums: albumsPayload(artist) } });
      setProposal(res);
      setPicked(defaultPicked(res.groups));
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
    onApplyBatch(
      toMergeItems(
        artist,
        proposal.groups.filter((_, i) => picked.has(i)),
      ),
    );
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy || artist.albums.length < 2}
        title="Agrupar álbuns repetidos deste artista (IA olha títulos e capas; você confere antes de juntar)"
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
          ) : proposal ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Marque os grupos que são o MESMO disco. Só os &quot;prováveis iguais&quot; (título e
                capa concordam) vêm marcados. Nada é salvo até clicar em Juntar.
              </p>
              <GroupList
                artist={artist}
                groups={proposal.groups}
                picked={picked}
                onToggle={toggle}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {proposal?.model
                ? `IA: ${proposal.provider} · ${proposal.model}${proposal.usedCovers ? " · com capas" : " · só títulos"}`
                : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Fechar
              </Button>
              {proposal?.groups.length ? (
                <Button onClick={apply} disabled={picked.size === 0}>
                  Juntar {picked.size} grupo(s)
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ScanEntry = {
  artist: ArtistAgg;
  proposal: Proposal | null;
  error?: string;
  picked: Set<number>;
};

/** Varredura ampla: roda vários artistas em sequência e junta tudo numa lista de revisão. */
export function AlbumGroupingScan({
  artists,
  onApplyBatch,
}: {
  artists: ArtistAgg[];
  onApplyBatch: (items: AlbumMergeItem[]) => void;
}) {
  const propose = useServerFn(proposeAlbumGrouping);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState("30");
  const [useCovers, setUseCovers] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const stopRef = useRef(false);

  // Candidatos: artistas reais com 2+ álbuns, os com mais álbuns primeiro (onde mais há repetição).
  const candidates = artists
    .filter((a) => a.albums.length >= 2 && a.albums.some((al) => al.count > 0))
    .sort((a, b) => b.albums.length - a.albums.length);

  const start = async () => {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 300);
    const todo = candidates.filter((a) => !entries.some((e) => e.artist.key === a.key)).slice(0, n);
    if (!todo.length) {
      toast.info("Nenhum artista novo para varrer");
      return;
    }
    stopRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: todo.length });
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        if (stopRef.current) return;
        const artist = todo[cursor];
        cursor += 1;
        if (!artist) return;
        let entry: ScanEntry;
        try {
          const proposal = await propose({
            data: { artist: artist.artist, albums: albumsPayload(artist), useCovers },
          });
          entry = { artist, proposal, picked: defaultPicked(proposal.groups) };
        } catch (error) {
          entry = {
            artist,
            proposal: null,
            error: (error as Error)?.message || "falha",
            picked: new Set(),
          };
        }
        done += 1;
        setProgress({ done, total: todo.length });
        setEntries((prev) => [...prev, entry]);
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
  };

  const toggle = (artistKey: string, i: number) =>
    setEntries((prev) =>
      prev.map((e) => {
        if (e.artist.key !== artistKey) return e;
        const picked = new Set(e.picked);
        if (picked.has(i)) picked.delete(i);
        else picked.add(i);
        return { ...e, picked };
      }),
    );

  const withGroups = entries.filter((e) => e.proposal?.groups.length);
  const totalPicked = withGroups.reduce((n, e) => n + e.picked.size, 0);

  const apply = () => {
    const items = withGroups.flatMap((e) =>
      toMergeItems(
        e.artist,
        e.proposal!.groups.filter((_, i) => e.picked.has(i)),
      ),
    );
    if (!items.length) return;
    onApplyBatch(items);
    // Já aplicado: tira da lista para não aplicar duas vezes.
    setEntries((prev) => prev.filter((e) => !withGroups.includes(e)));
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="A IA varre vários artistas olhando títulos e capas, sinaliza os álbuns que parecem ser o mesmo disco e você junta"
      >
        <Combine className="mr-2 h-4 w-4" />
        Agrupar álbuns (IA)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agrupar álbuns repetidos (varredura)</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Quantos artistas (os com mais álbuns primeiro)
              </span>
              <Input
                type="number"
                min={1}
                max={300}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-28"
                disabled={running}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useCovers}
                onChange={(e) => setUseCovers(e.target.checked)}
                disabled={running}
              />
              <span>Olhar as capas também</span>
            </label>
            {running ? (
              <Button variant="outline" onClick={() => (stopRef.current = true)}>
                Parar
              </Button>
            ) : (
              <Button onClick={() => void start()} disabled={!candidates.length}>
                Varrer
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {running
                ? `${progress.done}/${progress.total} artistas…`
                : `${candidates.length} artistas com 2+ álbuns`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Nada é salvo durante a varredura. Os grupos &quot;provável igual&quot; (título e capa
            concordam) vêm marcados; os &quot;conferir&quot; vêm desmarcados. Confira e clique em
            Juntar.
          </p>
          <div className="flex flex-col gap-4">
            {entries.map((e) => (
              <div key={e.artist.key} className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {e.artist.artist}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {e.artist.albums.length} álbuns
                    {e.proposal?.usedCovers ? " · capas" : ""}
                  </span>
                </div>
                {e.error ? (
                  <p className="text-xs text-red-600">Falhou: {e.error}</p>
                ) : e.proposal && e.proposal.groups.length ? (
                  <GroupList
                    artist={e.artist}
                    groups={e.proposal.groups}
                    picked={e.picked}
                    onToggle={(i) => toggle(e.artist.key, i)}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Nada repetido encontrado.</p>
                )}
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-background pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button onClick={apply} disabled={totalPicked === 0 || running}>
              Juntar {totalPicked} grupo(s) marcado(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

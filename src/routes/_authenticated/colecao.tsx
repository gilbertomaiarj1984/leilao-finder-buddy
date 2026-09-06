import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Disc3, Library, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectionCard } from "@/components/vinyl/collection-card";
import { collectionLabel } from "@/components/vinyl/collection-utils";
import { ArtistFilter } from "@/components/vinyl/filters";
import type { CollectionItem, PendingWonLot } from "@/lib/collection.server";
import {
  addCollectionItem,
  addWonLot,
  deleteCollectionItem,
  getCollection,
  scanCollection,
  updateCollectionItem,
} from "@/lib/collection.functions";
import { LOTE_LABEL, normalizeForMatch, UNCLASSIFIED_LABEL } from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/colecao")({
  head: () => ({ meta: [{ title: "Coleção — Garimpo de Vinil" }] }),
  component: ColecaoPage,
});

// --- Agrupamento/ordenação por artista (mesma regra da listagem de leilões). ---
function rankArtist(a: string): number {
  if (a === UNCLASSIFIED_LABEL) return 2;
  if (a === LOTE_LABEL) return 1;
  return 0;
}

function artistOptions(items: CollectionItem[]): { artist: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = it.artist || UNCLASSIFIED_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort(
      (a, b) =>
        rankArtist(a.artist) - rankArtist(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
}

type ArtistGroup = { artist: string; items: CollectionItem[] };

function groupByArtist(items: CollectionItem[]): ArtistGroup[] {
  const map = new Map<string, CollectionItem[]>();
  for (const it of items) {
    const key = it.artist || UNCLASSIFIED_LABEL;
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([artist, list]) => ({ artist, items: list }))
    .sort(
      (a, b) =>
        rankArtist(a.artist) - rankArtist(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
}

// --- Formulário de edição/adição ---
type Draft = {
  id: string | null;
  artist: string;
  album: string;
  title: string;
  year: string;
  wonPrice: string;
  wonDate: string;
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  tags: string;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  artist: "",
  album: "",
  title: "",
  year: "",
  wonPrice: "",
  wonDate: "",
  conditionMedia: "",
  conditionSleeve: "",
  notes: "",
  tags: "",
};

function toDraft(item: CollectionItem): Draft {
  return {
    id: item.id,
    artist: item.artist,
    album: item.album,
    title: item.title,
    year: item.year == null ? "" : String(item.year),
    wonPrice: item.wonPrice,
    wonDate: item.wonDate ?? "",
    conditionMedia: item.conditionMedia,
    conditionSleeve: item.conditionSleeve,
    notes: item.notes,
    tags: item.tags.join(", "),
  };
}

function ColecaoPage() {
  const queryClient = useQueryClient();
  const fetchCollection = useServerFn(getCollection);
  const scan = useServerFn(scanCollection);
  const addItem = useServerFn(addCollectionItem);
  const addWon = useServerFn(addWonLot);
  const updateItem = useServerFn(updateCollectionItem);
  const removeItem = useServerFn(deleteCollectionItem);

  const [artist, setArtist] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<PendingWonLot[]>([]);

  const query = useQuery<CollectionItem[]>({
    queryKey: ["collection"] as const,
    queryFn: () => fetchCollection() as Promise<CollectionItem[]>,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(() => query.data ?? [], [query.data]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["collection"] });

  const scanMut = useMutation({
    mutationFn: () => scan(),
    onSuccess: (res: { added: number; scanned: number; duplicates: PendingWonLot[] }) => {
      void invalidate();
      if (res.duplicates.length) setReview(res.duplicates);
      const dup = res.duplicates.length
        ? ` ${res.duplicates.length} possível(is) duplicado(s) para revisar.`
        : "";
      toast.success(
        res.added > 0
          ? `${res.added} disco(s) adicionado(s).${dup}`
          : res.duplicates.length
            ? `Nenhum novo automático.${dup}`
            : "Coleção já está em dia — nada novo para adicionar.",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao varrer as compras"),
  });

  const addWonMut = useMutation({
    mutationFn: (p: PendingWonLot) => addWon({ data: p }),
    onSuccess: (_res, p) => {
      void invalidate();
      setReview((list) => list.filter((d) => d.lotId !== p.lotId));
      toast.success("Disco adicionado.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível adicionar"),
  });

  const ignoreDuplicate = (lotId: string) =>
    setReview((list) => list.filter((d) => d.lotId !== lotId));

  const saveMut = useMutation({
    mutationFn: (d: Draft) => {
      const payload = {
        artist: d.artist,
        album: d.album,
        title: d.title,
        year: d.year.trim() ? Number(d.year) || null : null,
        wonPrice: d.wonPrice,
        wonDate: d.wonDate.trim() || null,
        conditionMedia: d.conditionMedia,
        conditionSleeve: d.conditionSleeve,
        notes: d.notes,
        tags: d.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      return d.id ? updateItem({ data: { id: d.id, ...payload } }) : addItem({ data: payload });
    },
    onSuccess: () => {
      void invalidate();
      setDraft(null);
      toast.success("Coleção atualizada.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeItem({ data: { id } }),
    onSuccess: () => {
      void invalidate();
      toast.success("Disco removido da coleção.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível remover"),
  });

  const artists = useMemo(() => artistOptions(items), [items]);

  const filtered = useMemo(() => {
    const searchNorm = normalizeForMatch(search);
    return items.filter((it) => {
      if (artist && (it.artist || UNCLASSIFIED_LABEL) !== artist) return false;
      if (!searchNorm) return true;
      return normalizeForMatch(`${it.artist} ${it.album} ${it.title}`).includes(searchNorm);
    });
  }, [items, artist, search]);

  const groups = useMemo(() => groupByArtist(filtered), [filtered]);
  const busy = saveMut.isPending || removeMut.isPending;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6">
          <div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Link>
              </Button>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                <Library className="h-5 w-5 text-primary" />
                Coleção
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Seus vinis, agrupados por artista. A varredura de "Minhas compras" acrescenta os lotes
              de vinil arrematados; cada disco é editável.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
              title="Adicionar um disco manualmente"
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar disco
            </Button>
            <Button
              size="sm"
              onClick={() => scanMut.mutate()}
              disabled={scanMut.isPending}
              title="Varrer 'Minhas compras' (leilões vencidos) e atualizar a coleção"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${scanMut.isPending ? "animate-spin" : ""}`} />
              {scanMut.isPending ? "Atualizando…" : "Atualizar coleção"}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ArtistFilter artists={artists} value={artist} onChange={setArtist} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por artista ou título…"
            className="w-full sm:w-72"
          />
          <span className="text-xs text-muted-foreground">
            {filtered.length} de {items.length} disco(s)
          </span>
        </div>

        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState onScan={() => scanMut.mutate()} scanning={scanMut.isPending} />
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center text-sm text-muted-foreground">
            Nenhum disco corresponde ao filtro.
          </p>
        ) : (
          <Tabs defaultValue="cards">
            <TabsList className="mb-4">
              <TabsTrigger value="cards">Cards</TabsTrigger>
              <TabsTrigger value="titles">Títulos</TabsTrigger>
            </TabsList>

            <TabsContent value="cards">
              <div className="space-y-8">
                {groups.map((group) => (
                  <section key={group.artist}>
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Disc3 className="h-4 w-4 text-primary" />
                      {group.artist}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({group.items.length})
                      </span>
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <CollectionCard
                          key={item.id}
                          item={item}
                          busy={busy}
                          onEdit={() => setDraft(toDraft(item))}
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="titles">
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.artist}>
                    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Disc3 className="h-4 w-4 text-primary" />
                      {group.artist}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({group.items.length})
                      </span>
                    </h2>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {group.items.map((item) => (
                        <TitleRow
                          key={item.id}
                          item={item}
                          busy={busy}
                          onEdit={() => setDraft(toDraft(item))}
                          onRemove={() => removeMut.mutate(item.id)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <EditDialog
        draft={draft}
        saving={saveMut.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={() => draft && saveMut.mutate(draft)}
      />

      <ReviewDialog
        items={review}
        busy={addWonMut.isPending}
        onAdd={(p) => addWonMut.mutate(p)}
        onIgnore={ignoreDuplicate}
        onClose={() => setReview([])}
      />
    </main>
  );
}

function ReviewDialog({
  items,
  busy,
  onAdd,
  onIgnore,
  onClose,
}: {
  items: PendingWonLot[];
  busy: boolean;
  onAdd: (p: PendingWonLot) => void;
  onIgnore: (lotId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={items.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Possíveis duplicados</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Estes vinis arrematados parecem já estar na coleção. Se for uma segunda cópia proposital,
          adicione mesmo assim; senão, ignore.
        </p>
        <ul className="space-y-3">
          {items.map((p) => (
            <li
              key={p.lotId}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              {p.image ? (
                <img
                  src={p.image}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded object-contain"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded bg-secondary" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium text-foreground">
                  {[p.artist, p.album].filter(Boolean).join(" — ") || p.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Já na coleção: {p.existing}
                </p>
                {p.wonPrice ? (
                  <p className="text-xs text-muted-foreground">Pago {p.wonPrice}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" onClick={() => onAdd(p)} disabled={busy}>
                  Adicionar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onIgnore(p.lotId)} disabled={busy}>
                  Ignorar
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TitleRow({
  item,
  busy,
  onEdit,
  onRemove,
}: {
  item: CollectionItem;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const details = [
    item.conditionMedia && `Mídia ${item.conditionMedia}`,
    item.conditionSleeve && `Capa ${item.conditionSleeve}`,
    item.wonPrice && `Pago ${item.wonPrice}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{collectionLabel(item)}</p>
        {details ? <p className="truncate text-xs text-muted-foreground">{details}</p> : null}
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy} aria-label="Editar disco">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRemove}
        disabled={busy}
        aria-label="Remover disco"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center">
      <Library className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium text-foreground">Sua coleção está vazia.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Clique em "Atualizar coleção" para varrer os leilões que você venceu, ou adicione um disco
        manualmente.
      </p>
      <Button size="sm" className="mt-4" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Atualizando…" : "Atualizar coleção"}
      </Button>
    </div>
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

function EditDialog({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft | null;
  saving: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<Draft>) => draft && onChange({ ...draft, ...patch });
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
            <Field label="Artista">
              <Input value={draft.artist} onChange={(e) => set({ artist: e.target.value })} />
            </Field>
            <Field label="Álbum">
              <Input value={draft.album} onChange={(e) => set({ album: e.target.value })} />
            </Field>
            <Field label="Título original (do lote)">
              <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Ano">
              <Input
                value={draft.year}
                inputMode="numeric"
                onChange={(e) => set({ year: e.target.value })}
              />
            </Field>
            <Field label="Estado da mídia">
              <Input
                value={draft.conditionMedia}
                placeholder="ex.: VG+, NM"
                onChange={(e) => set({ conditionMedia: e.target.value })}
              />
            </Field>
            <Field label="Estado da capa">
              <Input
                value={draft.conditionSleeve}
                placeholder="ex.: VG, NM"
                onChange={(e) => set({ conditionSleeve: e.target.value })}
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
              <Field label="Notas">
                <textarea
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={3}
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Disc3, Library, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
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
  debugScanCollection,
  deleteCollectionItem,
  getCollection,
  identifyCollection,
  reprocessCollectionItem,
  scanCollection,
  updateCollectionItem,
  uploadCollectionImage,
} from "@/lib/collection.functions";
import {
  COMPILATION_LABEL,
  LOTE_LABEL,
  normalizeForMatch,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/colecao")({
  head: () => ({ meta: [{ title: "Coleção — Garimpo de Vinil" }] }),
  component: ColecaoPage,
});

// --- Agrupamento/ordenação por artista ---
// Ordem: artistas reais → "Coletâneas" → "Lote" → não classificados.
function rankArtist(a: string): number {
  if (a === UNCLASSIFIED_LABEL) return 3;
  if (a === LOTE_LABEL) return 2;
  if (a === COMPILATION_LABEL) return 1;
  return 0;
}

/**
 * Chave de agrupamento por artista: normaliza (sem acento/caixa/pontuação) para GARANTIR que
 * variações do mesmo nome caiam juntas ("Alceu Valença" = "Alceu Valenca"). Vazio → bucket de
 * não classificados. A exibição usa a melhor variação (mais acentuada/completa).
 */
function artistKey(artist: string): string {
  const a = (artist ?? "").trim();
  return a ? normalizeForMatch(a) : "";
}

/** Chave equivalente para o valor do filtro (o rótulo de "não classificados" vira o bucket ""). */
function filterKey(value: string): string {
  if (!value || value === UNCLASSIFIED_LABEL) return "";
  return normalizeForMatch(value);
}

/** Nº de diacríticos, p/ preferir a grafia acentuada ("Valença" > "Valenca") na exibição. */
function accentScore(s: string): number {
  return (s.normalize("NFD").match(/[̀-ͯ]/g) ?? []).length;
}

/** Escolhe a melhor grafia entre as variações de um mesmo artista (mais acentuada, depois mais longa). */
function pickCanonical(names: string[]): string {
  return names
    .filter(Boolean)
    .sort(
      (a, b) =>
        accentScore(b) - accentScore(a) || b.length - a.length || a.localeCompare(b, "pt-BR"),
    )[0]!;
}

function displayName(key: string, variants: string[]): string {
  if (!key) return UNCLASSIFIED_LABEL;
  return pickCanonical(variants) || UNCLASSIFIED_LABEL;
}

function artistOptions(items: CollectionItem[]): { artist: string; count: number }[] {
  const buckets = new Map<string, { count: number; variants: string[] }>();
  for (const it of items) {
    const key = artistKey(it.artist);
    const b = buckets.get(key) ?? { count: 0, variants: [] };
    b.count += 1;
    if (it.artist.trim()) b.variants.push(it.artist);
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({ artist: displayName(key, b.variants), count: b.count }))
    .sort(
      (a, b) =>
        rankArtist(a.artist) - rankArtist(b.artist) || a.artist.localeCompare(b.artist, "pt-BR"),
    );
}

type ArtistGroup = { artist: string; items: CollectionItem[] };

function groupByArtist(items: CollectionItem[]): ArtistGroup[] {
  const map = new Map<string, CollectionItem[]>();
  for (const it of items) {
    const key = artistKey(it.artist);
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      artist: displayName(
        key,
        list.map((i) => i.artist),
      ),
      items: list,
    }))
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
  image: string | null;
  wonPrice: string;
  wonDate: string;
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  description: string;
  tags: string;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  artist: "",
  album: "",
  title: "",
  year: "",
  image: null,
  wonPrice: "",
  wonDate: "",
  conditionMedia: "",
  conditionSleeve: "",
  notes: "",
  description: "",
  tags: "",
};

function toDraft(item: CollectionItem): Draft {
  return {
    id: item.id,
    artist: item.artist,
    album: item.album,
    title: item.title,
    year: item.year == null ? "" : String(item.year),
    image: item.image,
    wonPrice: item.wonPrice,
    wonDate: item.wonDate ?? "",
    conditionMedia: item.conditionMedia,
    conditionSleeve: item.conditionSleeve,
    notes: item.notes,
    description: item.description,
    tags: item.tags.join(", "),
  };
}

function ColecaoPage() {
  const queryClient = useQueryClient();
  const fetchCollection = useServerFn(getCollection);
  const scan = useServerFn(scanCollection);
  const addItem = useServerFn(addCollectionItem);
  const addWon = useServerFn(addWonLot);
  const debugScan = useServerFn(debugScanCollection);
  const identify = useServerFn(identifyCollection);
  const reprocess = useServerFn(reprocessCollectionItem);
  const updateItem = useServerFn(updateCollectionItem);
  const removeItem = useServerFn(deleteCollectionItem);
  const uploadImage = useServerFn(uploadCollectionImage);

  const [artist, setArtist] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<PendingWonLot[]>([]);
  const [debug, setDebug] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);

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
    onSuccess: (res: {
      added: number;
      scanned: number;
      duplicates: PendingWonLot[];
      sources: { stored: number; title: number; none: number };
    }) => {
      void invalidate();
      if (res.duplicates.length) setReview(res.duplicates);
      const dup = res.duplicates.length
        ? ` ${res.duplicates.length} possível(is) duplicado(s) para revisar.`
        : "";
      const src = res.sources
        ? ` (banco ${res.sources.stored} · título ${res.sources.title} · sem artista ${res.sources.none})`
        : "";
      toast.success(
        res.added > 0
          ? `${res.added} disco(s) adicionado(s).${dup}${src}`
          : res.duplicates.length
            ? `Nenhum novo automático.${dup}`
            : "Nada novo. Se você tem compras e nada aparece, clique em Diagnóstico.",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao varrer as compras"),
  });

  // Identifica pela IA (só texto, nunca a capa) em laço pelo cursor até terminar. Define
  // artista/álbum/ano e agrupa coletâneas/lotes. Opt-in (gasta créditos). `onlyUnidentified`
  // (padrão) gasta IA só nos discos ainda sem identificação — uso rotineiro e barato; `false`
  // re-normaliza TODA a coleção (corrige identificações antigas), bem mais caro.
  async function runIdentify(onlyUnidentified = true) {
    setIdentifying(true);
    try {
      let total = 0;
      let offset = 0;
      for (let guard = 0; guard < 500; guard++) {
        const res = (await identify({ data: { offset, max: 12, onlyUnidentified } })) as {
          identified: number;
          processed: number;
          nextOffset: number;
          total: number;
          done: boolean;
        };
        total += res.identified;
        offset = res.nextOffset;
        void invalidate();
        if (res.done || res.processed === 0) break;
      }
      toast.success(
        total > 0 ? `${total} disco(s) atualizado(s) pela IA.` : "Nada para atualizar.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao identificar pela IA");
    } finally {
      setIdentifying(false);
    }
  }

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

  const debugMut = useMutation({
    mutationFn: () => debugScan(),
    onSuccess: (res) => setDebug(JSON.stringify(res, null, 2)),
    onError: (e: Error) => toast.error(e.message || "Falha no diagnóstico"),
  });

  const saveMut = useMutation({
    mutationFn: (d: Draft) => {
      const payload = {
        artist: d.artist,
        album: d.album,
        title: d.title,
        year: d.year.trim() ? Number(d.year) || null : null,
        image: d.image,
        wonPrice: d.wonPrice,
        wonDate: d.wonDate.trim() || null,
        conditionMedia: d.conditionMedia,
        conditionSleeve: d.conditionSleeve,
        notes: d.notes,
        description: d.description,
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

  // Reprocessar UM disco pela IA (só texto), sobrescrevendo o atual. Estado por-id p/ o card girar.
  const reprocessMut = useMutation({
    mutationFn: (id: string) => reprocess({ data: { id } }),
    onSuccess: (res: { updated: boolean }) => {
      void invalidate();
      toast.success(res.updated ? "Disco reprocessado pela IA." : "IA não encontrou nada a mudar.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível reprocessar"),
  });

  const artists = useMemo(() => artistOptions(items), [items]);
  // Nomes para o combo do formulário (artistas reais + "Coletâneas"/"Lote"; sem o rótulo genérico).
  const artistNames = useMemo(
    () => artists.map((a) => a.artist).filter((a) => a !== UNCLASSIFIED_LABEL),
    [artists],
  );

  // Lê o arquivo como data URL e envia ao Storage; devolve a URL pública para gravar em `image`.
  async function handleUpload(file: File): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
      reader.readAsDataURL(file);
    });
    const res = (await uploadImage({ data: { dataUrl } })) as { url: string };
    return res.url;
  }

  const filtered = useMemo(() => {
    const searchNorm = normalizeForMatch(search);
    return items.filter((it) => {
      if (artist && filterKey(artist) !== artistKey(it.artist)) return false;
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
            {items.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runIdentify()}
                disabled={identifying}
                title="Identificar pela IA só os discos ainda sem artista/álbum (só texto, nunca a capa). Barato — pula os já identificados. Para refazer um disco específico, use o botão de reprocessar no card."
              >
                <Sparkles className={`mr-2 h-4 w-4 ${identifying ? "animate-pulse" : ""}`} />
                {identifying ? "Identificando…" : "Identificar novos (IA)"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => debugMut.mutate()}
              disabled={debugMut.isPending}
              title="Diagnosticar a varredura (não grava nada) — mostra o que o servidor lê do site"
            >
              {debugMut.isPending ? "Diagnosticando…" : "Diagnóstico"}
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
        {debug ? (
          <div className="mb-4 rounded-md border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                Diagnóstico da varredura
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDebug(null)}>
                Fechar
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
              {debug}
            </pre>
          </div>
        ) : null}
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
                          reprocessing={
                            reprocessMut.isPending && reprocessMut.variables === item.id
                          }
                          onEdit={() => setDraft(toDraft(item))}
                          onRemove={() => removeMut.mutate(item.id)}
                          onReprocess={() => reprocessMut.mutate(item.id)}
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
        artistNames={artistNames}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={() => draft && saveMut.mutate(draft)}
        onUpload={handleUpload}
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

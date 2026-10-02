import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ClipboardPaste,
  Disc3,
  Library,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollectionCard } from "@/components/vinyl/collection-card";
import { collectionLabel, readFileAsDataUrl } from "@/components/vinyl/collection-utils";
import { ArtistFilter } from "@/components/vinyl/filters";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { AiProviderSelect, GeminiModelSelect } from "@/components/vinyl/ai-provider-controls";
import {
  AI_PROVIDER_SHORT,
  formatFailoverTrail,
  type AiProvider,
  type GeminiModel,
} from "@/lib/ai-provider";
import { setAiProvider, setGeminiModel } from "@/lib/ai.functions";
import type { CollectionItem } from "@/lib/collection.server";
import {
  addCollectionItem,
  deleteCollectionItem,
  identifyCollection,
  importCollectionText,
  reprocessCollectionItem,
  updateCollectionItem,
  uploadCollectionImage,
} from "@/lib/collection.functions";
import {
  COMPILATION_LABEL,
  LOTE_LABEL,
  normalizeForMatch,
  pickCanonical,
  UNCLASSIFIED_LABEL,
} from "@/lib/vinyl-parse";
import {
  useAiProviderQuery,
  useCollectionQuery,
  useGeminiModelQuery,
  queryKeys,
} from "@/lib/queries";
import { CoverPickerDialog } from "@/components/vinyl/cover-picker-dialog";
import { BulkImportDialog, EditDialog } from "@/components/vinyl/colecao-dialogs";
import { Draft, EMPTY_DRAFT, toDraft } from "@/components/vinyl/colecao-draft";

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

function ColecaoPage() {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle`, só no mobile.
  const [barsHidden, setBarsHidden] = useState(false);
  usePersistedScroll("colecao", true);
  const [viewTab, setViewTab] = usePersistedState("colecao-view-tab", "cards");
  const queryClient = useQueryClient();
  const addItem = useServerFn(addCollectionItem);
  const importBulk = useServerFn(importCollectionText);
  const identify = useServerFn(identifyCollection);
  const reprocess = useServerFn(reprocessCollectionItem);
  const runSetAiProvider = useServerFn(setAiProvider);
  const runSetGeminiModel = useServerFn(setGeminiModel);
  const updateItem = useServerFn(updateCollectionItem);
  const removeItem = useServerFn(deleteCollectionItem);
  const uploadImage = useServerFn(uploadCollectionImage);

  const [artist, setArtist] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [coverItem, setCoverItem] = useState<CollectionItem | null>(null);
  const [identifying, setIdentifying] = useState(false);

  const query = useCollectionQuery();

  const items = useMemo(() => query.data ?? [], [query.data]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.collection });

  // Provedor de IA PADRÃO (Claude/Gemini) + diálogo "qual IA usar?" por ação.
  const aiProviderQuery = useAiProviderQuery();
  const aiProvider: AiProvider = aiProviderQuery.data ?? "anthropic";
  const changeAiProvider = (provider: AiProvider) => {
    const prev = aiProviderQuery.data;
    queryClient.setQueryData(queryKeys.aiProvider, provider);
    void runSetAiProvider({ data: { provider } })
      .then(() => toast.success(`Provedor padrão: ${AI_PROVIDER_SHORT[provider]}`))
      .catch((e: unknown) => {
        queryClient.setQueryData(queryKeys.aiProvider, prev);
        toast.error((e as Error)?.message || "Não foi possível salvar o provedor de IA");
      });
  };

  // Modelo do Gemini (Flash-Lite/Flash/Pro). Vale mesmo com Claude escolhido: o failover
  // por falta de créditos pode acabar caindo no Gemini com esse modelo.
  const geminiModelQuery = useGeminiModelQuery();
  const geminiModel: GeminiModel = geminiModelQuery.data ?? "gemini-3.1-flash-lite";
  const changeGeminiModel = (model: GeminiModel) => {
    const prev = geminiModelQuery.data;
    queryClient.setQueryData(queryKeys.geminiModel, model);
    void runSetGeminiModel({ data: { model } })
      .then(() => toast.success(`Modelo do Gemini: ${model}`))
      .catch((e: unknown) => {
        queryClient.setQueryData(queryKeys.geminiModel, prev);
        toast.error((e as Error)?.message || "Não foi possível salvar o modelo do Gemini");
      });
  };
  // Avisa quando houve failover (o provedor pedido ficou sem créditos ou indisponível): mostra
  // o motivo de CADA provedor pulado até o que atendeu, não um "trocou" genérico.
  const notifySwitch = (
    asked: AiProvider,
    res: {
      switched?: boolean;
      served?: AiProvider | null;
      attemptErrors?: Partial<Record<AiProvider, string>>;
    },
  ) => {
    if (res.switched && res.served && res.served !== asked) {
      const trail = formatFailoverTrail(res.attemptErrors ?? {});
      toast.warning(
        trail
          ? `${trail} — usei ${AI_PROVIDER_SHORT[res.served]}`
          : `${AI_PROVIDER_SHORT[asked]} indisponível — usei ${AI_PROVIDER_SHORT[res.served]}`,
      );
    }
  };

  // Identifica pela IA (só texto, nunca a capa) em laço pelo cursor até terminar. Define
  // artista/álbum/ano e agrupa coletâneas/lotes. Opt-in (gasta créditos). `onlyUnidentified`
  // (padrão) gasta IA só nos discos ainda sem identificação — uso rotineiro e barato; `false`
  // re-normaliza TODA a coleção (corrige identificações antigas), bem mais caro.
  async function runIdentify(onlyUnidentified = true) {
    // Usa SEMPRE o provedor selecionado no topo da página (sem perguntar).
    const provider = aiProvider;
    setIdentifying(true);
    try {
      let total = 0;
      let failed = 0;
      let lastError: string | null = null;
      let offset = 0;
      let switchedTo: AiProvider | null = null;
      let attemptErrors: Partial<Record<AiProvider, string>> = {};
      for (let guard = 0; guard < 500; guard++) {
        const res = (await identify({
          data: { offset, max: 12, onlyUnidentified, provider },
        })) as {
          identified: number;
          processed: number;
          nextOffset: number;
          total: number;
          done: boolean;
          served: AiProvider | null;
          switched: boolean;
          failed: number;
          error: string | null;
          attemptErrors?: Partial<Record<AiProvider, string>>;
        };
        total += res.identified;
        failed += res.failed ?? 0;
        if (res.error) lastError = res.error;
        offset = res.nextOffset;
        if (res.switched && res.served) switchedTo = res.served;
        if (res.attemptErrors) attemptErrors = { ...attemptErrors, ...res.attemptErrors };
        void invalidate();
        if (res.done || res.processed === 0) break;
      }
      notifySwitch(provider, { switched: !!switchedTo, served: switchedTo, attemptErrors });
      if (total > 0) {
        toast.success(`${total} disco(s) atualizado(s) pela IA.`);
      } else if (failed > 0) {
        // Havia discos a identificar, mas a IA não retornou nada — não é "nada para atualizar".
        toast.error(
          `A IA não retornou identificação${lastError ? ` (${lastError})` : ""} — verifique a chave/limite`,
        );
      } else {
        toast.success("Nada para atualizar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao identificar pela IA");
    } finally {
      setIdentifying(false);
    }
  }

  const bulkMut = useMutation({
    mutationFn: (text: string) => importBulk({ data: { text } }),
    onSuccess: (res: { recognized: number; added: number; skipped: number }) => {
      void invalidate();
      setBulkOpen(false);
      const skip = res.skipped ? ` ${res.skipped} pulado(s) (já na coleção).` : "";
      toast.success(
        res.added > 0 ? `${res.added} disco(s) adicionado(s).${skip}` : `Nenhum disco novo.${skip}`,
      );
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível importar"),
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
    mutationFn: (vars: { id: string; provider: AiProvider }) => reprocess({ data: vars }),
    onSuccess: (
      res: {
        updated: boolean;
        served: AiProvider | null;
        switched: boolean;
        error: string | null;
        attemptErrors?: Partial<Record<AiProvider, string>>;
      },
      vars,
    ) => {
      void invalidate();
      notifySwitch(vars.provider, res);
      if (res.updated) {
        toast.success("Disco reprocessado pela IA.");
      } else if (res.error) {
        // A IA não retornou nada (vazio/erro) — não confundir com "nada a mudar".
        toast.error(`A IA não retornou identificação (${res.error}) — verifique a chave/limite`);
      } else {
        toast.success("IA não encontrou nada a mudar.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível reprocessar"),
  });
  // Reprocessa UM disco usando o provedor selecionado no topo da página.
  const startReprocess = (id: string) => {
    reprocessMut.mutate({ id, provider: aiProvider });
  };

  // Edição de tags direto no card (mesmo padrão dos lotes): otimista, com rollback em erro.
  const tagsMut = useMutation({
    mutationFn: (p: { id: string; tags: string[] }) => updateItem({ data: p }),
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.collection });
      const prev = queryClient.getQueryData<CollectionItem[]>(queryKeys.collection);
      queryClient.setQueryData<CollectionItem[]>(queryKeys.collection, (old) =>
        (old ?? []).map((i) => (i.id === p.id ? { ...i, tags: p.tags } : i)),
      );
      return { prev };
    },
    onError: (e: Error, _p, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.collection, ctx.prev);
      toast.error(e.message || "Não foi possível salvar as tags");
    },
    onSettled: () => void invalidate(),
  });

  const artists = useMemo(() => artistOptions(items), [items]);
  // Nomes para o combo do formulário (artistas reais + "Coletâneas"/"Lote"; sem o rótulo genérico).
  const artistNames = useMemo(
    () => artists.map((a) => a.artist).filter((a) => a !== UNCLASSIFIED_LABEL),
    [artists],
  );

  // Lê o arquivo como data URL e envia ao Storage; devolve a URL pública para gravar em `image`.
  async function handleUpload(file: File): Promise<string> {
    const dataUrl = await readFileAsDataUrl(file);
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
  const showViewTabs = !query.isLoading && items.length > 0 && filtered.length > 0;

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <Tabs value={viewTab} onValueChange={setViewTab}>
        <HideableBar hidden={barsHidden} className="top-0 z-30">
          <div className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
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
                <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                  Seus vinis, agrupados por artista. Envie discos arrematados a partir de "Compras",
                  ou adicione manualmente; cada disco é editável.
                </p>
              </div>
              <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
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
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkOpen(true)}
                  title="Importar vários discos de uma vez colando texto (JSON gerado por IA)"
                >
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Adicionar em massa
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
                <AiProviderSelect
                  value={aiProvider}
                  onChange={changeAiProvider}
                  disabled={identifying}
                />
                <GeminiModelSelect
                  value={geminiModel}
                  onChange={changeGeminiModel}
                  disabled={identifying}
                />
              </div>
            </div>

            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 pb-2 sm:gap-2 sm:pb-3">
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
              {showViewTabs ? (
                <TabsList>
                  <TabsTrigger value="cards">Cards</TabsTrigger>
                  <TabsTrigger value="titles">Títulos</TabsTrigger>
                </TabsList>
              ) : null}
            </div>
          </div>
        </HideableBar>

        <div className="mx-auto max-w-6xl px-4 py-6">
          {query.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState onAdd={() => setDraft({ ...EMPTY_DRAFT })} />
          ) : filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center text-sm text-muted-foreground">
              Nenhum disco corresponde ao filtro.
            </p>
          ) : (
            <>
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
                              reprocessMut.isPending && reprocessMut.variables?.id === item.id
                            }
                            onEdit={() => setDraft(toDraft(item))}
                            onRemove={() => removeMut.mutate(item.id)}
                            onReprocess={() => startReprocess(item.id)}
                            onTagsChange={(next) => tagsMut.mutate({ id: item.id, tags: next })}
                            onPickCover={() => setCoverItem(item)}
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
            </>
          )}
        </div>
      </Tabs>

      <CoverPickerDialog
        open={coverItem !== null}
        artist={coverItem?.artist ?? ""}
        album={coverItem?.album ?? ""}
        onClose={() => setCoverItem(null)}
        onPick={async (url) => {
          if (!coverItem) return;
          await updateItem({ data: { id: coverItem.id, image: url } });
          await invalidate();
          toast.success("Capa atualizada.");
        }}
      />
      <EditDialog
        draft={draft}
        saving={saveMut.isPending}
        artistNames={artistNames}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={() => draft && saveMut.mutate(draft)}
        onUpload={handleUpload}
      />

      <BulkImportDialog
        open={bulkOpen}
        importing={bulkMut.isPending}
        onImport={(text) => bulkMut.mutate(text)}
        onClose={() => setBulkOpen(false)}
      />
    </main>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center">
      <Library className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium text-foreground">Sua coleção está vazia.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Envie um disco arrematado a partir da página "Compras", ou adicione um manualmente.
      </p>
      <Button size="sm" className="mt-4" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        Adicionar disco
      </Button>
    </div>
  );
}

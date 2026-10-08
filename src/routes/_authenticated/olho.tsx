import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Binoculars, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { LookoutItemCard, type LookoutPatch } from "@/components/vinyl/lookout-item-card";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import {
  deleteLookout,
  identifyLookout,
  markLookoutSeen,
  mergeLookout,
  setLookoutLink,
  setLookoutLinksBatch,
  unmergeLookout,
  updateLookout,
} from "@/lib/lookout.functions";
import { formatFailoverTrail } from "@/lib/ai-provider";
import { lookoutLabel, notifyKey, type LookoutItem } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import { queryKeys, useLookoutOverviewQuery, useWatchedQuery } from "@/lib/queries";
import { saveAccum, WATCHED_ACCUM_STORAGE_KEY } from "@/lib/watched-accum";

const NO_ARTIST = "Sem artista identificado";

/** Minúsculas, sem acento e sem pontuação — para ordenar/buscar artistas. */
function normName(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ArtistGroup = { key: string; artist: string; items: LookoutItem[] };

/** Agrupa por artista (ordem alfabética; "sem artista" por último); discos por álbum. */
function groupByArtist(items: LookoutItem[]): ArtistGroup[] {
  const map = new Map<string, ArtistGroup>();
  for (const it of items) {
    const name = it.artist.trim();
    const key = normName(name) || "~";
    const g = map.get(key) ?? { key, artist: name || NO_ARTIST, items: [] };
    g.items.push(it);
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.items.sort((a, b) => normName(a.album).localeCompare(normName(b.album), "pt-BR"));
  }
  return groups.sort((a, b) =>
    a.key === "~" ? 1 : b.key === "~" ? -1 : a.key.localeCompare(b.key, "pt-BR"),
  );
}

export const Route = createFileRoute("/_authenticated/olho")({
  head: () => ({ meta: [{ title: "De olho — Garimpo de Vinil" }] }),
  component: OlhoPage,
});

function OlhoPage() {
  const [barsHidden, setBarsHidden] = usePersistedState("olho-bars-hidden", false);
  usePersistedScroll("olho", true);
  const queryClient = useQueryClient();
  const runUpdate = useServerFn(updateLookout);
  const runDelete = useServerFn(deleteLookout);
  const runLink = useServerFn(setLookoutLink);
  const runSeen = useServerFn(markLookoutSeen);
  const runWatch = useServerFn(toggleWatch);
  const runIdentify = useServerFn(identifyLookout);
  const runLinksBatch = useServerFn(setLookoutLinksBatch);
  const runMerge = useServerFn(mergeLookout);
  const runUnmerge = useServerFn(unmergeLookout);

  const query = useLookoutOverviewQuery({ history: true });
  const overview = query.data;
  const items = useMemo(() => overview?.items ?? [], [overview]);
  const active = items.filter((i) => i.status === "active");
  const archived = items.filter((i) => i.status !== "active");

  // Busca por artista (botão/Enter aplica) e combo de artistas — ambos filtram os grupos.
  const [searchText, setSearchText] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [artistPick, setArtistPick] = useState("");
  const groups = useMemo(() => groupByArtist(active), [active]);
  const visibleGroups = useMemo(() => {
    const q = normName(searchApplied);
    return groups.filter(
      (g) => (!artistPick || g.key === artistPick) && (!q || normName(g.artist).includes(q)),
    );
  }, [groups, searchApplied, artistPick]);
  const applySearch = () => setSearchApplied(searchText.trim());

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lookout });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lookoutOverview });
  };

  // Ao abrir a página, os matches atuais passam a "vistos": zera o contador do menu. O selo
  // "novo" desta visita continua visível (a consulta completa não é refeita aqui) — só a versão
  // leve (menu) é invalidada.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || !overview) return;
    markedRef.current = true;
    const keys = overview.upcoming.filter((m) => m.isNew).map(notifyKey);
    if (!keys.length) return;
    void runSeen({ data: { keys } })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: [...queryKeys.lookoutOverview, "light"] }),
      )
      .catch(() => {
        /* acessório: se falhar, o contador só demora a zerar */
      });
  }, [overview, runSeen, queryClient]);

  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: LookoutPatch }) =>
      await runUpdate({ data: { id: vars.id, ...vars.patch } }),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível salvar"),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => await runDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido da lista");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível remover"),
  });
  // Identificação por IA (texto + imagem) de UM item: preenche artista/álbum/ano e recalcula os
  // matches. `identifyingId` = item em andamento (spinner só nele).
  const [identifyingId, setIdentifyingId] = useState<string | null>(null);
  const identifyMut = useMutation({
    mutationFn: async (id: string) => await runIdentify({ data: { id } }),
    onMutate: (id) => setIdentifyingId(id),
    onSuccess: (r) => {
      const trail = r.switched
        ? ` (trocou de provedor — ${formatFailoverTrail(r.attemptErrors)})`
        : "";
      if (r.identified && r.item) {
        toast.success(
          `IA: ${lookoutLabel(r.item)}${r.confidence ? ` · confiança ${r.confidence}` : ""}${
            r.usedImage ? "" : " · sem imagem utilizável, só pelo texto"
          }${trail}`,
        );
      } else {
        toast.warning(
          r.error
            ? `IA não conseguiu identificar: ${r.error}`
            : "A IA não conseguiu identificar este disco — edite no lápis.",
        );
      }
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível identificar pela IA"),
    onSettled: () => setIdentifyingId(null),
  });
  const mergeMut = useMutation({
    mutationFn: async (vars: { targetId: string; sourceId: string }) =>
      await runMerge({ data: vars }),
    onSuccess: () => {
      toast.success("Discos juntados — agora o De olho reconhece os dois nomes");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível juntar"),
  });
  const unmergeMut = useMutation({
    mutationFn: async (vars: { itemId: string; lotId: string }) => await runUnmerge({ data: vars }),
    onSuccess: () => {
      toast.success("Álbum separado");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível separar"),
  });
  const dismissPendingMut = useMutation({
    mutationFn: async (lotIds: string[]) =>
      await runLinksBatch({ data: { lotIds, value: false as const } }),
    onSuccess: () => {
      toast.success("Aparições descartadas");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível descartar"),
  });
  const resolveMut = useMutation({
    mutationFn: async (vars: { lotId: string; value: string | false }) =>
      await runLink({ data: vars }),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível salvar"),
  });

  // Vigia REAL: a lista vem da conta do LeilõesBR (`listWatched`), exposta pelo mesmo hook/cache/
  // acumulador da home e da Análise (`useWatchedQuery` — as rotas precisam usar a MESMA lógica,
  // ver `watched-accum.ts`). Casa por `idPeca`, como as outras duas telas.
  const { query: watched, accumRef: watchedAccumRef } = useWatchedQuery();
  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((w) => w.idPeca)),
    [watched.data],
  );
  const [busyWatch, setBusyWatch] = useState<string | null>(null);
  // Liga/desliga a vigia real de UM lote e atualiza o acumulador NA HORA nas duas direções, como o
  // `toggle` da home: a conta do LeilõesBR pode demorar a refletir, então NÃO invalidamos
  // `queryKeys.watched` (um refetch imediato traria a lista atrasada e desfaria a atualização).
  const setWatch = async (m: LookoutUpcoming, watch: boolean) => {
    const result = await runWatch({
      data: { idPeca: m.idPeca, idLeilao: m.idLeilao, base: m.base, watch },
    });
    const key = `${m.idLeilao}-${m.idPeca}`;
    if (!result.watched) {
      watchedAccumRef.current!.delete(key);
    } else {
      const [yyyy, mm, dd] = m.dayKey.split("-");
      watchedAccumRef.current!.set(key, {
        id: key,
        idPeca: m.idPeca,
        idLeilao: m.idLeilao,
        base: m.base,
        lote: m.lote,
        title: m.title,
        url: m.url,
        image: m.image,
        price: m.price,
        date: dd && mm && yyyy ? `${dd}/${mm}/${yyyy}` : "",
        time: m.time,
        house: m.house,
        houseUrl: "",
        uf: m.uf,
        artist: "",
        watched: true,
      });
    }
    saveAccum(WATCHED_ACCUM_STORAGE_KEY, watchedAccumRef.current!);
    queryClient.setQueryData(queryKeys.watched, [...watchedAccumRef.current!.values()]);
    return result.watched;
  };
  const watchLot = async (m: LookoutUpcoming) => {
    setBusyWatch(m.lotId);
    try {
      const nowWatched = await setWatch(m, !watchedIds.has(m.idPeca));
      toast.success(nowWatched ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível alterar a vigia");
    } finally {
      setBusyWatch(null);
    }
  };
  // "Adquirido": tira o disco (com TODOS os álbuns juntados) do De olho e para de vigiar todos os
  // lotes dele que estão na vigia.
  const acquireItem = async (item: LookoutItem) => {
    const toUnwatch = (upcomingByItem.get(item.id) ?? []).filter((m) => watchedIds.has(m.idPeca));
    let failed = 0;
    for (const m of toUnwatch) {
      try {
        await setWatch(m, false);
      } catch {
        failed++;
      }
    }
    updateMut.mutate({ id: item.id, patch: { status: "acquired" } });
    if (toUnwatch.length) {
      if (failed) toast.warning(`${failed} vigia(s) não puderam ser removidas — remova à mão`);
      else toast.success(`Parou de vigiar ${toUnwatch.length} lote(s)`);
    }
  };

  const upcomingByItem = useMemo(() => {
    const map = new Map<string, LookoutUpcoming[]>();
    for (const m of overview?.upcoming ?? []) {
      const list = map.get(m.itemId) ?? [];
      list.push(m);
      map.set(m.itemId, list);
    }
    return map;
  }, [overview]);
  const historyByItem = useMemo(() => {
    const map = new Map<string, NonNullable<typeof overview>["history"]>();
    for (const h of overview?.history ?? []) {
      const list = map.get(h.itemId) ?? [];
      list.push(h);
      map.set(h.itemId, list);
    }
    return map;
  }, [overview]);

  const totalUpcoming = overview?.upcoming.length ?? 0;
  const newCount = overview?.newCount ?? 0;

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <HideableBar hidden={barsHidden} className="top-0 z-30">
        <div className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild className="max-sm:hidden">
                  <Link to="/">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Link>
                </Button>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                  <Binoculars className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />
                  De olho
                </h1>
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Discos que você quer muito — reconhecidos quando reaparecem em leilões futuros.
              </p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <span className="text-xs text-muted-foreground">
                {active.length} disco(s) · {totalUpcoming} match(es) por vir
                {newCount ? ` (${newCount} novo${newCount === 1 ? "" : "s"})` : ""}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
                title="Recalcular os matches com os lotes mais recentes"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </div>
      </HideableBar>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {query.isLoading ? (
          <>
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </>
        ) : query.isError ? (
          <p className="text-sm text-destructive">
            Não foi possível carregar o &quot;De olho&quot;.{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              Tentar de novo
            </button>
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <Binoculars className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum disco de olho ainda. Na lista de lotes, toque no ícone de binóculos
              (&quot;Ficar de olho&quot;) num disco que você quer muito — quando ele reaparecer, o
              card é destacado aqui e na home, e você recebe um aviso (se o ntfy estiver
              configurado).
            </p>
          </div>
        ) : (
          <>
            {active.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <form
                  className="flex min-w-60 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applySearch();
                  }}
                >
                  <Input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Buscar artista…"
                    aria-label="Buscar por artista"
                    className="h-9"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    <Search className="mr-1 h-4 w-4" />
                    Buscar
                  </Button>
                  {searchApplied ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSearchText("");
                        setSearchApplied("");
                      }}
                    >
                      Limpar
                    </Button>
                  ) : null}
                </form>
                <select
                  value={artistPick}
                  onChange={(e) => setArtistPick(e.target.value)}
                  aria-label="Filtrar por artista"
                  className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                >
                  <option value="">Todos os artistas ({groups.length})</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.artist} ({g.items.length})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {active.length && !visibleGroups.length ? (
              <p className="text-sm text-muted-foreground">Nenhum artista encontrado.</p>
            ) : null}
            {visibleGroups.map((group) => (
              <div key={group.key} className="space-y-3">
                <h2 className="border-b border-border pb-1 text-sm font-semibold text-foreground">
                  {group.artist}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({group.items.length} álbum{group.items.length === 1 ? "" : "ns"})
                  </span>
                </h2>
                {group.items.map((item) => (
                  <LookoutItemCard
                    key={item.id}
                    item={item}
                    upcoming={upcomingByItem.get(item.id) ?? []}
                    history={historyByItem.get(item.id) ?? []}
                    watchedIds={watchedIds}
                    watchLoading={watched.isLoading}
                    busyWatch={busyWatch}
                    mergeOptions={active.filter((o) => o.id !== item.id)}
                    onUpdate={(patch) => updateMut.mutate({ id: item.id, patch })}
                    onAcquire={() => void acquireItem(item)}
                    onDelete={() => deleteMut.mutate(item.id)}
                    onMerge={(sourceId) => mergeMut.mutate({ targetId: item.id, sourceId })}
                    onUnmerge={(lotId) => unmergeMut.mutate({ itemId: item.id, lotId })}
                    onIdentify={() => identifyMut.mutate(item.id)}
                    identifying={identifyingId === item.id}
                    onDismissPending={(lotIds) => dismissPendingMut.mutate(lotIds)}
                    onResolveSale={(h, decision) =>
                      resolveMut.mutate({
                        lotId: h.lotId,
                        value: decision === "confirm" ? item.id : false,
                      })
                    }
                    onWatch={(m) => void watchLot(m)}
                    onResolve={(m, decision) =>
                      resolveMut.mutate({
                        lotId: m.lotId,
                        value: decision === "confirm" ? item.id : false,
                      })
                    }
                  />
                ))}
              </div>
            ))}
            {archived.length ? (
              <div className="space-y-3 pt-2">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Arquivados ({archived.length})
                </h2>
                {archived.map((item) => (
                  <LookoutItemCard
                    key={item.id}
                    item={item}
                    upcoming={[]}
                    history={[]}
                    watchedIds={watchedIds}
                    watchLoading={false}
                    busyWatch={busyWatch}
                    mergeOptions={[]}
                    onUpdate={(patch) => updateMut.mutate({ id: item.id, patch })}
                    onAcquire={() => undefined}
                    onDelete={() => deleteMut.mutate(item.id)}
                    onMerge={() => undefined}
                    onUnmerge={() => undefined}
                    onIdentify={() => identifyMut.mutate(item.id)}
                    identifying={identifyingId === item.id}
                    onDismissPending={() => undefined}
                    onResolveSale={() => undefined}
                    onWatch={() => undefined}
                    onResolve={() => undefined}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

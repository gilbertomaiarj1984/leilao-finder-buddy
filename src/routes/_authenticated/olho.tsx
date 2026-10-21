import { useDragAutoScroll } from "@/components/vinyl/use-drag-autoscroll";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUpToLine,
  Binoculars,
  LayoutList,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { InterestsDialog } from "@/components/vinyl/interests-dialog";
import { LookoutOwnedDialog } from "@/components/vinyl/lookout-owned-dialog";
import { LookoutBulkDialog } from "@/components/vinyl/lookout-bulk-dialog";
import { LookoutItemCard, type LookoutPatch } from "@/components/vinyl/lookout-item-card";
import { LookoutLotDialog } from "@/components/vinyl/lookout-lot-dialog";
import { applyLookoutLinks } from "@/lib/lookout-overview-patch";
import { LookoutSummaryRow } from "@/components/vinyl/lookout-summary-row";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import {
  deleteLookout,
  identifyLookout,
  markLookoutSeen,
  mergeLookout,
  moveLookoutLot,
  setLookoutLink,
  setLookoutArtistGroup,
  toggleLookout,
  setLookoutLinksBatch,
  unmergeLookout,
  updateLookout,
} from "@/lib/lookout.functions";
import { setUserInterests } from "@/lib/ai.functions";
import { formatFailoverTrail } from "@/lib/ai-provider";
import {
  lookoutLabel,
  lookoutOwnedInCollection,
  notifyKey,
  resolveLookoutArtist,
  type LookoutArtistGroups,
  type LookoutItem,
} from "@/lib/lookout-match";
import { filterByLookoutDay, lookoutDayOptions } from "@/lib/lookout-day-filter";
import type { LookoutOverview, LookoutUpcoming } from "@/lib/lookout-matches.server";
import { localDayKey, usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import {
  queryKeys,
  useAnalyticsAliasesQuery,
  useCollectionQuery,
  useCollectorInterests,
  useInterestsQuery,
  useLookoutOverviewQuery,
  useBidsQuery,
  useWatchedQuery,
} from "@/lib/queries";
import { saveAccum, WATCHED_ACCUM_STORAGE_KEY } from "@/lib/watched-accum";

const ARTIST_DRAG_TYPE = "application/x-lookout-artist";
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
function groupByArtist(items: LookoutItem[], joined?: LookoutArtistGroups): ArtistGroup[] {
  const map = new Map<string, ArtistGroup>();
  for (const it of items) {
    // Artistas juntados arrastando: o grupo leva o nome de quem recebeu.
    const name = resolveLookoutArtist(it.artist.trim(), joined);
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

function groupNewCount(items: LookoutItem[], byItem: Map<string, LookoutUpcoming[]>): number {
  let n = 0;
  for (const it of items) n += (byItem.get(it.id) ?? []).filter((m) => m.isNew).length;
  return n;
}

function OlhoPage() {
  const [barsHidden, setBarsHidden] = usePersistedState("olho-bars-hidden", false);
  // Modo de exibição: "compact" = linhas-resumo (clicar abre o cartão no diálogo); "expanded" =
  // cartões completos na própria lista.
  const [view, setView] = usePersistedState<"compact" | "expanded">("olho-view", "compact");
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
  const runMoveLot = useServerFn(moveLookoutLot);
  const runArtistGroup = useServerFn(setLookoutArtistGroup);
  const runToggleLookout = useServerFn(toggleLookout);
  const runSaveInterests = useServerFn(setUserInterests);

  // Perfil do colecionador: «Meus interesses» (manual) + artistas dos discos de olho.
  const interestsQuery = useInterestsQuery();
  const collector = useCollectorInterests();
  const saveInterestsMut = useMutation({
    mutationFn: (list: string[]) => runSaveInterests({ data: { items: list } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.interests });
      toast.success("Interesses salvos");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  // Duas etapas (v0.155.0): a versão leve (sem valor ao vivo nem histórico — a mesma do contador
  // do menu, normalmente já em cache) aparece primeiro; a completa a substitui quando chega.
  // Os patches otimistas (`patchOverview`) e as invalidações já atingem as duas pela chave base.
  const lightQuery = useLookoutOverviewQuery({ history: false });
  const fullQuery = useLookoutOverviewQuery({ history: true });
  const overview = fullQuery.data ?? lightQuery.data;
  const query = {
    isLoading: !overview && (lightQuery.isLoading || fullQuery.isLoading),
    isError: !overview && (lightQuery.isError || fullQuery.isError),
    isFetching: lightQuery.isFetching || fullQuery.isFetching,
    refetch: () => Promise.all([lightQuery.refetch(), fullQuery.refetch()]),
  };
  // Só a versão leve na tela: valores da varredura e sem aparições passadas por enquanto.
  const completing = Boolean(overview) && !fullQuery.data;
  const items = useMemo(() => overview?.items ?? [], [overview]);
  // Memorizados: sem isso `groups` (abaixo) era recalculado a cada render (ex.: cada tecla na busca).
  const active = useMemo(() => items.filter((i) => i.status === "active"), [items]);
  const archived = useMemo(() => items.filter((i) => i.status !== "active"), [items]);

  // Busca por artista (botão/Enter aplica) e combo de artistas — ambos filtram os grupos.
  const [searchText, setSearchText] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [artistPick, setArtistPick] = useState("");
  const artistJoins = useMemo(() => overview?.artistGroups ?? {}, [overview]);
  const groups = useMemo(() => groupByArtist(active, artistJoins), [active, artistJoins]);
  const filteredGroups = useMemo(() => {
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

  // Os lotes "novos" só deixam de ser novos quando o usuário clica em "Marcar como vistos":
  // abrir a página ou resolver outros lotes (✓/✕) não os apaga.
  const markAllSeen = () => {
    setShowNew(false);
    // Só o que está na tela: com um dia escolhido, os novos de outros dias continuam novos.
    const keys = upcomingList.filter((m) => m.isNew).map(notifyKey);
    if (!keys.length) return;
    void runSeen({ data: { keys } })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.lookoutOverview }))
      .catch(() => {
        toast.error("Não foi possível marcar como vistos");
        setShowNew(true);
      });
  };

  // Ações simples (editar, arquivar, remover) refletem NA HORA no cache da visão: o recálculo dos
  // matches no servidor é pesado e roda em segundo plano (`refresh`); erro desfaz.
  const patchOverview = (fn: (o: LookoutOverview) => LookoutOverview) => {
    queryClient.setQueriesData<LookoutOverview>({ queryKey: queryKeys.lookoutOverview }, (o) =>
      o ? fn(o) : o,
    );
  };
  const optimistic = async () => {
    await queryClient.cancelQueries({ queryKey: queryKeys.lookoutOverview });
    return queryClient.getQueriesData<LookoutOverview>({ queryKey: queryKeys.lookoutOverview });
  };
  const rollback = (prev?: [readonly unknown[], LookoutOverview | undefined][]) => {
    for (const [key, data] of prev ?? []) queryClient.setQueryData(key, data);
  };
  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: LookoutPatch }) =>
      await runUpdate({ data: { id: vars.id, ...vars.patch } }),
    onMutate: async (vars) => {
      const prev = await optimistic();
      patchOverview((o) => ({
        ...o,
        items: o.items.map((i) => (i.id === vars.id ? { ...i, ...vars.patch } : i)),
      }));
      return { prev };
    },
    onSuccess: refresh,
    onError: (error: unknown, _vars, ctx) => {
      rollback(ctx?.prev);
      toast.error((error as Error)?.message || "Não foi possível salvar");
    },
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => await runDelete({ data: { id } }),
    onMutate: async (id) => {
      const prev = await optimistic();
      patchOverview((o) => ({
        ...o,
        items: o.items.filter((i) => i.id !== id),
        upcoming: o.upcoming.filter((m) => m.itemId !== id),
        history: o.history.filter((h) => h.itemId !== id),
      }));
      return { prev };
    },
    onSuccess: () => {
      toast.success("Removido da lista");
      refresh();
    },
    onError: (error: unknown, _id, ctx) => {
      rollback(ctx?.prev);
      toast.error((error as Error)?.message || "Não foi possível remover");
    },
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
  // Juntar artistas (arrastar o título de um grupo sobre outro): `to` null desfaz a junção.
  const artistMut = useMutation({
    mutationFn: async (vars: { from: string; to: string | null }) =>
      await runArtistGroup({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(vars.to ? `Artistas juntados em "${vars.to}"` : "Artista separado");
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível juntar os artistas"),
  });
  const autoScroll = useDragAutoScroll();
  const [artistDropKey, setArtistDropKey] = useState<string | null>(null);
  const moveLotMut = useMutation({
    mutationFn: async (vars: { lotId: string; itemId: string }) => await runMoveLot({ data: vars }),
    onMutate: async (vars) => {
      const prev = await optimistic();
      patchOverview((o) => applyLookoutLinks(o, [vars.lotId], vars.itemId));
      return { prev };
    },
    onSuccess: () => {
      toast.success("Lote movido — identificação ajustada para este disco");
      refresh();
    },
    onError: (error: unknown, _vars, ctx) => {
      rollback(ctx?.prev);
      toast.error((error as Error)?.message || "Não foi possível mover o lote");
    },
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
    onMutate: async (lotIds) => {
      const prev = await optimistic();
      patchOverview((o) => applyLookoutLinks(o, lotIds, false));
      return { prev };
    },
    onSuccess: () => {
      toast.success("Aparições descartadas");
      refresh();
    },
    onError: (error: unknown, _ids, ctx) => {
      rollback(ctx?.prev);
      toast.error((error as Error)?.message || "Não foi possível descartar");
    },
  });
  const resolveMut = useMutation({
    mutationFn: async (vars: { lotId: string; value: string | false }) =>
      await runLink({ data: vars }),
    onMutate: async (vars) => {
      const prev = await optimistic();
      patchOverview((o) => applyLookoutLinks(o, [vars.lotId], vars.value));
      return { prev };
    },
    onSuccess: refresh,
    onError: (error: unknown, _vars, ctx) => {
      rollback(ctx?.prev);
      toast.error((error as Error)?.message || "Não foi possível salvar");
    },
  });

  // "Criar novo álbum de olho" a partir de um lote por vir: o diálogo pede artista/álbum/ano
  // (artista e álbum pré-preenchidos); o lote passa a ser a origem do disco novo e deixa o antigo.
  const [createFrom, setCreateFrom] = useState<{
    m: LookoutUpcoming;
    artist: string;
    album: string;
    year: string;
  } | null>(null);
  const createMut = useMutation({
    mutationFn: async (c: NonNullable<typeof createFrom>) => {
      const y = Number(c.year);
      const res = await runToggleLookout({
        data: {
          lotId: c.m.lotId,
          artist: c.artist,
          album: c.album,
          year: Number.isFinite(y) && y >= 1900 && y <= 2100 ? Math.trunc(y) : null,
          title: c.m.title,
          house: c.m.house,
          image: c.m.image,
          url: c.m.url,
          dayKey: c.m.dayKey,
        },
      });
      // O lote deixa de casar com o disco antigo (✕) e vira origem do novo.
      if (res.item) await runLink({ data: { lotId: c.m.lotId, value: res.item.id } });
      return res.item;
    },
    onSuccess: () => {
      toast.success("Novo álbum de olho criado");
      setCreateFrom(null);
      refresh();
    },
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível criar o álbum"),
  });

  // Vigia REAL: a lista vem da conta do LeilõesBR (`listWatched`), exposta pelo mesmo hook/cache/
  // acumulador da home e da Análise (`useWatchedQuery` — as rotas precisam usar a MESMA lógica,
  // ver `watched-accum.ts`). Casa por `idPeca`, como as outras duas telas.
  const { query: watched, accumRef: watchedAccumRef } = useWatchedQuery();
  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((w) => w.idPeca)),
    [watched.data],
  );
  // Meus lances (mesmo hook/cache da home): pinta a borda do lote por vir (vencendo/superado).
  const { query: bids } = useBidsQuery();
  const bidById = useMemo(
    () => new Map((bids.data ?? []).map((b) => [b.id, { status: b.status, myBid: b.myBid }])),
    [bids.data],
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
    // Todos os lotes do disco, não só os do dia filtrado.
    const toUnwatch = allUpcoming.filter((m) => m.itemId === item.id && watchedIds.has(m.idPeca));
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

  // Destaque dos itens novos (artista, disco e lote) só nesta visita: "Marcar como vistos" o apaga.
  const [showNew, setShowNew] = useState(true);
  const allUpcoming = useMemo(
    () => (overview?.upcoming ?? []).map((m) => (showNew || !m.isNew ? m : { ...m, isNew: false })),
    [overview, showNew],
  );
  // Filtro por dia: os próximos 10 dias (hoje + 9); vazio = todos. Com um dia escolhido, só os
  // lotes por vir daquele dia entram na tela (discos sem lote naquele dia somem da lista).
  const [dayPick, setDayPick] = useState("");
  const dayOptions = useMemo(() => lookoutDayOptions(localDayKey(), allUpcoming), [allUpcoming]);
  const upcomingList = useMemo(
    () => filterByLookoutDay(allUpcoming, dayPick),
    [allUpcoming, dayPick],
  );
  const upcomingByItem = useMemo(() => {
    const map = new Map<string, LookoutUpcoming[]>();
    for (const m of upcomingList) {
      const list = map.get(m.itemId) ?? [];
      list.push(m);
      map.set(m.itemId, list);
    }
    return map;
  }, [upcomingList]);
  const historyByItem = useMemo(() => {
    const map = new Map<string, NonNullable<typeof overview>["history"]>();
    for (const h of overview?.history ?? []) {
      const list = map.get(h.itemId) ?? [];
      list.push(h);
      map.set(h.itemId, list);
    }
    return map;
  }, [overview]);

  // Cartão completo de um disco — usado inline (modo expandido) e no diálogo (modo compacto).
  const renderCard = (it: LookoutItem) => {
    return (
      <LookoutItemCard
        key={it.id}
        item={it}
        upcoming={it.status === "active" ? (upcomingByItem.get(it.id) ?? []) : []}
        history={it.status === "active" ? (historyByItem.get(it.id) ?? []) : []}
        watchedIds={watchedIds}
        bidById={bidById}
        watchLoading={watched.isLoading}
        busyWatch={busyWatch}
        mergeOptions={active.filter((o) => o.id !== it.id)}
        onUpdate={(patch) => updateMut.mutate({ id: it.id, patch })}
        onAcquire={() => {
          void acquireItem(it);
          setOpenId(null);
        }}
        onDelete={() => {
          deleteMut.mutate(it.id);
          setOpenId(null);
        }}
        onMerge={(sourceId) => {
          mergeMut.mutate({ targetId: it.id, sourceId });
        }}
        onUnmerge={(lotId) => unmergeMut.mutate({ itemId: it.id, lotId })}
        onMoveLot={(lotId) => moveLotMut.mutate({ lotId, itemId: it.id })}
        onIdentify={() => identifyMut.mutate(it.id)}
        identifying={identifyingId === it.id}
        onDismissPending={(lotIds) => dismissPendingMut.mutate(lotIds)}
        onResolveSale={(h, decision) =>
          resolveMut.mutate({
            lotId: h.lotId,
            value: decision === "confirm" ? it.id : false,
          })
        }
        onWatch={(m) => void watchLot(m)}
        onOpenLot={(m) => setOpenLotId(m.lotId)}
        onCreateFromLot={(m) =>
          setCreateFrom({ m, artist: it.artist, album: m.album ?? "", year: "" })
        }
        onResolve={(m, decision) =>
          resolveMut.mutate({
            lotId: m.lotId,
            value: decision === "confirm" ? it.id : false,
          })
        }
      />
    );
  };

  const [bulkOpen, setBulkOpen] = useState(false);
  const [ownedOpen, setOwnedOpen] = useState(false);
  // Discos de olho que já estão na Coleção (mesmo motor de casamento dos lotes).
  const collection = useCollectionQuery();
  const aliasesQuery = useAnalyticsAliasesQuery();
  const ownedHits = useMemo(
    () => lookoutOwnedInCollection(active, collection.data ?? [], aliasesQuery.data?.artists),
    [active, collection.data, aliasesQuery.data],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // Lote "por vir" aberto no cartão completo (o mesmo da home), por cima do cartão do disco.
  const [openLotId, setOpenLotId] = useState<string | null>(null);
  const openLot = (overview?.upcoming ?? []).find((m) => m.lotId === openLotId) ?? null;
  const openItem = items.find((i) => i.id === openId) ?? null;
  const totalUpcoming = upcomingList.length;
  const newCount = upcomingList.filter((m) => m.isNew).length;
  // Com lote por vir no topo (álbuns com lote primeiro dentro do artista), depois os "sem lote
  // por vir"; a ordem alfabética é mantida dentro de cada bloco.
  const { withUpcoming, withoutUpcoming } = useMemo(() => {
    const hasUpcoming = (it: LookoutItem) => (upcomingByItem.get(it.id)?.length ?? 0) > 0;
    const withU: ArtistGroup[] = [];
    const without: ArtistGroup[] = [];
    for (const g of filteredGroups) {
      const sorted = [...g.items]
        .filter((it) => !dayPick || hasUpcoming(it))
        .sort((a, b) => Number(hasUpcoming(b)) - Number(hasUpcoming(a)));
      if (!sorted.length) continue;
      (sorted.some(hasUpcoming) ? withU : without).push({ ...g, items: sorted });
    }
    return { withUpcoming: withU, withoutUpcoming: without };
  }, [filteredGroups, upcomingByItem, dayPick]);
  const visibleGroups = useMemo(
    () => [...withUpcoming, ...withoutUpcoming],
    [withUpcoming, withoutUpcoming],
  );
  const newArtists = visibleGroups.filter((g) => groupNewCount(g.items, upcomingByItem) > 0).length;
  const newMatches = upcomingList.filter((m) => m.isNew);
  const [showArchived, setShowArchived] = useState(false);
  const goToItem = (itemId: string) => {
    const el = document.getElementById(`olho-item-${itemId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-fuchsia-500");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-fuchsia-500"), 2000);
  };

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
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0">
              <span className="text-xs text-muted-foreground">
                {active.length} disco(s) · {totalUpcoming} match(es) por vir
                {newCount ? ` (${newCount} novo${newCount === 1 ? "" : "s"})` : ""}
              </span>
              {ownedHits.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOwnedOpen(true)}
                  title="Discos de olho que já estão na sua Coleção"
                >
                  Já tenho ({ownedHits.length})
                </Button>
              ) : null}
              <InterestsDialog
                interests={interestsQuery.data ?? []}
                fromLookout={collector.derived}
                onSave={(list) => saveInterestsMut.mutate(list)}
                saving={saveInterestsMut.isPending}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBulkOpen(true)}
                title="Adicionar por lista ou digitando artista / álbum (a IA identifica)"
              >
                <Plus className="mr-2 h-4 w-4" />
                Adicionar
              </Button>
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

      <LookoutOwnedDialog
        open={ownedOpen}
        onOpenChange={setOwnedOpen}
        hits={ownedHits}
        items={active}
        onConfirm={async (ids) => {
          for (const id of ids) {
            const it = active.find((i) => i.id === id);
            if (it) await acquireItem(it);
          }
          toast.success(`${ids.length} disco(s) tirado(s) da lista`);
        }}
      />
      <LookoutBulkDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {newCount > 0 ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-fuchsia-500/60 bg-fuchsia-500/10 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <b className="text-fuchsia-700 dark:text-fuchsia-300">
                {newArtists} artista{newArtists === 1 ? "" : "s"} com {newCount} lote
                {newCount === 1 ? "" : "s"} novo{newCount === 1 ? "" : "s"}
              </b>{" "}
              desde a sua última visita:
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {newMatches.map((m) => {
                  const it = items.find((i) => i.id === m.itemId);
                  return (
                    <li key={m.lotId}>
                      <button
                        type="button"
                        onClick={() => goToItem(m.itemId)}
                        className="text-left underline-offset-2 hover:underline"
                        title="Descer até este disco na lista"
                      >
                        <span className="font-semibold">
                          {it ? lookoutLabel(it) || m.title : m.title}
                        </span>
                        <span className="text-muted-foreground">
                          {` · lote ${m.lote || "—"} · ${m.house} · ${m.dayKey.split("-").reverse().join("/")} · ${m.price} ↓`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <Button size="sm" variant="outline" onClick={markAllSeen}>
              Marcar como vistos
            </Button>
          </div>
        ) : null}
        {completing ? (
          <p className="text-xs text-muted-foreground">
            {fullQuery.isError
              ? "Não foi possível ler os valores ao vivo e o histórico — mostrando os valores da última varredura."
              : "Carregando valores ao vivo e aparições passadas…"}
          </p>
        ) : null}
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
              Nenhum disco de olho ainda. Use &quot;Adicionar&quot; para subir uma lista ou digitar
              artista / álbum, ou, na lista de lotes, toque no ícone de binóculos (&quot;Ficar de
              olho&quot;) num disco que você quer muito — quando ele reaparecer, o card é destacado
              aqui e na home, e você recebe um aviso (se o ntfy estiver configurado).
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
                <div className="flex items-center gap-1" role="group" aria-label="Modo de exibição">
                  <Button
                    type="button"
                    size="sm"
                    variant={view === "compact" ? "secondary" : "ghost"}
                    aria-pressed={view === "compact"}
                    onClick={() => setView("compact")}
                    title="Linhas compactas — clique numa para abrir o cartão completo"
                  >
                    <Rows3 className="mr-1 h-4 w-4" />
                    Compacto
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={view === "expanded" ? "secondary" : "ghost"}
                    aria-pressed={view === "expanded"}
                    onClick={() => setView("expanded")}
                    title="Cartões completos na lista"
                  >
                    <LayoutList className="mr-1 h-4 w-4" />
                    Expandido
                  </Button>
                </div>
              </div>
            ) : null}
            {active.length ? (
              <div
                className="flex items-center gap-1.5 overflow-x-auto pb-1"
                role="group"
                aria-label="Filtrar por dia"
              >
                <span className="shrink-0 text-xs font-medium text-muted-foreground">Dia:</span>
                <Button
                  type="button"
                  size="sm"
                  variant={dayPick ? "outline" : "secondary"}
                  aria-pressed={!dayPick}
                  className="h-8 shrink-0 px-2.5"
                  onClick={() => setDayPick("")}
                >
                  Todos
                </Button>
                {dayOptions.map((d) => (
                  <Button
                    key={d.dayKey}
                    type="button"
                    size="sm"
                    variant={dayPick === d.dayKey ? "secondary" : "outline"}
                    aria-pressed={dayPick === d.dayKey}
                    className={`h-8 shrink-0 px-2.5 ${d.count ? "" : "text-muted-foreground"}`}
                    onClick={() => setDayPick(dayPick === d.dayKey ? "" : d.dayKey)}
                    title={`${d.count} lote(s) por vir em ${d.label}`}
                  >
                    <span className="font-semibold">{d.weekday}</span>
                    <span className="ml-1">{d.label}</span>
                    <span
                      className={`ml-1.5 rounded-full px-1.5 text-[10px] font-bold ${
                        d.count
                          ? "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {d.count}
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {active.length && !visibleGroups.length ? (
              <p className="text-sm text-muted-foreground">
                {dayPick
                  ? "Nenhum lote por vir neste dia para os discos de olho."
                  : "Nenhum artista encontrado."}
              </p>
            ) : null}
            {[
              { key: "with", title: "Com lote por vir", list: withUpcoming },
              { key: "without", title: "Sem lote por vir", list: withoutUpcoming },
            ].map((section) =>
              section.list.length ? (
                <div key={section.key} className="space-y-4">
                  <h2 className="border-b border-border pb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {section.title} ({section.list.length} artista
                    {section.list.length === 1 ? "" : "s"})
                  </h2>
                  {section.list.map((group) => (
                    <div key={group.key} className="space-y-3">
                      <div
                        draggable={group.key !== "~"}
                        onDragStart={(e) => {
                          autoScroll.start();
                          e.dataTransfer.setData(ARTIST_DRAG_TYPE, group.artist);
                          e.dataTransfer.setData("text/plain", group.artist);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (group.key === "~" || !e.dataTransfer.types.includes(ARTIST_DRAG_TYPE))
                            return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setArtistDropKey(group.key);
                        }}
                        onDragLeave={() => setArtistDropKey(null)}
                        onDrop={(e) => {
                          setArtistDropKey(null);
                          const from = e.dataTransfer.getData(ARTIST_DRAG_TYPE);
                          if (!from || group.key === "~" || normName(from) === group.key) return;
                          e.preventDefault();
                          artistMut.mutate({ from, to: group.artist });
                        }}
                        title="Arraste este artista sobre outro para juntar (o nome de quem recebe permanece)"
                        className={`rounded border-b-2 px-1.5 pb-1.5 ${
                          groupNewCount(group.items, upcomingByItem) > 0
                            ? "border-fuchsia-500 bg-fuchsia-500/10"
                            : "border-foreground"
                        } ${artistDropKey === group.key ? "bg-fuchsia-500/10 ring-2 ring-fuchsia-500" : ""}`}
                      >
                        <h2 className="flex flex-wrap items-center gap-x-2 text-base font-bold text-foreground">
                          <span
                            aria-hidden="true"
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${
                              groupNewCount(group.items, upcomingByItem) > 0
                                ? "bg-fuchsia-500 text-white"
                                : "bg-foreground text-background"
                            }`}
                          >
                            {group.key === "~" ? "?" : group.artist.charAt(0).toUpperCase()}
                          </span>
                          <span
                            className={
                              groupNewCount(group.items, upcomingByItem) > 0
                                ? "text-fuchsia-700 dark:text-fuchsia-300"
                                : undefined
                            }
                          >
                            {group.artist}
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">
                            ({group.items.length} álbum{group.items.length === 1 ? "" : "ns"})
                          </span>
                          {groupNewCount(group.items, upcomingByItem) > 0 ? (
                            <span className="ml-auto rounded-full bg-fuchsia-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              {groupNewCount(group.items, upcomingByItem)} novo
                              {groupNewCount(group.items, upcomingByItem) === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                            aria-label="Voltar ao topo"
                            title="Voltar ao topo"
                            className={`rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground ${
                              groupNewCount(group.items, upcomingByItem) > 0 ? "" : "ml-auto"
                            }`}
                          >
                            <ArrowUpToLine className="h-4 w-4" />
                          </button>
                        </h2>
                        {Object.values(artistJoins).filter(
                          (j) => resolveLookoutArtist(j.label, artistJoins) === group.artist,
                        ).length ? (
                          <ul className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                            <li className="py-0.5">Juntado com:</li>
                            {Object.values(artistJoins)
                              .filter(
                                (j) => resolveLookoutArtist(j.label, artistJoins) === group.artist,
                              )
                              .map((j) => (
                                <li
                                  key={j.label}
                                  className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5"
                                >
                                  {j.label}
                                  <button
                                    type="button"
                                    onClick={() => artistMut.mutate({ from: j.label, to: null })}
                                    aria-label={`Separar ${j.label}`}
                                    title="Separar — volta a ser um artista próprio"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </li>
                              ))}
                          </ul>
                        ) : null}
                      </div>
                      <div className="ml-11 space-y-1.5">
                        {group.items.map((item) => {
                          const itemUpcoming = upcomingByItem.get(item.id) ?? [];
                          // Visão expandida: álbum sem lote por vir fica numa linha mínima (artista — álbum).
                          return (
                            <div
                              key={item.id}
                              id={`olho-item-${item.id}`}
                              className="scroll-mt-24 rounded-md"
                            >
                              {view === "expanded" && itemUpcoming.length > 0 ? (
                                renderCard(item)
                              ) : (
                                <LookoutSummaryRow
                                  item={item}
                                  upcoming={itemUpcoming}
                                  watchedIds={watchedIds}
                                  compact={view === "expanded"}
                                  onOpen={() => setOpenId(item.id)}
                                  onMerge={(sourceId) =>
                                    mergeMut.mutate({ targetId: item.id, sourceId })
                                  }
                                  onMoveLot={(lotId) =>
                                    moveLotMut.mutate({ lotId, itemId: item.id })
                                  }
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null,
            )}
            {archived.length ? (
              <div className="space-y-3 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "Ocultar" : "Mostrar"} arquivados ({archived.length})
                </Button>
                {(showArchived ? archived : []).map((item) =>
                  view === "expanded" ? (
                    renderCard(item)
                  ) : (
                    <LookoutSummaryRow
                      key={item.id}
                      item={item}
                      upcoming={[]}
                      watchedIds={watchedIds}
                      onOpen={() => setOpenId(item.id)}
                      onMerge={() => undefined}
                      onMoveLot={() => undefined}
                    />
                  ),
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
      <Dialog open={openItem != null} onOpenChange={(open) => (open ? undefined : setOpenId(null))}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
          <DialogTitle className="sr-only">Detalhes do disco de olho</DialogTitle>
          <DialogDescription className="sr-only">
            Todas as informações e ações deste disco: matches por vir, histórico, teto, nota,
            palavras de agrupamento e junção.
          </DialogDescription>
          {openItem ? renderCard(openItem) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={createFrom != null} onOpenChange={(o) => (o ? undefined : setCreateFrom(null))}>
        <DialogContent className="max-w-md">
          <DialogTitle>Novo álbum de olho</DialogTitle>
          <DialogDescription>
            {createFrom ? createFrom.m.title : ""} — informe qual disco é este lote. Ele passa a ser
            o lote de origem do novo álbum.
          </DialogDescription>
          {createFrom ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!createFrom.artist.trim() || !createFrom.album.trim()) {
                  toast.error("Informe artista e álbum");
                  return;
                }
                createMut.mutate(createFrom);
              }}
            >
              <Input
                value={createFrom.artist}
                onChange={(e) => setCreateFrom({ ...createFrom, artist: e.target.value })}
                placeholder="Artista"
              />
              <Input
                value={createFrom.album}
                onChange={(e) => setCreateFrom({ ...createFrom, album: e.target.value })}
                placeholder="Álbum"
                autoFocus
              />
              <Input
                value={createFrom.year}
                onChange={(e) => setCreateFrom({ ...createFrom, year: e.target.value })}
                placeholder="Ano (opcional)"
                inputMode="numeric"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setCreateFrom(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMut.isPending}>
                  Criar
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <LookoutLotDialog
        lot={openLot}
        item={openLot ? (items.find((i) => i.id === openLot.itemId) ?? null) : null}
        watching={openLot ? watchedIds.has(openLot.idPeca) : false}
        busy={openLot ? busyWatch === openLot.lotId : false}
        onWatch={(m) => void watchLot(m)}
        onClose={() => setOpenLotId(null)}
      />
    </main>
  );
}

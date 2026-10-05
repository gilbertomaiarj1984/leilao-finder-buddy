import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Binoculars, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { LookoutItemCard, type LookoutPatch } from "@/components/vinyl/lookout-item-card";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import {
  deleteLookout,
  markLookoutSeen,
  setLookoutLink,
  updateLookout,
} from "@/lib/lookout.functions";
import { notifyKey } from "@/lib/lookout-match";
import type { LookoutUpcoming } from "@/lib/lookout-matches.server";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import { queryKeys, useLookoutOverviewQuery } from "@/lib/queries";

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

  const query = useLookoutOverviewQuery({ history: true });
  const overview = query.data;
  const items = useMemo(() => overview?.items ?? [], [overview]);
  const active = items.filter((i) => i.status === "active");
  const archived = items.filter((i) => i.status !== "active");

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
  const resolveMut = useMutation({
    mutationFn: async (vars: { lotId: string; value: string | false }) =>
      await runLink({ data: vars }),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error((error as Error)?.message || "Não foi possível salvar"),
  });

  // Vigiar direto da página (reusa a server function da home). O estado "vigiando" é local à
  // visita — a vigia de verdade vive na conta do LeilõesBR.
  const [watchedIds, setWatchedIds] = useState<ReadonlySet<string>>(new Set());
  const [busyWatch, setBusyWatch] = useState<string | null>(null);
  const watchLot = async (m: LookoutUpcoming) => {
    const watch = !watchedIds.has(m.lotId);
    setBusyWatch(m.lotId);
    try {
      await runWatch({
        data: { idPeca: m.idPeca, idLeilao: m.idLeilao, base: m.base, watch },
      });
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (watch) next.add(m.lotId);
        else next.delete(m.lotId);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.watched });
      toast.success(watch ? "Vigiando este lote" : "Vigia removida");
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível alterar a vigia");
    } finally {
      setBusyWatch(null);
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
                <Button variant="ghost" size="sm" asChild>
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
            {active.map((item) => (
              <LookoutItemCard
                key={item.id}
                item={item}
                upcoming={upcomingByItem.get(item.id) ?? []}
                history={historyByItem.get(item.id) ?? []}
                watchedIds={watchedIds}
                busyWatch={busyWatch}
                onUpdate={(patch) => updateMut.mutate({ id: item.id, patch })}
                onDelete={() => deleteMut.mutate(item.id)}
                onWatch={(m) => void watchLot(m)}
                onResolve={(m, decision) =>
                  resolveMut.mutate({
                    lotId: m.lotId,
                    value: decision === "confirm" ? item.id : false,
                  })
                }
              />
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
                    busyWatch={busyWatch}
                    onUpdate={(patch) => updateMut.mutate({ id: item.id, patch })}
                    onDelete={() => deleteMut.mutate(item.id)}
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

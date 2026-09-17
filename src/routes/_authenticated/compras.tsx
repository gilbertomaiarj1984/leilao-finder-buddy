import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Calendar, List, RefreshCw, ShoppingBag, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { groupWatchedByHouse } from "@/components/vinyl/grouping";
import { PurchaseCard } from "@/components/vinyl/purchase-card";
import type { Purchase } from "@/lib/purchases.server";
import { getPurchases, scanPurchases, scanPurchasesFull } from "@/lib/purchases.functions";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Compras — Garimpo de Vinil" }] }),
  component: ComprasPage,
});

type ViewMode = "flat" | "day" | "house";

function dayHeaderLabel(day: string): string {
  if (!day) return "Sem data";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  return `${weekday.replace(".", "")} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function groupByDay(purchases: Purchase[]): { day: string; purchases: Purchase[] }[] {
  const map = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const key = p.wonDate ?? "";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([day, list]) => ({ day, purchases: list }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

function ComprasPage() {
  const [barsHidden, setBarsHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const queryClient = useQueryClient();
  const fetchPurchases = useServerFn(getPurchases);
  const scan = useServerFn(scanPurchases);
  const scanFull = useServerFn(scanPurchasesFull);

  const query = useQuery<Purchase[]>({
    queryKey: ["purchases"] as const,
    queryFn: () => fetchPurchases() as Promise<Purchase[]>,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const purchases = useMemo(() => query.data ?? [], [query.data]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["purchases"] });

  const onScanSuccess = (res: { added: number; scanned: number; auctionsChecked?: number }) => {
    void invalidate();
    toast.success(
      res.added > 0
        ? `${res.added} compra(s) adicionada(s).`
        : "Nada novo. Se você tem compras recentes e nada aparece, tente a varredura completa.",
    );
  };
  const onScanError = (e: Error) => toast.error(e.message || "Falha ao varrer as compras");

  const scanMut = useMutation({
    mutationFn: () => scan(),
    onSuccess: onScanSuccess,
    onError: onScanError,
  });

  const scanFullMut = useMutation({
    mutationFn: () => scanFull(),
    onSuccess: onScanSuccess,
    onError: onScanError,
  });

  const byDay = useMemo(() => groupByDay(purchases), [purchases]);
  // `groupWatchedByHouse` exige `houseUrl` (usado noutras telas p/ "site da casa"); aqui não
  // exibimos esse link (Purchase não tem a URL da casa, só do lote), então só satisfazemos o tipo.
  const byHouse = useMemo(
    () => groupWatchedByHouse(purchases.map((p) => ({ ...p, houseUrl: p.url }))),
    [purchases],
  );

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
                  <ShoppingBag className="h-5 w-5 text-primary" />
                  Compras
                </h1>
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Vinis arrematados ("Minhas compras"), mais recentes primeiro.
              </p>
            </div>
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
              <Button
                size="sm"
                onClick={() => scanMut.mutate()}
                disabled={scanMut.isPending}
                title="Varrer leilões vencidos (Meus lances) e atualizar as compras"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${scanMut.isPending ? "animate-spin" : ""}`} />
                {scanMut.isPending ? "Atualizando…" : "Atualizar"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => scanFullMut.mutate()}
                disabled={scanFullMut.isPending}
                title="Varredura completa de 'Minhas compras' (todas as páginas) — use se uma compra não aparecer"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${scanFullMut.isPending ? "animate-spin" : ""}`}
                />
                {scanFullMut.isPending ? "Varrendo…" : "Varredura completa"}
              </Button>
            </div>
          </div>

          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 pb-2 sm:gap-2 sm:pb-3">
            <ViewToggle
              icon={List}
              label="Mais recentes"
              active={viewMode === "flat"}
              onClick={() => setViewMode("flat")}
            />
            <ViewToggle
              icon={Calendar}
              label="Por dia"
              active={viewMode === "day"}
              onClick={() => setViewMode("day")}
            />
            <ViewToggle
              icon={Store}
              label="Por casa"
              active={viewMode === "house"}
              onClick={() => setViewMode("house")}
            />
            <span className="text-xs text-muted-foreground">{purchases.length} compra(s)</span>
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
        ) : purchases.length === 0 ? (
          <EmptyState onScan={() => scanMut.mutate()} scanning={scanMut.isPending} />
        ) : viewMode === "flat" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {purchases.map((p) => (
              <PurchaseCard key={p.id} purchase={p} />
            ))}
          </div>
        ) : viewMode === "day" ? (
          <div className="space-y-8">
            {byDay.map((group) => (
              <section key={group.day || "sem-data"}>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {dayHeaderLabel(group.day)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({group.purchases.length})
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.purchases.map((p) => (
                    <PurchaseCard key={p.id} purchase={p} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {byHouse.map((group) => (
              <section key={group.house}>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {group.house || "(casa não identificada)"}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({group.lots.length})
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.lots.map((p) => (
                    <PurchaseCard key={p.id} purchase={p} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function ViewToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof List;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
          : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
      }
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center">
      <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium text-foreground">Nenhuma compra encontrada.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Clique em "Atualizar" para varrer os leilões que você venceu.
      </p>
      <Button size="sm" className="mt-4" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Atualizando…" : "Atualizar"}
      </Button>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDashboardBaseline,
  getVinylLots,
  listMyBids,
  markDashboardSeen,
} from "@/lib/leiloesbr.functions";
import { listWatched } from "@/lib/leiloesbr-watch.functions";
import {
  auctionFinished,
  bidIsWinning,
  formatDayLabel,
  parsePrice,
  type VinylLot,
} from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Painel de mudanças — Garimpo de Vinil" }] }),
  component: DashboardPage,
});

type HouseGroup = { house: string; houseUrl: string; lots: VinylLot[] };

function groupByHouse(lots: VinylLot[]): HouseGroup[] {
  const byHouse = new Map<string, HouseGroup>();
  for (const lot of lots) {
    const group = byHouse.get(lot.house) ?? {
      house: lot.house,
      houseUrl: lot.houseUrl,
      lots: [],
    };
    group.lots.push(lot);
    byHouse.set(lot.house, group);
  }
  return [...byHouse.values()];
}

function houseAnchor(house: string, dayIndex: number): string {
  return `casa-${dayIndex}-${house.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const loteNum = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

type Delta =
  | { kind: "novo" }
  | { kind: "igual" }
  | { kind: "sem" }
  | { kind: "subiu" | "baixou"; diff: number };

function computeDelta(currentRaw: string, prevRaw: string | undefined): Delta {
  const cur = parsePrice(currentRaw);
  if (prevRaw === undefined) return { kind: "novo" };
  const prev = parsePrice(prevRaw);
  if (cur === null || prev === null) return { kind: "sem" };
  const diff = Math.round((cur - prev) * 100) / 100;
  if (diff === 0) return { kind: "igual" };
  return { kind: diff > 0 ? "subiu" : "baixou", diff: Math.abs(diff) };
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DeltaCell({ delta }: { delta: Delta }) {
  if (delta.kind === "novo")
    return <Badge variant="secondary" className="font-normal">novo</Badge>;
  if (delta.kind === "igual" || delta.kind === "sem")
    return <span className="text-muted-foreground">—</span>;
  const up = delta.kind === "subiu";
  return (
    <span className={up ? "font-medium text-amber-600 dark:text-amber-400" : "font-medium text-emerald-600 dark:text-emerald-400"}>
      {up ? "▲" : "▼"} R$ {brl(delta.diff)}
    </span>
  );
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const fetchLots = useServerFn(getVinylLots);
  const fetchWatched = useServerFn(listWatched);
  const fetchBids = useServerFn(listMyBids);
  const fetchBaseline = useServerFn(getDashboardBaseline);
  const runMarkSeen = useServerFn(markDashboardSeen);

  // Casas expandem/retraem (chave `${dia}|${casa}`), iniciam fechadas — igual à listagem.
  const [openHouses, setOpenHouses] = useState<Set<string>>(new Set());
  const toggleHouse = (key: string) =>
    setOpenHouses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const lots = useQuery({
    queryKey: ["vinyl-lots"] as const,
    queryFn: () => fetchLots(),
    staleTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const watched = useQuery({
    queryKey: ["vinyl-watched"] as const,
    queryFn: () => fetchWatched(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const bids = useQuery({
    queryKey: ["vinyl-my-bids"] as const,
    queryFn: () => fetchBids(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const baseline = useQuery({
    queryKey: ["dashboard-baseline"] as const,
    queryFn: () => fetchBaseline(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((w) => w.idPeca)),
    [watched.data],
  );
  const bidsById = useMemo(() => {
    const map = new Map<string, { myBid: string; status: string }>();
    for (const b of bids.data ?? []) map.set(b.idPeca, { myBid: b.myBid, status: b.status });
    return map;
  }, [bids.data]);
  // Nº do lote não vem na listagem geral; preenchemos com o que já lemos das
  // páginas de vigias (l=8) e meus lances (l=4), casando por idPeca.
  const loteById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of watched.data ?? []) if (w.lote) map.set(w.idPeca, w.lote);
    for (const b of bids.data ?? []) if (b.lote) map.set(b.idPeca, b.lote);
    return map;
  }, [watched.data, bids.data]);
  const loteOf = (lot: VinylLot) => lot.lote || loteById.get(lot.idPeca) || "";

  const prices = baseline.data?.prices ?? {};
  const days = lots.data?.days ?? [];
  const allLots = lots.data?.lots ?? [];

  // Prioridade: lote com lance (vermelho) primeiro, depois vigiado (amarelo), depois o resto.
  const rank = (lot: VinylLot) =>
    bidsById.has(lot.idPeca) ? 0 : watchedIds.has(lot.idPeca) ? 1 : 2;

  const markSeen = useMutation({
    mutationFn: async () => {
      const map: Record<string, string> = {};
      for (const lot of allLots) map[lot.id] = lot.price;
      return await runMarkSeen({ data: { prices: map } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard-baseline"] });
      toast.success("Marcado como visto — os valores atuais viram a nova base");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível marcar como visto"),
  });

  const seenAt = baseline.data?.seenAt
    ? new Date(baseline.data.seenAt).toLocaleString("pt-BR")
    : null;

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
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Painel de mudanças
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Por dia e casa de leilão. Amarelo = vigiado; vermelho = você já deu lance.
              {seenAt ? ` Último acesso: ${seenAt}.` : " Sem base de comparação ainda."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markSeen.mutate()}
            disabled={markSeen.isPending || !allLots.length}
            title="Marca os valores atuais como a nova base de comparação"
          >
            {markSeen.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Marcar como visto
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {lots.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : lots.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
            Não foi possível ler os lotes: {(lots.error as Error).message}
          </p>
        ) : (
          <Tabs defaultValue="day-0">
            <TabsList className="mb-6 flex h-auto flex-wrap justify-start gap-1 bg-secondary">
              {days.map((day, index) => (
                <TabsTrigger key={day} value={`day-${index}`}>
                  {formatDayLabel(day, days)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {allLots.filter((l) => l.dayKey === day).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {days.map((day, index) => {
              const dayLots = allLots.filter((l) => l.dayKey === day);
              const groups = groupByHouse(dayLots);
              // Ordena os lotes de cada casa por prioridade (vermelho, amarelo, resto) e nº do lote.
              for (const g of groups) {
                g.lots.sort(
                  (a, b) =>
                    rank(a) - rank(b) ||
                    loteNum(loteOf(a)) - loteNum(loteOf(b)) ||
                    loteOf(a).localeCompare(loteOf(b), "pt-BR"),
                );
              }
              // Ordena as casas: as que têm lance/vigia primeiro, depois por quantidade.
              const counts = (g: HouseGroup) => {
                let green = 0;
                let red = 0;
                let yellow = 0;
                for (const l of g.lots) {
                  const b = bidsById.get(l.idPeca);
                  if (b) {
                    if (bidIsWinning(b.status)) green++;
                    else red++;
                  } else if (watchedIds.has(l.idPeca)) yellow++;
                }
                return { green, red, yellow, bids: green + red };
              };
              const ordered = [...groups].sort((a, b) => {
                const ca = counts(a);
                const cb = counts(b);
                return (
                  (cb.bids > 0 ? 1 : 0) - (ca.bids > 0 ? 1 : 0) ||
                  cb.bids - ca.bids ||
                  (cb.yellow > 0 ? 1 : 0) - (ca.yellow > 0 ? 1 : 0) ||
                  cb.yellow - ca.yellow ||
                  b.lots.length - a.lots.length ||
                  a.house.localeCompare(b.house, "pt-BR")
                );
              });

              return (
                <TabsContent key={day} value={`day-${index}`} className="space-y-6">
                  {ordered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum lote neste dia.</p>
                  ) : (
                    <>
                      {/* Botões das casas no topo — clicar expande/retrai (e rola até a casa). */}
                      <nav className="sticky top-0 z-10 -mx-4 flex flex-nowrap gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
                        {ordered.map((group) => {
                          const key = `${day}|${group.house}`;
                          const isOpen = openHouses.has(key);
                          const c = counts(group);
                          return (
                            <button
                              key={group.house}
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => {
                                const willOpen = !openHouses.has(key);
                                toggleHouse(key);
                                if (willOpen) {
                                  requestAnimationFrame(() =>
                                    document
                                      .getElementById(houseAnchor(group.house, index))
                                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                                  );
                                }
                              }}
                              className={
                                isOpen
                                  ? "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                                  : "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-foreground transition-colors hover:border-primary hover:text-primary"
                              }
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                              )}
                              {c.green > 0 ? (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                              ) : c.red > 0 ? (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                              ) : c.yellow > 0 ? (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-yellow-500" />
                              ) : null}
                              {group.house}
                              <span className="text-muted-foreground">{group.lots.length}</span>
                            </button>
                          );
                        })}
                      </nav>

                      {ordered.map((group) => {
                        const key = `${day}|${group.house}`;
                        const isOpen = openHouses.has(key);
                        const c = counts(group);
                        return (
                          <section
                            key={group.house}
                            id={houseAnchor(group.house, index)}
                            className="scroll-mt-24 space-y-3"
                          >
                            <div className="flex flex-wrap items-center gap-3 border-b border-border pb-2">
                              <button
                                type="button"
                                onClick={() => toggleHouse(key)}
                                aria-expanded={isOpen}
                                className="flex items-center gap-2 text-left"
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-lg font-semibold tracking-tight text-foreground">
                                  {group.house}
                                </span>
                              </button>
                              <Badge variant="secondary">{group.lots.length} lote(s)</Badge>
                              {c.green > 0 ? (
                                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400" variant="secondary">
                                  {c.green} ganhando
                                </Badge>
                              ) : null}
                              {c.red > 0 ? (
                                <Badge className="bg-red-500/15 text-red-600 dark:text-red-400" variant="secondary">
                                  {c.red} coberto(s)
                                </Badge>
                              ) : null}
                              {c.yellow > 0 ? (
                                <Badge className="bg-yellow-400/20 text-yellow-700 dark:text-yellow-300" variant="secondary">
                                  {c.yellow} vigiado(s)
                                </Badge>
                              ) : null}
                              {group.houseUrl && group.houseUrl !== "#" ? (
                                <a
                                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  href={group.houseUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  site da casa <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </div>

                            {isOpen ? (
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] border-collapse text-sm">
                                  <thead>
                                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                                      <th className="px-2 py-2 font-medium">Lote</th>
                                      <th className="px-2 py-2 font-medium">Título</th>
                                      <th className="px-2 py-2 text-right font-medium">Últ. acesso</th>
                                      <th className="px-2 py-2 text-right font-medium">Atual</th>
                                      <th className="px-2 py-2 text-right font-medium">Variação</th>
                                      <th className="px-2 py-2 text-right font-medium">Meu lance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.lots.map((lot) => {
                                      const bid = bidsById.get(lot.idPeca);
                                      const winning = bid ? bidIsWinning(bid.status) : false;
                                      const isWatched = watchedIds.has(lot.idPeca);
                                      const delta = computeDelta(lot.price, prices[lot.id]);
                                      const finished = auctionFinished(lot.dayKey, lot.time);
                                      const rowClass = bid
                                        ? winning
                                          ? "border-l-4 border-green-500 bg-green-500/10"
                                          : "border-l-4 border-red-500 bg-red-500/10"
                                        : isWatched
                                          ? "border-l-4 border-yellow-500 bg-yellow-400/10"
                                          : "border-l-4 border-transparent";
                                      return (
                                        <tr
                                          key={lot.id}
                                          className={`border-b border-border/60 align-top ${rowClass} ${finished ? "opacity-60" : ""}`}
                                        >
                                          <td className="px-2 py-2 font-medium text-foreground">
                                            {loteOf(lot) || "—"}
                                          </td>
                                          <td className="px-2 py-2">
                                            <a
                                              href={lot.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="line-clamp-2 text-foreground hover:text-primary hover:underline"
                                              title={lot.title}
                                            >
                                              {lot.title}
                                            </a>
                                            {bid?.status ? (
                                              <span
                                                className={
                                                  winning
                                                    ? "mt-0.5 block text-xs text-green-600 dark:text-green-400"
                                                    : "mt-0.5 block text-xs text-red-600 dark:text-red-400"
                                                }
                                              >
                                                {bid.status}
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                                            {prices[lot.id] ?? "—"}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-primary">
                                            {lot.price || "sem valor"}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 text-right">
                                            <DeltaCell delta={delta} />
                                          </td>
                                          <td
                                            className={
                                              bid
                                                ? winning
                                                  ? "whitespace-nowrap px-2 py-2 text-right font-medium text-green-600 dark:text-green-400"
                                                  : "whitespace-nowrap px-2 py-2 text-right font-medium text-red-600 dark:text-red-400"
                                                : "whitespace-nowrap px-2 py-2 text-right text-muted-foreground"
                                            }
                                          >
                                            {bid?.myBid ?? "—"}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}

        {watched.isError || bids.isError ? (
          <p className="mt-4 text-xs text-muted-foreground">
            <RefreshCw className="mr-1 inline h-3 w-3" />
            Vigias/lances podem estar incompletos: não foi possível ler a conta agora.
          </p>
        ) : null}
      </div>
    </main>
  );
}

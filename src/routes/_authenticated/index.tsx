import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  LogOut,
  Radio,
  RefreshCw,
} from "lucide-react";
import { Component, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getAccessStatus, getLiveAuctions, getVinylLots } from "@/lib/leiloesbr.functions";
import { listWatched, toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { auctionFinished, UNCLASSIFIED_LABEL, type VinylLot } from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Garimpo de Vinil — leilões dos próximos 3 dias" },
      {
        name: "description",
        content:
          "Varredura dos lotes de disco de vinil em leilão no LeilõesBR nos próximos 3 dias, agrupados por dia, casa de leilão e artista, com vigia sincronizada.",
      },
      { property: "og:title", content: "Garimpo de Vinil — leilões dos próximos 3 dias" },
      {
        property: "og:description",
        content:
          "LPs, compactos e bolachões em leilão nos próximos 3 dias, organizados por dia, casa e artista.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

const lotsQuery = { queryKey: ["vinyl-lots"] as const };
const watchedQuery = { queryKey: ["vinyl-watched"] as const };
const liveQuery = { queryKey: ["vinyl-live-auctions"] as const };

/** Leilões que já começaram (somem da listagem pública) e tinham lotes de vinil. */
function LiveAuctions() {
  const fetchLive = useServerFn(getLiveAuctions);
  const live = useQuery({
    ...liveQuery,
    queryFn: () => fetchLive(),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const auctions = live.data ?? [];
  if (!auctions.length) return null;

  return (
    <section className="mb-8 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          Acontecendo agora
        </h2>
        <span className="text-xs text-muted-foreground">
          {auctions.length} leilão(ões) com vinil já iniciados
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {auctions.map((auction) => (
          <a
            key={auction.idLeilao}
            href={auction.entryUrl ?? auction.houseUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="group rounded-md border border-border bg-card p-3 transition hover:border-primary"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{auction.house}</p>
              <Radio className="h-4 w-4 shrink-0 text-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Início {auction.time}
              {auction.uf ? ` · ${auction.uf}` : ""} · {auction.lotCount} lote(s) de vinil
            </p>
            {auction.sampleTitles.length ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">
                {auction.sampleTitles.join(" · ")}
              </p>
            ) : null}
            <span className="mt-2 inline-flex items-center text-xs font-medium text-primary group-hover:underline">
              Entrar no leilão ao vivo
              <ExternalLink className="ml-1 h-3 w-3" />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}


function dayLabel(dayKey: string, index: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  const prefix = index === 0 ? "Hoje" : index === 1 ? "Amanhã" : weekday.replace(".", "");
  return `${prefix} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

type ArtistGroup = { artist: string; lots: VinylLot[] };
type HouseGroup = {
  house: string;
  houseUrl: string;
  time: string;
  lots: VinylLot[];
  artists: ArtistGroup[];
  count: number;
};

function groupByArtist(lots: VinylLot[]): ArtistGroup[] {
  const byArtist = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const key = lot.artist || UNCLASSIFIED_LABEL;
    const list = byArtist.get(key) ?? [];
    list.push(lot);
    byArtist.set(key, list);
  }
  return [...byArtist.entries()]
    .map(([artist, list]) => ({ artist, lots: list }))
    .sort((a, b) => {
      if (a.artist === UNCLASSIFIED_LABEL) return 1;
      if (b.artist === UNCLASSIFIED_LABEL) return -1;
      return a.artist.localeCompare(b.artist, "pt-BR");
    });
}

function groupByHouse(lots: VinylLot[]): HouseGroup[] {
  const houses = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const list = houses.get(lot.house) ?? [];
    list.push(lot);
    houses.set(lot.house, list);
  }

  return [...houses.entries()]
    .map(([house, houseLots]) => ({
      house,
      houseUrl: houseLots[0]?.houseUrl ?? "#",
      time: houseLots[0]?.time ?? "",
      lots: houseLots,
      artists: groupByArtist(houseLots),
      count: houseLots.length,
    }))
    .sort((a, b) => b.count - a.count || a.house.localeCompare(b.house, "pt-BR"));
}

// Faixas de valor por casa. Preço vem como "R$ 1.234,56" (BR): ponto de milhar,
// vírgula decimal. Lotes sem valor numérico entram na faixa "Menor de 50".
const PRICE_OPTIONS = [
  { value: "lt50", label: "Menor de 50" },
  { value: "r51_100", label: "De 51 a 100" },
  { value: "r101_150", label: "De 101 a 150" },
  { value: "gt150", label: "Acima de 150" },
] as const;

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function matchesPriceRange(raw: string, range: string): boolean {
  if (!range) return true;
  const value = parsePrice(raw);
  if (value === null) return range === "lt50"; // sem valor: sempre visível, na faixa "Menor de 50"
  if (range === "lt50") return value <= 50;
  if (range === "r51_100") return value > 50 && value <= 100;
  if (range === "r101_150") return value > 100 && value <= 150;
  return value > 150; // gt150
}

function houseAnchor(house: string, dayIndex: number): string {
  return `casa-${dayIndex}-${house.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function artistOptions(lots: VinylLot[]): { artist: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    const key = lot.artist || UNCLASSIFIED_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => {
      if (a.artist === UNCLASSIFIED_LABEL) return 1;
      if (b.artist === UNCLASSIFIED_LABEL) return -1;
      return a.artist.localeCompare(b.artist, "pt-BR");
    });
}

function ArtistFilter({
  artists,
  value,
  onChange,
  disabled = false,
}: {
  artists: { artist: string; count: number }[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between sm:w-72"
        >
          <span className="truncate">{value || `Todos os artistas (${artists.length})`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,90vw)] p-0">
        <Command>
          <CommandInput placeholder="Buscar artista..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum artista encontrado.</CommandEmpty>
            <CommandItem
              value="__todos"
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <Check className={value ? "mr-2 h-4 w-4 opacity-0" : "mr-2 h-4 w-4"} />
              Todos os artistas
            </CommandItem>
            {artists.map((item) => (
              <CommandItem
                key={item.artist}
                value={item.artist}
                onSelect={() => {
                  onChange(item.artist === value ? "" : item.artist);
                  setOpen(false);
                }}
              >
                <Check
                  className={
                    value === item.artist ? "mr-2 h-4 w-4" : "mr-2 h-4 w-4 opacity-0"
                  }
                />
                <span className="truncate">{item.artist}</span>
                <span className="ml-auto text-xs text-muted-foreground">{item.count}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PriceFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <Select
      value={value || "__all"}
      onValueChange={(next) => onChange(next === "__all" ? "" : next)}
    >
      <SelectTrigger className="w-full sm:w-44">
        <SelectValue placeholder="Todos os valores" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">Todos os valores</SelectItem>
        {PRICE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const queryClientForAuth = useQueryClient();
  const fetchAccess = useServerFn(getAccessStatus);
  const access = useQuery({
    queryKey: ["access-status"] as const,
    queryFn: () => fetchAccess(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  async function signOut() {
    await queryClientForAuth.cancelQueries();
    queryClientForAuth.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  if (access.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (access.isError || !access.data?.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Acesso não autorizado</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {access.data?.email
              ? `A conta ${access.data.email} não é o e-mail cadastrado nas casas de leilão.`
              : "Não foi possível validar o seu acesso."}
          </p>
          <Button className="mt-6 w-full" variant="outline" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair e trocar de conta
          </Button>
        </div>
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <VinylDashboard onSignOut={signOut} email={access.data.email} />
    </ErrorBoundary>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("[ui] erro de renderização", error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <h1 className="text-lg font-semibold text-foreground">Algo quebrou ao renderizar</h1>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {this.state.error.message}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
              Recarregar
            </Button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

/** "dd/mm/yyyy" (vigiados) -> "yyyy-mm-dd" (dayKey). */
function watchedDateToKey(value: string): string {
  const [dd, mm, yy] = value.split("/");
  return yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
}

function VinylDashboard({ onSignOut, email }: { onSignOut: () => Promise<void>; email: string }) {
  const [tab, setTab] = useState<string>("day-0");
  const [artistFilter, setArtistFilter] = useState<string>("");
  const [watchedViewDay, setWatchedViewDay] = useState<string | null>(null);
  // Estado por casa (chave `${dia}|${casa}`): casas iniciam fechadas.
  const [openHouses, setOpenHouses] = useState<Set<string>>(new Set());
  const [houseArtist, setHouseArtist] = useState<Record<string, string>>({});
  const [housePrice, setHousePrice] = useState<Record<string, string>>({});
  const toggleHouse = (key: string) =>
    setOpenHouses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setHouseArtistFor = (key: string, value: string) =>
    setHouseArtist((prev) => ({ ...prev, [key]: value }));
  const setHousePriceFor = (key: string, value: string) =>
    setHousePrice((prev) => ({ ...prev, [key]: value }));
  const queryClient = useQueryClient();
  const fetchLots = useServerFn(getVinylLots);
  const fetchWatched = useServerFn(listWatched);
  const runToggle = useServerFn(toggleWatch);

  const lots = useQuery({ ...lotsQuery, queryFn: () => fetchLots(), staleTime: 10 * 60 * 1000 });
  const watched = useQuery({
    ...watchedQuery,
    queryFn: () => fetchWatched(),
    staleTime: 60 * 1000,
  });

  const [pending, setPending] = useState<string | null>(null);
  const [refreshingDay, setRefreshingDay] = useState<string | null>(null);

  const refreshDay = (day: string) => {
    void (async () => {
      setRefreshingDay(day);
      try {
        const fresh = await fetchLots({ data: { force: true, day } });
        queryClient.setQueryData(lotsQuery.queryKey, fresh);
        toast.success("Dia atualizado");
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar este dia agora");
      } finally {
        setRefreshingDay(null);
        void queryClient.invalidateQueries({ queryKey: watchedQuery.queryKey });
      }
    })();
  };


  const toggle = useMutation({
    mutationFn: async (lot: { idPeca: string; idLeilao: string; base: string; watch: boolean }) =>
      await runToggle({ data: lot }),
    onMutate: (lot) => setPending(lot.idPeca),
    onSuccess: (result, lot) => {
      queryClient.setQueryData(lotsQuery.queryKey, (old: typeof lots.data) =>
        old
          ? {
              ...old,
              lots: old.lots.map((item) =>
                item.idPeca === lot.idPeca ? { ...item, watched: result.watched } : item,
              ),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: watchedQuery.queryKey });
      toast.success(result.watched ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível sincronizar a vigia"),
    onSettled: () => setPending(null),
  });

  const days = lots.data?.days ?? [];
  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((item) => item.idPeca)),
    [watched.data],
  );

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-8">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-primary">LeilõesBR</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">
              Garimpo de Vinil
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              LPs, compactos e bolachões que vão a leilão nos próximos 3 dias, agrupados por dia,
              casa de leilão e artista. A vigia é sincronizada com a sua conta do LeilõesBR.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <span className="text-xs text-muted-foreground">{email}</span>
            <Button variant="ghost" size="sm" onClick={() => void onSignOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        <LiveAuctions />

        {lots.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
            Não foi possível ler o LeilõesBR agora: {(lots.error as Error).message}
          </p>
        ) : lots.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full max-w-md" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              setArtistFilter("");
            }}
          >
            <TabsList className="mb-6 flex h-auto flex-wrap justify-start gap-1 bg-secondary">
              {days.map((day, index) => (
                <TabsTrigger key={day} value={`day-${index}`}>
                  {dayLabel(day, index)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {lots.data?.lots.filter(
                      (lot) => lot.dayKey === day && !auctionFinished(lot.dayKey, lot.time),
                    ).length ?? 0}
                  </span>
                </TabsTrigger>
              ))}
              <TabsTrigger value="watched">
                Vigiados
                <span className="ml-2 text-xs text-muted-foreground">{watchedIds.size}</span>
              </TabsTrigger>
            </TabsList>

            {days.map((day, index) => {
              const dayLots = (lots.data?.lots ?? [])
                .map((lot) =>
                  watchedIds.size ? { ...lot, watched: watchedIds.has(lot.idPeca) } : lot,
                )
                // Remove das listagens os leilões finalizados (3h após o início).
                .filter((lot) => lot.dayKey === day && !auctionFinished(lot.dayKey, lot.time));
              const artists = artistOptions(dayLots);
              const globalActive = artistFilter !== "";
              const visibleLots = globalActive
                ? dayLots.filter((lot) => (lot.artist || UNCLASSIFIED_LABEL) === artistFilter)
                : dayLots;
              const groups = groupByHouse(visibleLots);
              const isWatchedView = watchedViewDay === day;
              const watchedForDay = (watched.data ?? []).filter(
                (lot) => watchedDateToKey(lot.date) === day,
              );
              // Vigiados do dia agrupados por casa e ordenados por nº do lote.
              const watchedByHouse = (() => {
                const byHouse = new Map<
                  string,
                  { house: string; houseUrl: string; lots: typeof watchedForDay }
                >();
                for (const lot of watchedForDay) {
                  const group =
                    byHouse.get(lot.house) ??
                    { house: lot.house, houseUrl: lot.houseUrl, lots: [] as typeof watchedForDay };
                  group.lots.push(lot);
                  byHouse.set(lot.house, group);
                }
                const num = (value: string) => {
                  const n = Number(value);
                  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
                };
                for (const group of byHouse.values()) {
                  group.lots.sort(
                    (a, b) => num(a.lote) - num(b.lote) || a.lote.localeCompare(b.lote, "pt-BR"),
                  );
                }
                return [...byHouse.values()].sort(
                  (a, b) => b.lots.length - a.lots.length || a.house.localeCompare(b.house, "pt-BR"),
                );
              })();

              return (
                <TabsContent key={day} value={`day-${index}`} className="space-y-6">
                  <div className="sticky top-0 z-20 -mx-4 mb-2 space-y-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => refreshDay(day)}
                        disabled={refreshingDay === day}
                        title="Atualizar este dia"
                        aria-label={`Atualizar ${dayLabel(day, index)}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                      >
                        {refreshingDay === day ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {dayLabel(day, index)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWatchedViewDay((cur) => (cur === day ? null : day))}
                        title="Ver vigiados deste dia"
                        aria-label={`Ver vigiados de ${dayLabel(day, index)}`}
                        aria-pressed={isWatchedView}
                        className={
                          isWatchedView
                            ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                            : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Vigiados do dia
                        {watchedForDay.length ? (
                          <span className="ml-0.5 text-muted-foreground">
                            {watchedForDay.length}
                          </span>
                        ) : null}
                      </button>
                      {!isWatchedView ? (
                        <>
                          <ArtistFilter
                            artists={artists}
                            value={artistFilter}
                            onChange={setArtistFilter}
                          />
                          {artistFilter ? (
                            <Button variant="ghost" size="sm" onClick={() => setArtistFilter("")}>
                              Limpar filtro
                            </Button>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            {visibleLots.length} lote(s) em {groups.length} casa(s)
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {watchedForDay.length} lote(s) vigiado(s) neste dia
                        </span>
                      )}
                    </div>
                    {!isWatchedView && groups.length > 0 ? (
                      <nav className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                        {groups.map((group) => (
                          <a
                            key={group.house}
                            href={`#${houseAnchor(group.house, index)}`}
                            className="shrink-0 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            {group.house}
                            <span className="ml-1.5 text-muted-foreground">{group.count}</span>
                          </a>
                        ))}
                      </nav>
                    ) : null}
                  </div>
                  {isWatchedView ? (
                    watched.isLoading ? (
                      <Skeleton className="h-40 w-full" />
                    ) : watchedForDay.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum lote vigiado neste dia.</p>
                    ) : (
                      <div className="space-y-8">
                        {watchedByHouse.map((houseGroup) => (
                          <section key={houseGroup.house} className="space-y-3">
                            <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                                {houseGroup.house}
                              </h2>
                              <Badge variant="secondary">{houseGroup.lots.length} lote(s)</Badge>
                              <a
                                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                href={houseGroup.houseUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                site da casa <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {houseGroup.lots.map((lot) => (
                                <LotCard
                                  key={lot.id}
                                  lot={{ ...lot, dayKey: lot.date, watched: true }}
                                  busy={pending === lot.idPeca}
                                  onToggle={() =>
                                    toggle.mutate({
                                      idPeca: lot.idPeca,
                                      idLeilao: lot.idLeilao,
                                      base: lot.base,
                                      watch: false,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    )
                  ) : groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {artistFilter
                        ? "Nenhum lote deste artista neste dia."
                        : "Nenhum disco de vinil encontrado para este dia."}
                    </p>
                  ) : (
                    groups.map((group) => {
                      const houseKey = `${day}|${group.house}`;
                      const isOpen = openHouses.has(houseKey);
                      const perArtist = globalActive ? "" : houseArtist[houseKey] ?? "";
                      const perPrice = housePrice[houseKey] ?? "";
                      let houseLots = group.lots;
                      if (perArtist)
                        houseLots = houseLots.filter(
                          (lot) => (lot.artist || UNCLASSIFIED_LABEL) === perArtist,
                        );
                      if (perPrice)
                        houseLots = houseLots.filter((lot) => matchesPriceRange(lot.price, perPrice));
                      const artistGroups = groupByArtist(houseLots);

                      return (
                        <section
                          key={group.house}
                          id={houseAnchor(group.house, index)}
                          className="scroll-mt-32 space-y-4"
                        >
                          <div className="space-y-3 border-b border-border pb-2">
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => toggleHouse(houseKey)}
                                aria-expanded={isOpen}
                                className="flex items-center gap-2 text-left"
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-2xl font-semibold tracking-tight text-foreground">
                                  {group.house}
                                </span>
                              </button>
                              <Badge variant="secondary">{houseLots.length} lotes</Badge>
                              {group.time ? (
                                <span className="text-sm text-muted-foreground">às {group.time}</span>
                              ) : null}
                              <a
                                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                href={group.houseUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                site da casa <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                            {isOpen ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <ArtistFilter
                                  artists={artistOptions(group.lots)}
                                  value={perArtist}
                                  onChange={(next) => setHouseArtistFor(houseKey, next)}
                                  disabled={globalActive}
                                />
                                <PriceFilter
                                  value={perPrice}
                                  onChange={(next) => setHousePriceFor(houseKey, next)}
                                />
                                {globalActive ? (
                                  <span className="text-xs text-muted-foreground">
                                    filtro de artista global ativo
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {isOpen ? (
                            artistGroups.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                Nenhum lote com esses filtros nesta casa.
                              </p>
                            ) : (
                              artistGroups.map((artistGroup) => (
                                <div key={artistGroup.artist} className="space-y-3">
                                  <h3
                                    className={
                                      artistGroup.artist === UNCLASSIFIED_LABEL
                                        ? "text-sm font-medium uppercase tracking-wider text-muted-foreground"
                                        : "text-sm font-semibold uppercase tracking-wider text-primary"
                                    }
                                  >
                                    {artistGroup.artist}
                                    <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                                      {artistGroup.lots.length}
                                    </span>
                                  </h3>
                                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {artistGroup.lots.map((lot) => (
                                      <LotCard
                                        key={lot.id}
                                        lot={lot}
                                        busy={pending === lot.idPeca}
                                        onToggle={() =>
                                          toggle.mutate({
                                            idPeca: lot.idPeca,
                                            idLeilao: lot.idLeilao,
                                            base: lot.base,
                                            watch: !lot.watched,
                                          })
                                        }
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))
                            )
                          ) : null}
                        </section>
                      );
                    })
                  )}
                </TabsContent>
              );
            })}

            <TabsContent value="watched" className="space-y-4">
              {watched.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : watched.isError ? (
                <p className="text-sm text-destructive">
                  Não foi possível ler os vigiados: {(watched.error as Error).message}
                </p>
              ) : (watched.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Você ainda não está vigiando nenhum lote.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(watched.data ?? []).map((lot) => (
                    <LotCard
                      key={lot.id}
                      lot={{
                        ...lot,
                        dayKey: lot.date,
                        watched: true,
                      }}
                      busy={pending === lot.idPeca}
                      onToggle={() =>
                        toggle.mutate({
                          idPeca: lot.idPeca,
                          idLeilao: lot.idLeilao,
                          base: lot.base,
                          watch: false,
                        })
                      }
                      showDate
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
}

type CardLot = {
  title: string;
  url: string;
  image: string | null;
  price: string;
  time: string;
  house: string;
  uf: string;
  dayKey: string;
  watched: boolean;
  lote?: string;
};

function LotCard({
  lot,
  busy,
  onToggle,
  showDate = false,
}: {
  lot: CardLot;
  busy: boolean;
  onToggle: () => void;
  showDate?: boolean;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <a href={lot.url} target="_blank" rel="noreferrer" className="block bg-secondary">
        {lot.image ? (
          <img
            src={lot.image}
            alt={lot.title}
            loading="lazy"
            className="h-44 w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            sem imagem
          </div>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-3 text-sm leading-snug text-foreground">{lot.title}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {lot.lote ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
              Lote {lot.lote}
            </span>
          ) : null}
          <span className="font-semibold text-primary">{lot.price || "sem valor"}</span>
          {showDate && lot.dayKey ? <span>{lot.dayKey}</span> : null}
          {lot.time ? <span>{lot.time}</span> : null}
          {lot.uf ? <span>{lot.uf}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={lot.watched ? "default" : "outline"}
            className="flex-1"
            onClick={onToggle}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : lot.watched ? (
              <EyeOff className="mr-2 h-4 w-4" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            {lot.watched ? "Vigiando" : "Vigiar"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={lot.url} target="_blank" rel="noreferrer" aria-label="Abrir lote no leiloeiro">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}

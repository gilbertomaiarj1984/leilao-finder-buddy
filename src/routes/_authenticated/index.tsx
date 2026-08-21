import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronsUpDown, Eye, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getVinylLots } from "@/lib/leiloesbr.functions";
import { listWatched, toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { UNCLASSIFIED_LABEL, type VinylLot } from "@/lib/vinyl-parse";

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

function dayLabel(dayKey: string, index: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  const prefix = index === 0 ? "Hoje" : index === 1 ? "Amanhã" : weekday.replace(".", "");
  return `${prefix} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

type ArtistGroup = { artist: string; lots: VinylLot[] };
type HouseGroup = { house: string; houseUrl: string; time: string; artists: ArtistGroup[]; count: number };

function groupByHouse(lots: VinylLot[]): HouseGroup[] {
  const houses = new Map<string, VinylLot[]>();
  for (const lot of lots) {
    const list = houses.get(lot.house) ?? [];
    list.push(lot);
    houses.set(lot.house, list);
  }

  return [...houses.entries()]
    .map(([house, houseLots]) => {
      const byArtist = new Map<string, VinylLot[]>();
      for (const lot of houseLots) {
        const key = lot.artist || UNCLASSIFIED_LABEL;
        const list = byArtist.get(key) ?? [];
        list.push(lot);
        byArtist.set(key, list);
      }
      const artists = [...byArtist.entries()]
        .map(([artist, list]) => ({ artist, lots: list }))
        .sort((a, b) => {
          if (a.artist === UNCLASSIFIED_LABEL) return 1;
          if (b.artist === UNCLASSIFIED_LABEL) return -1;
          return a.artist.localeCompare(b.artist, "pt-BR");
        });
      return {
        house,
        houseUrl: houseLots[0]?.houseUrl ?? "#",
        time: houseLots[0]?.time ?? "",
        artists,
        count: houseLots.length,
      };
    })
    .sort((a, b) => b.count - a.count || a.house.localeCompare(b.house, "pt-BR"));
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
}: {
  artists: { artist: string; count: number }[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
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

function HomePage() {
  const [tab, setTab] = useState<string>("day-0");
  const [artistFilter, setArtistFilter] = useState<string>("");
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
          <Button
            variant="outline"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: lotsQuery.queryKey });
              void queryClient.invalidateQueries({ queryKey: watchedQuery.queryKey });
            }}
            disabled={lots.isFetching}
          >
            {lots.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar varredura
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
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
                    {lots.data?.lots.filter((lot) => lot.dayKey === day).length ?? 0}
                  </span>
                </TabsTrigger>
              ))}
              <TabsTrigger value="watched">
                Vigiados
                <span className="ml-2 text-xs text-muted-foreground">{watchedIds.size}</span>
              </TabsTrigger>
            </TabsList>

            {days.map((day, index) => {
              const dayLots = (lots.data?.lots ?? []).map((lot) =>
                watchedIds.size ? { ...lot, watched: watchedIds.has(lot.idPeca) } : lot,
              ).filter((lot) => lot.dayKey === day);
              const artists = artistOptions(dayLots);
              const visibleLots = artistFilter
                ? dayLots.filter((lot) => (lot.artist || UNCLASSIFIED_LABEL) === artistFilter)
                : dayLots;
              const groups = groupByHouse(visibleLots);

              return (
                <TabsContent key={day} value={`day-${index}`} className="space-y-10">
                  <div className="sticky top-0 z-20 -mx-4 mb-2 space-y-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <div className="flex flex-wrap items-center gap-3">
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
                    </div>
                    {groups.length > 0 ? (
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
                  {groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {artistFilter
                        ? "Nenhum lote deste artista neste dia."
                        : "Nenhum disco de vinil encontrado para este dia."}
                    </p>
                  ) : (
                    groups.map((group) => (
                      <section
                        key={group.house}
                        id={houseAnchor(group.house, index)}
                        className="scroll-mt-32 space-y-5"
                      >
                        <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                            {group.house}
                          </h2>
                          <Badge variant="secondary">{group.count} lotes</Badge>
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

                        {group.artists.map((artistGroup) => (
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
                        ))}
                      </section>
                    ))
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

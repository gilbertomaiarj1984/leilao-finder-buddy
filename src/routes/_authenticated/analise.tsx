import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Sparkles,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreChips, ScoreDetails } from "@/components/vinyl/ai-score";
import { buildInterestMatcher, scoreTone, type LotAi } from "@/components/vinyl/ai-score-utils";
import { houseAnchor } from "@/components/vinyl/grouping";
import {
  getLotAi,
  getUserInterests,
  getVinylLots,
  setUserInterests,
} from "@/lib/leiloesbr.functions";
import { formatDayLabel, type VinylLot } from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise de Lotes — Garimpo de Vinil" }] }),
  component: AnalisePage,
});

const TOP_N = 100;

type HouseGroup = { house: string; houseUrl: string; lots: VinylLot[] };

function groupByHouse(lots: VinylLot[]): HouseGroup[] {
  const byHouse = new Map<string, HouseGroup>();
  for (const lot of lots) {
    const group = byHouse.get(lot.house) ?? { house: lot.house, houseUrl: lot.houseUrl, lots: [] };
    group.lots.push(lot);
    byHouse.set(lot.house, group);
  }
  return [...byHouse.values()];
}

function LotTitle({ lot }: { lot: VinylLot }) {
  return (
    <a
      href={lot.url}
      target="_blank"
      rel="noreferrer"
      className="line-clamp-2 text-foreground hover:text-primary hover:underline"
      title={lot.title}
    >
      {lot.title}
    </a>
  );
}

function InterestsDialog({
  interests,
  onSave,
  saving,
}: {
  interests: string[];
  onSave: (items: string[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setText(interests.join("\n"));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Star className="mr-2 h-4 w-4" />
          Meus interesses
          {interests.length ? (
            <Badge variant="secondary" className="ml-2">
              {interests.length}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meus interesses</DialogTitle>
          <DialogDescription>
            Um por linha: artistas, álbuns ou gêneros que você curte. Os lotes que combinam ganham
            destaque (⭐) na nota.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={"Ex.:\nRaul Seixas\nJazz\nClube da Esquina\nTim Maia"}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(text.split("\n"));
              setOpen(false);
            }}
            disabled={saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnalisePage() {
  const queryClient = useQueryClient();
  const fetchLots = useServerFn(getVinylLots);
  const fetchLotAi = useServerFn(getLotAi);
  const fetchInterests = useServerFn(getUserInterests);
  const saveInterests = useServerFn(setUserInterests);

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
  const lotAiQuery = useQuery({
    queryKey: ["lot-ai"] as const,
    queryFn: () => fetchLotAi(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const interestsQuery = useQuery({
    queryKey: ["user-interests"] as const,
    queryFn: () => fetchInterests(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const saveInterestsMut = useMutation({
    mutationFn: (items: string[]) => saveInterests({ data: { items } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-interests"] });
      toast.success("Interesses salvos");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  const aiById = useMemo(() => {
    const map = new Map<string, LotAi>();
    for (const r of lotAiQuery.data ?? [])
      map.set(r.id, {
        score: r.score,
        rarity: r.rarity,
        deal: r.deal,
        album: r.album,
        reason: r.reason,
        tags: r.tags,
      });
    return map;
  }, [lotAiQuery.data]);
  const matchesInterest = useMemo(
    () => buildInterestMatcher(interestsQuery.data ?? []),
    [interestsQuery.data],
  );
  const aiFor = (lot: VinylLot): LotAi | undefined => {
    const base = aiById.get(lot.id);
    if (!base) return undefined;
    return { ...base, matchesInterests: matchesInterest(lot.title) };
  };
  // Score para ordenação: sem avaliação vai para o fim (-1).
  const scoreOf = (lot: VinylLot) => aiById.get(lot.id)?.score ?? -1;

  const days = lots.data?.days ?? [];
  const allLots = lots.data?.lots ?? [];

  // Top 100: só lotes já avaliados, maior nota primeiro.
  const top = useMemo(
    () =>
      [...allLots]
        .filter((l) => (aiById.get(l.id)?.score ?? null) !== null)
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, TOP_N),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allLots, aiById],
  );

  const evaluated = aiById.size;

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
                <Sparkles className="h-5 w-5 text-primary" />
                Análise de Lotes
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Lotes ranqueados por nota da IA (raridade + oportunidade). ⭐ = combina com seus
              interesses.{" "}
              {evaluated ? `${evaluated} lote(s) avaliado(s).` : "Ainda sem avaliações."}
            </p>
          </div>
          <InterestsDialog
            interests={interestsQuery.data ?? []}
            onSave={(items) => saveInterestsMut.mutate(items)}
            saving={saveInterestsMut.isPending}
          />
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
        ) : evaluated === 0 ? (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum lote avaliado ainda. A avaliação roda em segundo plano (atualização periódica);
            volte após a próxima rodada.
          </p>
        ) : (
          <div className="space-y-8">
            {/* ------- Top 100 ------- */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                <Star className="h-5 w-5 text-primary" />
                Top {Math.min(TOP_N, top.length)} — melhores oportunidades
              </h2>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Nota</th>
                      <th className="px-3 py-2 font-medium">Título</th>
                      <th className="px-3 py-2 font-medium">Casa / dia</th>
                      <th className="px-3 py-2 text-right font-medium">Atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((lot, i) => {
                      const ai = aiFor(lot)!;
                      return (
                        <tr key={lot.id} className="border-t border-border/60 align-top">
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2">
                            <ScoreChips ai={ai} />
                            {ai.reason ? (
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                {ai.reason}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <LotTitle lot={lot} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {lot.house}
                            <br />
                            {formatDayLabel(lot.dayKey, days)} · {lot.time}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-primary">
                            {lot.price || "sem valor"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ------- Por dia → casa (ordenado por nota) ------- */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Por dia e casa de leilão
              </h2>
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
                  for (const g of groups) g.lots.sort((a, b) => scoreOf(b) - scoreOf(a));
                  // Melhor nota da casa (para ordenar as casas).
                  const bestScore = (g: HouseGroup) => (g.lots.length ? scoreOf(g.lots[0]!) : -1);
                  const ordered = [...groups].sort(
                    (a, b) =>
                      bestScore(b) - bestScore(a) || a.house.localeCompare(b.house, "pt-BR"),
                  );

                  return (
                    <TabsContent key={day} value={`day-${index}`} className="space-y-6">
                      {ordered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum lote neste dia.</p>
                      ) : (
                        <>
                          <nav className="sticky top-0 z-10 -mx-4 flex flex-nowrap gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
                            {ordered.map((group) => {
                              const key = `${day}|${group.house}`;
                              const isOpen = openHouses.has(key);
                              const best = bestScore(group);
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
                                  {best >= 0 ? (
                                    <span
                                      className={`rounded px-1 text-[10px] font-bold ${scoreTone(best)}`}
                                    >
                                      {best}
                                    </span>
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
                                          <th className="px-2 py-2 font-medium">Nota</th>
                                          <th className="px-2 py-2 font-medium">Lote</th>
                                          <th className="px-2 py-2 font-medium">Título</th>
                                          <th className="px-2 py-2 text-right font-medium">
                                            Atual
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.lots.map((lot) => {
                                          const ai = aiFor(lot);
                                          return (
                                            <tr
                                              key={lot.id}
                                              className="border-b border-border/60 align-top"
                                            >
                                              <td className="px-2 py-2">
                                                {ai ? (
                                                  <ScoreDetails ai={ai} />
                                                ) : (
                                                  <span className="text-muted-foreground">—</span>
                                                )}
                                              </td>
                                              <td className="px-2 py-2 font-medium text-foreground">
                                                {lot.lote || "—"}
                                              </td>
                                              <td className="px-2 py-2">
                                                <LotTitle lot={lot} />
                                              </td>
                                              <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-primary">
                                                {lot.price || "sem valor"}
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
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

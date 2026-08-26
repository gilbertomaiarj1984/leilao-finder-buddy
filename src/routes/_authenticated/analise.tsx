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
  Pencil,
  Sparkles,
  Star,
  Target,
  Trash2,
  X,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreChips, ScoreDetails } from "@/components/vinyl/ai-score";
import {
  buildInterestMatcher,
  buildWantlistMatcher,
  dealLabel,
  dealTone,
  marketDeal,
  scoreInRange,
  scoreTone,
  toLotMarket,
  type LotAi,
  type LotMarket,
  type ScoreRange,
} from "@/components/vinyl/ai-score-utils";
import { houseAnchor } from "@/components/vinyl/grouping";
import {
  deleteWantlist,
  getLotAi,
  getLotMarket,
  getUserInterests,
  getVinylLots,
  getWantlist,
  importWantlist,
  setUserInterests,
  updateWantlist,
} from "@/lib/leiloesbr.functions";
import { formatDayLabel, normalizeForMatch, type VinylLot } from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise de Lotes — Garimpo de Vinil" }] }),
  component: AnalisePage,
});

const TOP_N = 100;

type WantItem = {
  id: string;
  label: string;
  note: string | null;
  year: number | null;
  acquired: boolean;
};
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

const inputClass =
  "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

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
          Interesses
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

/** Dialog da sondagem: importar rascunho em texto + gerenciar (buscar/editar/adquirido/excluir). */
function WantlistDialog({ items }: { items: WantItem[] }) {
  const queryClient = useQueryClient();
  const runImport = useServerFn(importWantlist);
  const runUpdate = useServerFn(updateWantlist);
  const runDelete = useServerFn(deleteWantlist);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"manage" | "import">("manage");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["wantlist"] });
  };

  const importMut = useMutation({
    mutationFn: (text: string) => runImport({ data: { text } }),
    onSuccess: (res: { added: number }) => {
      invalidate();
      setDraft("");
      setTab("manage");
      toast.success(`${res.added} item(ns) adicionado(s)`);
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao importar"),
  });
  const updateMut = useMutation({
    mutationFn: (v: { id: string; label?: string; acquired?: boolean }) => runUpdate({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message || "Falha ao salvar"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => runDelete({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message || "Falha ao excluir"),
  });

  const filtered = useMemo(() => {
    const q = normalizeForMatch(search);
    if (!q) return items;
    return items.filter((i) => normalizeForMatch(`${i.label} ${i.note ?? ""}`).includes(q));
  }, [items, search]);
  const pending = items.filter((i) => !i.acquired).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Target className="mr-2 h-4 w-4" />
          Sondagem
          {items.length ? (
            <Badge variant="secondary" className="ml-2">
              {pending}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Sondagem — obras que estou caçando</DialogTitle>
          <DialogDescription>
            Suba um rascunho em texto (uma obra por linha). Os lotes que casam ganham destaque na
            Análise. Marque o que já adquiriu para tirar do radar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1">
          <Button
            size="sm"
            variant={tab === "manage" ? "default" : "outline"}
            onClick={() => setTab("manage")}
          >
            Lista ({items.length})
          </Button>
          <Button
            size="sm"
            variant={tab === "import" ? "default" : "outline"}
            onClick={() => setTab("import")}
          >
            Importar texto
          </Button>
        </div>

        {tab === "import" ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              placeholder={
                "01. Tim Maia (1970)\n02. Tim Maia (1973)\n03. Tim Maia Racional, Vol. 1 (1975 - Fase Cult/Rara)\n[Bônus/Cult: Tim Maia Racional, Vol. 2 (1975)]"
              }
              className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              A numeração (01., 02.) e os colchetes são removidos; o ano entre parênteses vira campo
              próprio. Duplicatas (mesmo título + ano) são ignoradas.
            </p>
            <DialogFooter>
              <Button
                onClick={() => importMut.mutate(draft)}
                disabled={importMut.isPending || !draft.trim()}
              >
                {importMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Importar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar na sondagem…"
              className="h-9"
            />
            <div className="max-h-[45vh] space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {items.length ? "Nada encontrado." : "Sondagem vazia — importe um rascunho."}
                </p>
              ) : (
                filtered.map((it) => (
                  <div
                    key={it.id}
                    className={`flex items-center gap-2 rounded-md border border-border px-2 py-1.5 ${it.acquired ? "opacity-60" : ""}`}
                  >
                    <button
                      type="button"
                      aria-label={
                        it.acquired ? "Marcar como não adquirido" : "Marcar como adquirido"
                      }
                      onClick={() => updateMut.mutate({ id: it.id, acquired: !it.acquired })}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        it.acquired
                          ? "border-green-500 bg-green-500 text-white"
                          : "border-border text-transparent hover:border-primary"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    {editing === it.id ? (
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateMut.mutate({ id: it.id, label: editLabel });
                            setEditing(null);
                          }
                          if (e.key === "Escape") setEditing(null);
                        }}
                        autoFocus
                        className="h-7"
                      />
                    ) : (
                      <span
                        className={`flex-1 text-sm ${it.acquired ? "text-muted-foreground line-through" : "text-foreground"}`}
                      >
                        {it.label}
                        {it.year ? (
                          <span className="text-muted-foreground"> ({it.year})</span>
                        ) : null}
                        {it.note ? (
                          <span className="ml-1 text-xs text-muted-foreground">· {it.note}</span>
                        ) : null}
                      </span>
                    )}
                    {editing === it.id ? (
                      <>
                        <button
                          type="button"
                          aria-label="Salvar"
                          onClick={() => {
                            updateMut.mutate({ id: it.id, label: editLabel });
                            setEditing(null);
                          }}
                          className="text-primary"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancelar"
                          onClick={() => setEditing(null)}
                          className="text-muted-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label="Editar"
                          onClick={() => {
                            setEditing(it.id);
                            setEditLabel(it.label);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Excluir"
                          onClick={() => deleteMut.mutate(it.id)}
                          className="text-muted-foreground hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnalisePage() {
  const queryClient = useQueryClient();
  const fetchLots = useServerFn(getVinylLots);
  const fetchLotAi = useServerFn(getLotAi);
  const fetchLotMarket = useServerFn(getLotMarket);
  const fetchInterests = useServerFn(getUserInterests);
  const saveInterests = useServerFn(setUserInterests);
  const fetchWantlist = useServerFn(getWantlist);

  // Filtros
  const [search, setSearch] = useState("");
  const [dayFilter, setDayFilter] = useState("all");
  const [houseFilter, setHouseFilter] = useState("all");
  const [scoreRange, setScoreRange] = useState<ScoreRange>("all");
  const [onlyWantlist, setOnlyWantlist] = useState(false);
  const [topOpen, setTopOpen] = useState(true);

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
  const lotMarketQuery = useQuery({
    queryKey: ["lot-market"] as const,
    queryFn: () => fetchLotMarket(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const wantlistQuery = useQuery({
    queryKey: ["wantlist"] as const,
    queryFn: () => fetchWantlist(),
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
  const marketById = useMemo(() => {
    const map = new Map<string, LotMarket>();
    for (const r of lotMarketQuery.data ?? []) map.set(r.id, toLotMarket(r));
    return map;
  }, [lotMarketQuery.data]);
  const matchesInterest = useMemo(
    () => buildInterestMatcher(interestsQuery.data ?? []),
    [interestsQuery.data],
  );
  const wantItems = useMemo(() => (wantlistQuery.data ?? []) as WantItem[], [wantlistQuery.data]);
  const matchesWant = useMemo(() => buildWantlistMatcher(wantItems), [wantItems]);

  // Texto do lote para casar sondagem/interesses (título + álbum identificado).
  const lotText = (lot: VinylLot) => `${lot.title} ${aiById.get(lot.id)?.album ?? ""}`;
  const isWanted = (lot: VinylLot) => matchesWant(lotText(lot));
  const aiFor = (lot: VinylLot): LotAi | undefined => {
    const base = aiById.get(lot.id);
    if (!base) return undefined;
    return { ...base, matchesInterests: matchesInterest(lotText(lot)) || isWanted(lot) };
  };
  const marketFor = (lot: VinylLot): LotMarket | undefined => marketById.get(lot.id);
  const scoreOf = (lot: VinylLot) => aiById.get(lot.id)?.score ?? -1;

  const days = useMemo(() => lots.data?.days ?? [], [lots.data]);
  const allLots = useMemo(() => lots.data?.lots ?? [], [lots.data]);
  const evaluated = aiById.size;

  // Casas para o filtro (ordenadas).
  const houses = useMemo(
    () =>
      [...new Set(allLots.map((l) => l.house).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [allLots],
  );

  // Aplica todos os filtros ao conjunto de lotes (alimenta Top 100 E a lista por dia/casa).
  const filteredLots = useMemo(() => {
    const q = normalizeForMatch(search);
    return allLots.filter((lot) => {
      if (dayFilter !== "all" && lot.dayKey !== dayFilter) return false;
      if (houseFilter !== "all" && lot.house !== houseFilter) return false;
      if (scoreRange !== "all" && !scoreInRange(aiById.get(lot.id)?.score ?? null, scoreRange))
        return false;
      if (onlyWantlist && !isWanted(lot)) return false;
      if (q) {
        const hay = normalizeForMatch(
          `${lot.title} ${aiById.get(lot.id)?.album ?? ""} ${lot.house}`,
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLots, search, dayFilter, houseFilter, scoreRange, onlyWantlist, aiById, matchesWant]);

  const top = useMemo(
    () =>
      [...filteredLots]
        .filter((l) => (aiById.get(l.id)?.score ?? null) !== null)
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, TOP_N),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredLots, aiById],
  );

  const filterActive =
    Boolean(search) ||
    dayFilter !== "all" ||
    houseFilter !== "all" ||
    scoreRange !== "all" ||
    onlyWantlist;
  const clearFilters = () => {
    setSearch("");
    setDayFilter("all");
    setHouseFilter("all");
    setScoreRange("all");
    setOnlyWantlist(false);
  };

  // Dias presentes no conjunto filtrado (para as seções por dia).
  const shownDays = days.filter((d) => filteredLots.some((l) => l.dayKey === d));

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
              Ranqueado por nota da IA (raridade + oportunidade). ⭐ = interesse/sondagem.{" "}
              {evaluated ? `${evaluated} lote(s) avaliado(s).` : "Ainda sem avaliações."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <WantlistDialog items={wantItems} />
            <InterestsDialog
              interests={interestsQuery.data ?? []}
              onSave={(items) => saveInterestsMut.mutate(items)}
              saving={saveInterestsMut.isPending}
            />
          </div>
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
          <div className="space-y-6">
            {/* ------- Barra de filtros (filtra Top 100 e a lista) ------- */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título, álbum ou casa…"
                className="h-9 w-full sm:max-w-xs"
              />
              <select
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                className={inputClass}
              >
                <option value="all">Todos os dias</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {formatDayLabel(d, days)}
                  </option>
                ))}
              </select>
              <select
                value={houseFilter}
                onChange={(e) => setHouseFilter(e.target.value)}
                className={`${inputClass} max-w-[12rem]`}
              >
                <option value="all">Todas as casas</option>
                {houses.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <select
                value={scoreRange}
                onChange={(e) => setScoreRange(e.target.value as ScoreRange)}
                className={inputClass}
              >
                <option value="all">Qualquer nota</option>
                <option value="80">Nota 80+</option>
                <option value="60">Nota 60–79</option>
                <option value="40">Nota 40–59</option>
                <option value="lt40">Nota &lt; 40</option>
              </select>
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={onlyWantlist}
                  onChange={(e) => setOnlyWantlist(e.target.checked)}
                  className="accent-primary"
                />
                <Target className="h-3.5 w-3.5" /> Só sondagem
              </label>
              {filterActive ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="mr-1 h-4 w-4" />
                  Limpar
                </Button>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {filteredLots.length} lote(s)
              </span>
            </div>

            {/* ------- Top 100 (recolhível) ------- */}
            <section className="space-y-3">
              <button
                type="button"
                onClick={() => setTopOpen((v) => !v)}
                aria-expanded={topOpen}
                className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
              >
                {topOpen ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
                <Star className="h-5 w-5 text-primary" />
                Top {Math.min(TOP_N, top.length)} — melhores oportunidades
              </button>
              {topOpen ? (
                top.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum lote avaliado no filtro atual.
                  </p>
                ) : (
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
                          const market = marketFor(lot);
                          const mDeal = market ? marketDeal(lot.price, market) : "indefinido";
                          return (
                            <tr key={lot.id} className="border-t border-border/60 align-top">
                              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                              <td className="px-3 py-2">
                                <ScoreChips ai={ai} />
                                {mDeal !== "indefinido" ? (
                                  <p className={`mt-1 text-[11px] font-medium ${dealTone(mDeal)}`}>
                                    {dealLabel(mDeal)} vs. mercado
                                  </p>
                                ) : null}
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
                )
              ) : null}
            </section>

            {/* ------- Por dia → casa (ordenado por nota, respeitando os filtros) ------- */}
            <section className="space-y-6">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Por dia e casa de leilão
              </h2>
              {shownDays.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum lote no filtro atual.</p>
              ) : (
                shownDays.map((day, index) => {
                  const dayLots = filteredLots.filter((l) => l.dayKey === day);
                  const groups = groupByHouse(dayLots);
                  for (const g of groups) g.lots.sort((a, b) => scoreOf(b) - scoreOf(a));
                  const bestScore = (g: HouseGroup) => (g.lots.length ? scoreOf(g.lots[0]!) : -1);
                  const ordered = [...groups].sort(
                    (a, b) =>
                      bestScore(b) - bestScore(a) || a.house.localeCompare(b.house, "pt-BR"),
                  );
                  return (
                    <div key={day} className="space-y-4">
                      <h3 className="border-b border-border pb-1 text-sm font-semibold uppercase tracking-wider text-primary">
                        {formatDayLabel(day, days)}
                        <span className="ml-2 font-normal normal-case text-muted-foreground">
                          {dayLots.length} lote(s)
                        </span>
                      </h3>
                      {ordered.map((group) => {
                        const key = `${day}|${group.house}`;
                        const isOpen = openHouses.has(key);
                        const best = bestScore(group);
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
                                {best >= 0 ? (
                                  <span
                                    className={`rounded px-1 text-[10px] font-bold ${scoreTone(best)}`}
                                  >
                                    {best}
                                  </span>
                                ) : null}
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
                                      <th className="px-2 py-2 text-right font-medium">Atual</th>
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
                                              <ScoreDetails
                                                ai={ai}
                                                market={marketFor(lot)}
                                                price={lot.price}
                                              />
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
                    </div>
                  );
                })
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

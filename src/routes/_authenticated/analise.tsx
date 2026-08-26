import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreChips, ScoreDetails } from "@/components/vinyl/ai-score";
import {
  buildInterestMatcher,
  dealLabel,
  dealTone,
  marketDeal,
  scoreTone,
  toLotMarket,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import { houseAnchor } from "@/components/vinyl/grouping";
import {
  addWantlistItem,
  deleteWantlistItem,
  getLotAi,
  getLotMarket,
  getUserInterests,
  getVinylLots,
  getWantlist,
  importWantlist,
  setUserInterests,
  updateWantlistItem,
} from "@/lib/leiloesbr.functions";
import { formatDayLabel, normalizeForMatch, type VinylLot } from "@/lib/vinyl-parse";
import { parseWantlistText } from "@/lib/wantlist-parse";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise de Lotes — Garimpo de Vinil" }] }),
  component: AnalisePage,
});

const TOP_N = 100;

/** Item da sondagem como a UI consome (espelha `wantlist_items`). */
type WantItem = {
  id: string;
  raw: string;
  work: string;
  year: number | null;
  note: string;
  norm: string;
  acquired: boolean;
  position: number;
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

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function LotTitle({ lot, wanted }: { lot: VinylLot; wanted?: boolean }) {
  return (
    <span className="inline-flex items-start gap-1">
      {wanted ? (
        <Target
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
          aria-label="Casa com a sondagem"
        />
      ) : null}
      <a
        href={lot.url}
        target="_blank"
        rel="noreferrer"
        className="line-clamp-2 text-foreground hover:text-primary hover:underline"
        title={lot.title}
      >
        {lot.title}
      </a>
    </span>
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

type EditDraft = { id: string; work: string; year: string; note: string };

/**
 * Diálogo da "sondagem": cola texto para importar, pesquisa, edita, marca o que já adquiri
 * e remove — tudo persistido no banco (`wantlist_items`). Serve de input extra para a
 * análise (os lotes que casam com a lista ganham 🎯).
 */
function SondagemDialog({
  items,
  loading,
  onImport,
  onAdd,
  onUpdate,
  onDelete,
  busy,
}: {
  items: WantItem[];
  loading: boolean;
  onImport: (text: string) => void;
  onAdd: (v: { work: string; year: number | null; note: string }) => void;
  onUpdate: (v: {
    id: string;
    work?: string;
    year?: number | null;
    note?: string;
    acquired?: boolean;
  }) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [search, setSearch] = useState("");
  const [showAcquired, setShowAcquired] = useState(true);
  const [edit, setEdit] = useState<EditDraft | null>(null);

  const pending = items.filter((i) => !i.acquired).length;
  const previewCount = useMemo(
    () => (importText.trim() ? parseWantlistText(importText).length : 0),
    [importText],
  );

  const visible = useMemo(() => {
    const q = normalizeForMatch(search);
    return items.filter((i) => {
      if (!showAcquired && i.acquired) return false;
      if (q && !normalizeForMatch(`${i.work} ${i.note}`).includes(q)) return false;
      return true;
    });
  }, [items, search, showAcquired]);

  const startEdit = (i: WantItem) =>
    setEdit({ id: i.id, work: i.work, year: i.year?.toString() ?? "", note: i.note });
  const startAdd = () => setEdit({ id: "new", work: "", year: "", note: "" });

  const saveEdit = () => {
    if (!edit) return;
    const work = edit.work.trim();
    if (!work) {
      toast.error("Informe a obra.");
      return;
    }
    const year = edit.year.trim() ? Number(edit.year) || null : null;
    if (edit.id === "new") onAdd({ work, year, note: edit.note.trim() });
    else onUpdate({ id: edit.id, work, year, note: edit.note.trim() });
    setEdit(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setEdit(null);
          setImportText("");
          setSearch("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Crosshair className="mr-2 h-4 w-4" />
          Sondagem
          {pending ? (
            <Badge variant="secondary" className="ml-2">
              {pending}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sondagem — obras que estou caçando</DialogTitle>
          <DialogDescription>
            Cole seu rascunho (uma obra por linha, ex.: <code>01. Tim Maia (1970)</code>). Depois
            pesquise, edite e marque o que já adquiriu. Os lotes que casam com a lista ganham 🎯 na
            análise.
          </DialogDescription>
        </DialogHeader>

        {/* Importar por texto */}
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">
            Importar colando texto
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={6}
              placeholder={
                "01. Tim Maia (1970)\n02. Tim Maia (1973)\n03. Tim Maia Racional, Vol. 1 (1975 - Fase Cult/Rara)\n[Bônus/Cult: Tim Maia Racional, Vol. 2 (1975)]"
              }
              className="w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {previewCount ? `${previewCount} obra(s) reconhecida(s)` : "Cole o texto acima"}
              </span>
              <Button
                size="sm"
                disabled={busy || previewCount === 0}
                onClick={() => {
                  onImport(importText);
                  setImportText("");
                }}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Importar {previewCount ? `(${previewCount})` : ""}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Não apaga o que já existe; ignora duplicatas (obra + ano).
            </p>
          </div>
        </details>

        {/* Busca + controles */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar na sondagem…"
            className="h-9 max-w-xs"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showAcquired}
              onChange={(e) => setShowAcquired(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Mostrar adquiridos
          </label>
          <Button variant="outline" size="sm" className="ml-auto" onClick={startAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Adicionar obra
          </Button>
        </div>

        {/* Formulário de edição / novo item */}
        {edit ? (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium text-foreground">
              {edit.id === "new" ? "Nova obra" : "Editar obra"}
            </p>
            <Input
              value={edit.work}
              onChange={(e) => setEdit({ ...edit, work: e.target.value })}
              placeholder="Obra (ex.: Tim Maia Racional, Vol. 1)"
            />
            <div className="flex flex-wrap gap-2">
              <Input
                value={edit.year}
                onChange={(e) => setEdit({ ...edit, year: e.target.value })}
                placeholder="Ano"
                inputMode="numeric"
                className="w-24"
              />
              <Input
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                placeholder="Observação (opcional)"
                className="min-w-[12rem] flex-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>
                <X className="mr-1 h-4 w-4" />
                Cancelar
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Lista */}
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            Nenhuma obra ainda. Importe seu rascunho acima ou adicione manualmente.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Nada encontrado com esses filtros.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {visible.map((i) => (
              <li key={i.id} className="flex items-start gap-2 p-2.5">
                <input
                  type="checkbox"
                  checked={i.acquired}
                  onChange={(e) => onUpdate({ id: i.id, acquired: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  title="Marcar como adquirido"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      i.acquired
                        ? "text-sm text-muted-foreground line-through"
                        : "text-sm font-medium text-foreground"
                    }
                  >
                    {i.work}
                    {i.year ? <span className="text-muted-foreground"> ({i.year})</span> : null}
                  </p>
                  {i.note ? <p className="text-xs text-muted-foreground">{i.note}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(i)}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(i.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remover"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
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
  const importWant = useServerFn(importWantlist);
  const addWant = useServerFn(addWantlistItem);
  const updateWant = useServerFn(updateWantlistItem);
  const deleteWant = useServerFn(deleteWantlistItem);

  const [openHouses, setOpenHouses] = useState<Set<string>>(new Set());
  const toggleHouse = (key: string) =>
    setOpenHouses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Filtros (valem para o Top 100 E para a visão por dia/casa).
  const [search, setSearch] = useState("");
  const [houseFilter, setHouseFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [onlyWant, setOnlyWant] = useState(false);
  const [topOpen, setTopOpen] = useState(true);
  const [activeDay, setActiveDay] = useState("");

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
  const wantlistQuery = useQuery<WantItem[]>({
    queryKey: ["wantlist"] as const,
    queryFn: () => fetchWantlist() as Promise<WantItem[]>,
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

  const invalidateWant = () => queryClient.invalidateQueries({ queryKey: ["wantlist"] });
  const importWantMut = useMutation({
    mutationFn: (text: string) => importWant({ data: { text } }),
    onSuccess: (r: { added: number }) => {
      void invalidateWant();
      toast.success(r.added ? `${r.added} obra(s) importada(s)` : "Nada novo para importar");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao importar"),
  });
  const addWantMut = useMutation({
    mutationFn: (v: { work: string; year: number | null; note: string }) => addWant({ data: v }),
    onSuccess: () => {
      void invalidateWant();
      toast.success("Obra adicionada");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao adicionar"),
  });
  const updateWantMut = useMutation({
    mutationFn: (v: {
      id: string;
      work?: string;
      year?: number | null;
      note?: string;
      acquired?: boolean;
    }) => updateWant({ data: v }),
    onSuccess: () => void invalidateWant(),
    onError: (e: Error) => toast.error(e.message || "Falha ao atualizar"),
  });
  const deleteWantMut = useMutation({
    mutationFn: (id: string) => deleteWant({ data: { id } }),
    onSuccess: () => {
      void invalidateWant();
      toast.success("Obra removida");
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao remover"),
  });
  const wantBusy =
    importWantMut.isPending ||
    addWantMut.isPending ||
    updateWantMut.isPending ||
    deleteWantMut.isPending;

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
  // Casamento com a sondagem: obras ainda NÃO adquiridas (as adquiridas saem do radar).
  const matchesWant = useMemo(
    () =>
      buildInterestMatcher(
        (wantlistQuery.data ?? []).filter((w) => !w.acquired).map((w) => w.work),
      ),
    [wantlistQuery.data],
  );
  const marketById = useMemo(() => {
    const map = new Map<string, LotMarket>();
    for (const r of lotMarketQuery.data ?? []) map.set(r.id, toLotMarket(r));
    return map;
  }, [lotMarketQuery.data]);
  const aiFor = (lot: VinylLot): LotAi | undefined => {
    const base = aiById.get(lot.id);
    if (!base) return undefined;
    return { ...base, matchesInterests: matchesInterest(lot.title) };
  };
  const marketFor = (lot: VinylLot): LotMarket | undefined => marketById.get(lot.id);
  // Score para ordenação: sem avaliação vai para o fim (-1).
  const scoreOf = (lot: VinylLot) => aiById.get(lot.id)?.score ?? -1;

  const days = lots.data?.days ?? [];
  const allLots = useMemo(() => lots.data?.lots ?? [], [lots.data]);

  const houses = useMemo(
    () =>
      [...new Set(allLots.map((l) => l.house).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [allLots],
  );

  // Aplica os filtros (busca/casa/dia/nota/sondagem) — base tanto do Top 100 quanto do por dia.
  const filtered = useMemo(() => {
    const q = normalizeForMatch(search);
    const min = scoreMin.trim() ? Number(scoreMin) : null;
    const max = scoreMax.trim() ? Number(scoreMax) : null;
    const scoreActive = min !== null || max !== null;
    return allLots.filter((l) => {
      if (q && !normalizeForMatch(l.title).includes(q)) return false;
      if (houseFilter && l.house !== houseFilter) return false;
      if (dayFilter && l.dayKey !== dayFilter) return false;
      if (onlyWant && !matchesWant(l.title)) return false;
      if (scoreActive) {
        const s = aiById.get(l.id)?.score ?? null;
        if (s === null) return false;
        if (min !== null && s < min) return false;
        if (max !== null && s > max) return false;
      }
      return true;
    });
  }, [allLots, search, houseFilter, dayFilter, onlyWant, scoreMin, scoreMax, aiById, matchesWant]);

  // Top 100: só lotes já avaliados, maior nota primeiro — dentro do conjunto filtrado.
  const top = useMemo(
    () =>
      [...filtered]
        .filter((l) => (aiById.get(l.id)?.score ?? null) !== null)
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, TOP_N),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, aiById],
  );

  const evaluated = aiById.size;
  const wantCount = (wantlistQuery.data ?? []).filter((w) => !w.acquired).length;
  const wantMatchCount = useMemo(
    () => (wantCount ? filtered.filter((l) => matchesWant(l.title)).length : 0),
    [filtered, matchesWant, wantCount],
  );
  const filtersActive = Boolean(
    search || houseFilter || dayFilter || scoreMin || scoreMax || onlyWant,
  );
  const resetFilters = () => {
    setSearch("");
    setHouseFilter("");
    setDayFilter("");
    setScoreMin("");
    setScoreMax("");
    setOnlyWant(false);
  };

  const visibleDays = dayFilter ? days.filter((d) => d === dayFilter) : days;
  const tabValue = visibleDays.includes(activeDay) ? activeDay : (visibleDays[0] ?? "");

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
              interesses; 🎯 = casa com a sondagem.{" "}
              {evaluated ? `${evaluated} lote(s) avaliado(s).` : "Ainda sem avaliações."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SondagemDialog
              items={wantlistQuery.data ?? []}
              loading={wantlistQuery.isLoading}
              onImport={(text) => importWantMut.mutate(text)}
              onAdd={(v) => addWantMut.mutate(v)}
              onUpdate={(v) => updateWantMut.mutate(v)}
              onDelete={(id) => deleteWantMut.mutate(id)}
              busy={wantBusy}
            />
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
          <div className="space-y-8">
            {/* ------- Filtros ------- */}
            <section className="rounded-md border border-border bg-card/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Buscar título
                  </label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ex.: Tim Maia"
                    className="h-9 w-48"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Dia
                  </label>
                  <select
                    value={dayFilter}
                    onChange={(e) => setDayFilter(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Todos</option>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {formatDayLabel(d, days)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Casa
                  </label>
                  <select
                    value={houseFilter}
                    onChange={(e) => setHouseFilter(e.target.value)}
                    className={`${selectClass} max-w-[16rem]`}
                  >
                    <option value="">Todas</option>
                    {houses.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Nota (0–100)
                  </label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={scoreMin}
                      onChange={(e) => setScoreMin(e.target.value)}
                      placeholder="mín"
                      inputMode="numeric"
                      className="h-9 w-16"
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      value={scoreMax}
                      onChange={(e) => setScoreMax(e.target.value)}
                      placeholder="máx"
                      inputMode="numeric"
                      className="h-9 w-16"
                    />
                  </div>
                </div>
                <label className="flex h-9 items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={onlyWant}
                    onChange={(e) => setOnlyWant(e.target.checked)}
                    disabled={wantCount === 0}
                    className="h-4 w-4 accent-primary"
                  />
                  <Target className="h-4 w-4 text-primary" />
                  Só sondagem
                </label>
                {filtersActive ? (
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    <X className="mr-1 h-4 w-4" />
                    Limpar
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {filtered.length} lote(s) no filtro.
                {wantCount
                  ? ` ${wantMatchCount} casam com a sondagem (${wantCount} obra(s) na lista).`
                  : ""}
              </p>
            </section>

            {/* ------- Top 100 (recolhível) ------- */}
            <section className="space-y-3">
              <button
                type="button"
                onClick={() => setTopOpen((v) => !v)}
                aria-expanded={topOpen}
                className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
              >
                {topOpen ? (
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <Star className="h-5 w-5 text-primary" />
                Top {Math.min(TOP_N, top.length)} — melhores oportunidades
                {filtersActive ? (
                  <Badge variant="secondary" className="ml-1 font-normal">
                    filtrado
                  </Badge>
                ) : null}
              </button>
              {topOpen ? (
                top.length === 0 ? (
                  <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
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
                                <LotTitle lot={lot} wanted={matchesWant(lot.title)} />
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

            {/* ------- Por dia → casa (ordenado por nota) ------- */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Por dia e casa de leilão
              </h2>
              {visibleDays.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum dia no filtro.</p>
              ) : (
                <Tabs value={tabValue} onValueChange={setActiveDay}>
                  <TabsList className="mb-6 flex h-auto flex-wrap justify-start gap-1 bg-secondary">
                    {visibleDays.map((day) => (
                      <TabsTrigger key={day} value={day}>
                        {formatDayLabel(day, days)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {filtered.filter((l) => l.dayKey === day).length}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {visibleDays.map((day, index) => {
                    const dayLots = filtered.filter((l) => l.dayKey === day);
                    const groups = groupByHouse(dayLots);
                    for (const g of groups) g.lots.sort((a, b) => scoreOf(b) - scoreOf(a));
                    // Melhor nota da casa (para ordenar as casas).
                    const bestScore = (g: HouseGroup) => (g.lots.length ? scoreOf(g.lots[0]!) : -1);
                    const ordered = [...groups].sort(
                      (a, b) =>
                        bestScore(b) - bestScore(a) || a.house.localeCompare(b.house, "pt-BR"),
                    );

                    return (
                      <TabsContent key={day} value={day} className="space-y-6">
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
                                            ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "start",
                                            }),
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
                                    <span className="text-muted-foreground">
                                      {group.lots.length}
                                    </span>
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
                                                  <LotTitle
                                                    lot={lot}
                                                    wanted={matchesWant(lot.title)}
                                                  />
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
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

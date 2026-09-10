import { useMemo, useRef, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Disc3,
  ExternalLink,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { AiProviderSelect } from "@/components/vinyl/ai-provider-controls";
import { scoreTone } from "@/components/vinyl/ai-score-utils";
import { fmtMoney } from "@/components/vinyl/ai-score-utils";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import { AI_PROVIDER_SHORT, type AiProvider } from "@/lib/ai-provider";
import {
  type AlbumAgg,
  type AnalyticsAliases,
  type ArtistAgg,
  buildAnalytics,
  type SaleRow,
} from "@/lib/analytics";
import { type Condition, EMPTY_CONDITION, normalizeGrade, scoreCondition } from "@/lib/grading";
import {
  clearAnalyticsAlias,
  getAiProvider,
  getAnalyticsAliases,
  getVinylSales,
  reidentifySales,
  setAiProvider,
  setAnalyticsAlbumAlias,
  setAnalyticsArtistAlias,
  setAnalyticsSaleOverride,
} from "@/lib/leiloesbr.functions";
import { normalizeForMatch } from "@/lib/vinyl-parse";

export const Route = createFileRoute("/_authenticated/vinil-analytics")({
  head: () => ({ meta: [{ title: "Vinil Analytics — Garimpo de Vinil" }] }),
  component: VinilAnalyticsPage,
});

const money = (n: number | null) => fmtMoney(n, "BRL");

/** Custo real = valor de venda + comissão do leiloeiro (quando a taxa é conhecida). */
function netCost(s: SaleRow): number | null {
  if (s.sold_price == null || s.fee_pct == null) return null;
  return Math.round(s.sold_price * (1 + s.fee_pct / 100));
}
function feeTip(s: SaleRow): string {
  return s.fee_pct != null ? `Taxa do leiloeiro: ${s.fee_pct}%` : "Taxa do leiloeiro desconhecida";
}
/** Ágio/desconto do valor de venda sobre o valor inicial. */
function discountTip(s: SaleRow): string {
  if (s.initial_price == null || !s.initial_price || s.sold_price == null) return "Valor inicial";
  const pct = Math.round(((s.sold_price - s.initial_price) / s.initial_price) * 100);
  return `Valor inicial ${money(s.initial_price)} → venda ${money(s.sold_price)} (${
    pct >= 0 ? "+" : ""
  }${pct}%)`;
}
/** Rótulo compacto de demanda: "👁 26 · 🔨 3" (só o que houver). */
function demandLabel(s: SaleRow): string {
  const parts: string[] = [];
  if (s.views != null) parts.push(`👁 ${s.views}`);
  if (s.bids != null) parts.push(`🔨 ${s.bids}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Reconstrói o estado (Disco/Capa/Score/Faixa/encarte) de uma venda para os badges (mesma
 *  regra de espelhamento do resto do app, via `scoreCondition`). */
function conditionFromSale(s: SaleRow): Condition {
  const g = scoreCondition(normalizeGrade(s.media), normalizeGrade(s.sleeve));
  return {
    ...EMPTY_CONDITION,
    media: g.media,
    sleeve: g.sleeve,
    score: g.score,
    faixa: g.faixa,
    insert: s.insert_state === "sim" ? "sim" : s.insert_state === "nao" ? "nao" : null,
  };
}

type ArtistSort = "count" | "alpha";
type AlbumSort = "count" | "alpha";
type Suggestions = { artists: string[]; albums: string[] };
type ApplySaleOverride = (lotId: string, value: { artist: string; album: string } | null) => void;
type ReidentGroup = (lotIds: string[]) => Promise<void>;

function VinilAnalyticsPage() {
  const queryClient = useQueryClient();
  const fetchSales = useServerFn(getVinylSales);
  const runReident = useServerFn(reidentifySales);
  const fetchAiProvider = useServerFn(getAiProvider);
  const runSetAiProvider = useServerFn(setAiProvider);
  const fetchAliases = useServerFn(getAnalyticsAliases);
  const runSetArtistAlias = useServerFn(setAnalyticsArtistAlias);
  const runSetAlbumAlias = useServerFn(setAnalyticsAlbumAlias);
  const runClearAlias = useServerFn(clearAnalyticsAlias);
  const runSetSaleOverride = useServerFn(setAnalyticsSaleOverride);
  const sales = useQuery({
    queryKey: ["vinyl-sales"] as const,
    queryFn: () => fetchSales(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Apelidos (curadoria manual do agrupamento — renomear/fundir artistas e álbuns). Fonte da
  // verdade no servidor (`app_state`); aplicados em `buildAnalytics`. Escrita otimista.
  const aliasesQuery = useQuery({
    queryKey: ["analytics-aliases"] as const,
    queryFn: () => fetchAliases(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Provedor de IA PADRÃO (o mesmo do topo da home/Coleção) — fonte da verdade no servidor.
  const aiProviderQuery = useQuery({
    queryKey: ["ai-provider"] as const,
    queryFn: () => fetchAiProvider(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const aiProvider: AiProvider = aiProviderQuery.data ?? "anthropic";
  const changeAiProvider = (provider: AiProvider) => {
    const prev = aiProviderQuery.data;
    queryClient.setQueryData(["ai-provider"], provider); // otimista
    void runSetAiProvider({ data: { provider } })
      .then(() => toast.success(`Provedor padrão: ${AI_PROVIDER_SHORT[provider]}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(["ai-provider"], prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o provedor de IA");
      });
  };

  // Clona o cache de apelidos (com os 3 mapas) para o update otimista.
  const cloneAliases = (): AnalyticsAliases => {
    const prev = aliasesQuery.data;
    return {
      artists: { ...(prev?.artists ?? {}) },
      albums: { ...(prev?.albums ?? {}) },
      sales: { ...(prev?.sales ?? {}) },
    };
  };
  const revertAliases = (prev: AnalyticsAliases | undefined) =>
    queryClient.setQueryData(["analytics-aliases"], prev);

  // Grava um apelido de ARTISTA (renomear/fundir). Update otimista no cache dos apelidos → o
  // `useMemo` de `buildAnalytics` recomputa na hora; em erro, reverte.
  const applyArtistAlias = (sourceKeys: string[], name: string) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of sourceKeys) next.artists![k] = name;
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetArtistAlias({ data: { sourceKeys, name } })
      .then(() => toast.success(`Artista atualizado: ${name}`))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o artista");
      });
  };

  // Grava um apelido de ÁLBUM (renomear/fundir no escopo do artista).
  const applyAlbumAlias = (keys: string[], name: string) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of keys) next.albums![k] = name;
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetAlbumAlias({ data: { keys, name } })
      .then(() => toast.success(`Álbum atualizado: ${name}`))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o álbum");
      });
  };

  // Desfaz os apelidos de um artista (remove suas chaves dos dois mapas). Volta ao automático.
  const clearArtistAlias = (artist: ArtistAgg) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    for (const k of artist.sourceKeys) delete next.artists![k];
    queryClient.setQueryData(["analytics-aliases"], next);
    void Promise.all(
      artist.sourceKeys.map((key) => runClearAlias({ data: { kind: "artist", key } })),
    )
      .then(() => toast.success("Curadoria do artista desfeita"))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível desfazer");
      });
  };

  // Correção POR VENDA (por `lot_id`): define/limpa artista+álbum de uma venda; separa os não
  // identificados. `clear` volta ao automático. Update otimista no mapa `sales`.
  const applySaleOverride = (lotId: string, value: { artist: string; album: string } | null) => {
    const prev = aliasesQuery.data;
    const next = cloneAliases();
    if (!value || (!value.artist.trim() && !value.album.trim())) delete next.sales![lotId];
    else {
      const entry: { artist?: string; album?: string } = {};
      if (value.artist.trim()) entry.artist = value.artist.trim();
      if (value.album.trim()) entry.album = value.album.trim();
      next.sales![lotId] = entry;
    }
    queryClient.setQueryData(["analytics-aliases"], next);
    void runSetSaleOverride({
      data: {
        lotId,
        artist: value?.artist ?? "",
        album: value?.album ?? "",
        clear: !value,
      },
    })
      .then(() => toast.success(value ? "Venda corrigida" : "Correção da venda desfeita"))
      .catch((error: unknown) => {
        revertAliases(prev);
        toast.error((error as Error)?.message || "Não foi possível corrigir a venda");
      });
  };

  // Reidentifica TODO o histórico pela IA (título+descrição → artista/álbum) e padroniza os
  // nomes. Roda em laço até `done`, então revalida a lista. Usa o provedor selecionado no topo.
  const [reidentifying, setReidentifying] = useState(false);
  const reidentifyAll = () => {
    if (reidentifying) return;
    setReidentifying(true);
    void (async () => {
      let identified = 0;
      let applied = 0;
      try {
        for (let guard = 0; guard < 200; guard += 1) {
          const res = await runReident({ data: { max: 25 } });
          identified += res.identified;
          applied += res.applied;
          if (res.done) break;
        }
        await queryClient.invalidateQueries({ queryKey: ["vinyl-sales"] });
        await sales.refetch();
        toast.success(
          `Reidentificação concluída: ${identified} identificado(s) pela IA · ${applied} registro(s) padronizado(s)`,
        );
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível reidentificar agora");
      } finally {
        setReidentifying(false);
      }
    })();
  };

  // Reidentifica pela IA só as vendas de um GRUPO (artista ou álbum). Chamada única (o servidor
  // retenta os ainda não identificados do grupo); revalida a lista ao terminar.
  const reidentifyGroupSales = async (lotIds: string[]) => {
    if (!lotIds.length) return;
    try {
      const res = await runReident({ data: { lotIds, max: Math.min(lotIds.length, 100) } });
      await queryClient.invalidateQueries({ queryKey: ["vinyl-sales"] });
      await sales.refetch();
      if (res.identified > 0) {
        toast.success(
          `IA: ${res.identified} identificado(s)${
            res.remaining ? ` · ${res.remaining} restante(s) — clique de novo` : ""
          }`,
        );
      } else if (res.remaining > 0) {
        toast.info(`Nada novo pela IA · ${res.remaining} venda(s) sem identificação`);
      } else {
        toast.success("Nada a identificar neste grupo");
      }
    } catch (error) {
      toast.error((error as Error)?.message || "Não foi possível reidentificar o grupo");
    }
  };

  const rows = useMemo(() => (sales.data ?? []) as SaleRow[], [sales.data]);
  const analytics = useMemo(
    () => buildAnalytics(rows, aliasesQuery.data),
    [rows, aliasesQuery.data],
  );

  const [search, setSearch] = useState("");
  const [artistSort, setArtistSort] = useState<ArtistSort>("count");
  const searchNorm = normalizeForMatch(search);
  const artists = useMemo(() => {
    const filtered = !searchNorm
      ? analytics
      : analytics.filter(
          (a) =>
            normalizeForMatch(a.artist).includes(searchNorm) ||
            a.albums.some((al) => normalizeForMatch(al.album).includes(searchNorm)),
        );
    const sorted = [...filtered];
    if (artistSort === "alpha") {
      sorted.sort((a, b) => a.artist.localeCompare(b.artist, "pt-BR"));
    } else {
      // Nº de álbuns (desc), desempate alfabético.
      sorted.sort(
        (a, b) => b.albums.length - a.albums.length || a.artist.localeCompare(b.artist, "pt-BR"),
      );
    }
    return sorted;
  }, [analytics, searchNorm, artistSort]);

  const totals = useMemo(
    () => ({ sales: rows.length, artists: analytics.length }),
    [rows, analytics],
  );

  // Sugestões (nomes já existentes) para a correção por venda — datalist de artistas/álbuns.
  const suggestions = useMemo(() => {
    const artistsSet = new Set<string>();
    const albumsSet = new Set<string>();
    for (const a of analytics) {
      artistsSet.add(a.artist);
      for (const al of a.albums) albumsSet.add(al.album);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return { artists: sort(artistsSet), albums: sort(albumsSet) };
  }, [analytics]);

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:py-5">
          <div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Link>
              </Button>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                <BarChart3 className="h-5 w-5 text-primary" />
                Vinil Analytics
              </h1>
            </div>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              Preços de venda por artista e álbum (a casa de leilão é irrelevante). Da pior à melhor
              conservação, com médias por Faixa de Classificação.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
            <Button
              variant="outline"
              size="sm"
              onClick={reidentifyAll}
              disabled={reidentifying}
              title="Passar a IA por todo o histórico: ajusta artista/álbum (título + descrição) e padroniza os nomes para não duplicar registros. Usa o provedor de IA selecionado ao lado."
            >
              <Sparkles className={`mr-2 h-4 w-4 ${reidentifying ? "animate-pulse" : ""}`} />
              {reidentifying ? "Reidentificando…" : "Reidentificar (IA)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sales.refetch()}
              disabled={sales.isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${sales.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <AiProviderSelect
              value={aiProvider}
              onChange={changeAiProvider}
              disabled={reidentifying}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatChip label="Vendas" value={String(totals.sales)} />
          <StatChip label="Artistas" value={String(totals.artists)} />
          {/* Ordenação da lista de artistas: alfabética ou por nº de álbuns. */}
          <SortToggle
            label="Artistas"
            options={[
              { value: "count", label: "Nº álbuns" },
              { value: "alpha", label: "A→Z" },
            ]}
            value={artistSort}
            onChange={(v) => setArtistSort(v as ArtistSort)}
          />
          <div className="ml-auto w-full sm:w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar artista ou álbum…"
            />
          </div>
        </div>

        {sales.isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Carregando histórico…</p>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : artists.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Nada encontrado para “{search}”.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {artists.map((a) => (
              <ArtistRow
                key={a.key}
                artist={a}
                allArtists={analytics}
                suggestions={suggestions}
                onApplyArtist={applyArtistAlias}
                onClearArtist={() => clearArtistAlias(a)}
                onApplyAlbum={applyAlbumAlias}
                onApplySaleOverride={applySaleOverride}
                onReidentGroup={reidentifyGroupSales}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded bg-secondary px-2 py-1 text-foreground">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/** Alternador compacto de ordenação (segmentado). */
function SortToggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1">
      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-background"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-border bg-card p-8 text-center">
      <Disc3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Ainda não há vendas no histórico.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        O histórico é preenchido automaticamente após os leilões (varredura do catálogo das casas).
        Conforme os leilões acompanhados terminam, os valores de venda aparecem aqui.
      </p>
    </div>
  );
}

/** Botão "rodar a IA" num escopo (artista/álbum): identifica pela IA só as vendas de `lotIds`. */
function IaButton({
  lotIds,
  onReident,
  title,
}: {
  lotIds: string[];
  onReident: ReidentGroup;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy || !lotIds.length) return;
    setBusy(true);
    void onReident(lotIds).finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || !lotIds.length}
      title={title}
      aria-label={title}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <Sparkles className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
    </button>
  );
}

function ArtistRow({
  artist,
  allArtists,
  suggestions,
  onApplyArtist,
  onClearArtist,
  onApplyAlbum,
  onApplySaleOverride,
  onReidentGroup,
}: {
  artist: ArtistAgg;
  allArtists: ArtistAgg[];
  suggestions: Suggestions;
  onApplyArtist: (sourceKeys: string[], name: string) => void;
  onClearArtist: () => void;
  onApplyAlbum: (keys: string[], name: string) => void;
  onApplySaleOverride: ApplySaleOverride;
  onReidentGroup: ReidentGroup;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [albumSort, setAlbumSort] = useState<AlbumSort>("count");

  const sortedAlbums = useMemo(() => {
    const list = [...artist.albums];
    if (albumSort === "alpha") list.sort((a, b) => a.album.localeCompare(b.album, "pt-BR"));
    else list.sort((a, b) => b.count - a.count || (b.avgPrice ?? 0) - (a.avgPrice ?? 0));
    return list;
  }, [artist.albums, albumSort]);

  // Todos os `lot_id`s do artista (para rodar a IA no artista inteiro).
  const artistLotIds = useMemo(
    () => artist.albums.flatMap((al) => al.sales.map((s) => s.lot_id)),
    [artist.albums],
  );

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 font-semibold text-foreground">{artist.artist}</span>
          <span className="text-xs text-muted-foreground">
            {artist.count} {artist.count === 1 ? "venda" : "vendas"} · {artist.albums.length}{" "}
            {artist.albums.length === 1 ? "álbum" : "álbuns"}
          </span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-semibold text-primary">
            {money(artist.avgPrice)}
          </span>
        </button>
        <IaButton
          lotIds={artistLotIds}
          onReident={onReidentGroup}
          title="Rodar a IA neste artista (identifica as vendas ainda sem álbum)"
        />
        <button
          type="button"
          onClick={() => setEdit(true)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Editar nome ou juntar com outro artista"
          aria-label="Editar artista"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          <div className="mb-2 flex justify-end">
            <SortToggle
              label="Álbuns"
              options={[
                { value: "count", label: "Nº na base" },
                { value: "alpha", label: "A→Z" },
              ]}
              value={albumSort}
              onChange={(v) => setAlbumSort(v as AlbumSort)}
            />
          </div>
          <div className="flex flex-col gap-2">
            {sortedAlbums.map((al) => (
              <AlbumRow
                key={al.key}
                album={al}
                artistKey={artist.key}
                artistName={artist.artist}
                siblings={artist.albums}
                suggestions={suggestions}
                onApplyAlbum={onApplyAlbum}
                onApplySaleOverride={onApplySaleOverride}
                onReidentGroup={onReidentGroup}
              />
            ))}
          </div>
        </div>
      ) : null}
      <ArtistEditDialog
        artist={artist}
        allArtists={allArtists}
        open={edit}
        onClose={() => setEdit(false)}
        onApply={onApplyArtist}
        onClear={onClearArtist}
      />
    </section>
  );
}

function AlbumRow({
  album,
  artistKey,
  artistName,
  siblings,
  suggestions,
  onApplyAlbum,
  onApplySaleOverride,
  onReidentGroup,
}: {
  album: AlbumAgg;
  artistKey: string;
  artistName: string;
  siblings: AlbumAgg[];
  suggestions: Suggestions;
  onApplyAlbum: (keys: string[], name: string) => void;
  onApplySaleOverride: ApplySaleOverride;
  onReidentGroup: ReidentGroup;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [edit, setEdit] = useState(false);
  const albumLotIds = useMemo(() => album.sales.map((s) => s.lot_id), [album.sales]);
  // Faixas do agregador vêm melhor→pior (ordem de FAIXAS). O eixo dos cards abaixo é
  // pior→melhor (esquerda = pior), então mostramos os chips no MESMO racional (pior→melhor).
  const faixasAsc = useMemo(() => [...album.faixas].reverse(), [album.faixas]);

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={open ? "Recolher" : "Expandir"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {/* O NOME do álbum abre a curadoria (renomear / juntar com outro álbum). */}
        <button
          type="button"
          onClick={() => setEdit(true)}
          className="flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
          title="Editar nome ou juntar com outro álbum"
        >
          {album.album}
        </button>
        <IaButton
          lotIds={albumLotIds}
          onReident={onReidentGroup}
          title="Rodar a IA neste álbum (identifica as vendas ainda sem álbum)"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-xs text-muted-foreground">
            {album.count} na base · {money(album.minPrice)}–{money(album.maxPrice)}
          </span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-semibold text-primary">
            {money(album.avgPrice)}
          </span>
        </button>
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          {/* Médias por Faixa de Classificação (pior → melhor, casando com o eixo abaixo). */}
          {faixasAsc.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {faixasAsc.map((f) => (
                <span
                  key={f.label}
                  className="rounded bg-secondary px-1.5 py-0.5 text-xs text-foreground"
                  title={`${f.count} venda(s) na faixa ${f.label}`}
                >
                  {f.label}: <span className="font-semibold">{money(f.avgPrice)}</span>
                  <span className="text-muted-foreground"> ({f.count})</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* Eixo horizontal: pior (esquerda) → melhor (direita). */}
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>◀ pior conservação</span>
            <span>melhor conservação ▶</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {album.sales.map((s) => (
              <SaleMarker
                key={s.lot_id}
                sale={s}
                albumName={album.album}
                artistName={artistName}
                suggestions={suggestions}
                onApplySaleOverride={onApplySaleOverride}
              />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {album.count} {album.count === 1 ? "disco" : "discos"} na nossa base
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDetail(true)}>
              Detalhes
            </Button>
          </div>
        </div>
      ) : null}
      <DetailDialog album={album} open={detail} onClose={() => setDetail(false)} />
      <AlbumEditDialog
        album={album}
        artistKey={artistKey}
        siblings={siblings}
        open={edit}
        onClose={() => setEdit(false)}
        onApply={onApplyAlbum}
      />
    </div>
  );
}

/** Mini card horizontal: VALOR em cima, estado no meio, NOTA (score) embaixo. Ao passar o
 *  mouse, mostra um preview compacto (Popover portalizado → não é cortado pelo scroll); ao
 *  CLICAR, abre o detalhe da venda (texto original + correção por venda). */
function SaleMarker({
  sale,
  albumName,
  artistName,
  suggestions,
  onApplySaleOverride,
}: {
  sale: SaleRow;
  albumName: string;
  artistName: string;
  suggestions: Suggestions;
  onApplySaleOverride: ApplySaleOverride;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cond = useMemo(() => conditionFromSale(sale), [sale]);
  const grade =
    sale.media || sale.sleeve
      ? `${sale.media || "?"}/${sale.sleeve || "?"}`
      : sale.faixa || "estado —";

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            onMouseEnter={() => {
              cancelClose();
              setOpen(true);
            }}
            onMouseLeave={scheduleClose}
            onClick={() => setDetail(true)}
            title="Abrir detalhe / corrigir"
            className="flex w-24 shrink-0 cursor-pointer flex-col items-center gap-1 rounded border border-border bg-card p-2 text-center hover:border-primary/60"
          >
            {/* VALOR (antes era a nota que ficava aqui em cima) */}
            <span className="w-full truncate text-xs font-semibold text-foreground">
              {money(sale.sold_price)}
            </span>
            <span className="w-full truncate text-[10px] text-muted-foreground" title={grade}>
              {grade}
            </span>
            {/* NOTA/score (invertida com o valor) */}
            <span
              className={`w-full truncate rounded px-1 py-0.5 text-[11px] font-semibold ${scoreTone(sale.score)}`}
              title={`Disco ${sale.media || "—"} · Capa ${sale.sleeve || "—"}${
                sale.score !== null ? ` · Score ${sale.score}` : ""
              }`}
            >
              {sale.score !== null ? sale.score : "—"}
            </span>
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          side="top"
          className="w-64 p-3"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SalePreview sale={sale} albumName={albumName} condition={cond} />
        </PopoverContent>
      </Popover>
      <SaleDetailDialog
        sale={sale}
        albumName={albumName}
        artistName={artistName}
        condition={cond}
        suggestions={suggestions}
        open={detail}
        onClose={() => setDetail(false)}
        onApply={onApplySaleOverride}
      />
    </>
  );
}

/** Preview compacto do lote (hover). Mostra artista, álbum, TEXTO ORIGINAL e mais campos. */
function SalePreview({
  sale,
  albumName,
  condition,
}: {
  sale: SaleRow;
  albumName: string;
  condition: Condition;
}) {
  const img = (sale as SaleRow & { image?: string | null }).image ?? null;
  const orig = (sale.orig_text || sale.title || "").trim();
  return (
    <div className="flex flex-col gap-2">
      {img ? (
        <div className="h-32 w-full overflow-hidden rounded bg-secondary">
          <img src={img} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
        </div>
      ) : null}
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{albumName}</p>
      {/* Texto original do lote (descritivo do catálogo, ou o título quando não há) — com rolagem
          quando é longo, para os casos não identificados. */}
      {orig ? (
        <div className="max-h-20 overflow-y-auto rounded bg-secondary/50 p-1.5 text-xs leading-snug text-muted-foreground">
          {orig}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ConditionBadges condition={condition} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-primary" title="Valor de venda">
          {money(sale.sold_price)}
        </span>
        {sale.initial_price != null ? (
          <span className="text-muted-foreground" title={discountTip(sale)}>
            inicial {money(sale.initial_price)}
          </span>
        ) : null}
        {netCost(sale) != null ? (
          <span className="text-muted-foreground" title={feeTip(sale)}>
            c/ taxa {money(netCost(sale))}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {sale.sold_date ?? "—"} · {demandLabel(sale)}
        </span>
        {sale.source_url ? (
          <a
            href={sale.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Lote <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <p className="text-[10px] italic text-muted-foreground">
        Clique no card para abrir / corrigir
      </p>
    </div>
  );
}

/** Detalhe da venda (clique no mini card): texto ORIGINAL completo + todos os campos + link, e
 *  correção POR VENDA (define artista/álbum só desta venda) para separar os não identificados. */
function SaleDetailDialog({
  sale,
  albumName,
  artistName,
  condition,
  suggestions,
  open,
  onClose,
  onApply,
}: {
  sale: SaleRow;
  albumName: string;
  artistName: string;
  condition: Condition;
  suggestions: Suggestions;
  open: boolean;
  onClose: () => void;
  onApply: ApplySaleOverride;
}) {
  const [artist, setArtist] = useState(artistName);
  const [album, setAlbum] = useState(albumName);
  const listId = `sale-${sale.lot_id}`;

  // Reinicia os campos ao (re)abrir para esta venda, com os valores atuais do grupo.
  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== sale.lot_id) {
    openedFor.current = sale.lot_id;
    setArtist(artistName);
    setAlbum(albumName);
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const orig = (sale.orig_text || "").trim();
  const save = () => {
    onApply(sale.lot_id, { artist, album });
    onClose();
  };
  const reset = () => {
    onApply(sale.lot_id, null);
    onClose();
  };

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value || "—"}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">Detalhe da venda</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {/* Texto ORIGINAL completo do lote — o que o card do catálogo trazia. */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Texto original do lote</p>
            <div className="max-h-40 overflow-y-auto rounded border border-border bg-secondary/40 p-2 text-sm leading-snug text-foreground">
              {orig || sale.title || "—"}
              {!orig && sale.title ? (
                <span className="mt-1 block text-[10px] italic text-muted-foreground">
                  (descritivo completo não guardado nesta venda — texto acima é o título; abra o
                  lote para ver tudo)
                </span>
              ) : null}
            </div>
          </div>

          {/* Todos os campos da venda. */}
          <div className="text-xs">
            <Field label="Artista (atual)" value={artistName} />
            <Field label="Álbum (atual)" value={albumName} />
            <Field label="Título armazenado" value={sale.title} />
            <Field
              label="Estado"
              value={`Disco ${sale.media || "—"} · Capa ${sale.sleeve || "—"}`}
            />
            <Field
              label="Score / Faixa"
              value={`${sale.score ?? "—"}${sale.faixa ? ` · ${sale.faixa}` : ""}`}
            />
            <Field label="Valor" value={money(sale.sold_price)} />
            <Field
              label="Inicial / c/ taxa"
              value={`${sale.initial_price != null ? money(sale.initial_price) : "—"} / ${
                netCost(sale) != null ? money(netCost(sale)) : "—"
              }`}
            />
            <Field label="Demanda" value={demandLabel(sale)} />
            <Field
              label="Casa / UF"
              value={`${sale.house || "—"}${sale.uf ? ` · ${sale.uf}` : ""}`}
            />
            <Field label="Data" value={sale.sold_date ?? "—"} />
            <Field label="Lote (id)" value={sale.lot_id} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ConditionBadges condition={condition} />
            {sale.source_url ? (
              <a
                href={sale.source_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
              >
                Abrir lote no leiloeiro <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          {/* Correção POR VENDA: separa este disco do balaio, atribuindo artista/álbum SÓ dele. */}
          <div className="flex flex-col gap-2 rounded border border-border p-3">
            <span className="text-sm font-medium text-foreground">Corrigir esta venda</span>
            <span className="text-xs text-muted-foreground">
              Define o artista e o álbum SÓ deste disco — útil para tirar os não identificados do
              balaio. Pode escolher um nome existente ou digitar um novo.
            </span>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Artista</span>
              <Input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                list={`${listId}-artists`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Álbum</span>
              <Input
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                list={`${listId}-albums`}
              />
            </label>
            <datalist id={`${listId}-artists`}>
              {suggestions.artists.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <datalist id={`${listId}-albums`}>
              {suggestions.albums.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              title="Remover a correção manual desta venda"
            >
              Voltar ao automático
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editar/renomear/fundir ARTISTA. Alvo = nome digitado; origem = este artista + selecionados. */
function ArtistEditDialog({
  artist,
  allArtists,
  open,
  onClose,
  onApply,
  onClear,
}: {
  artist: ArtistAgg;
  allArtists: ArtistAgg[];
  open: boolean;
  onClose: () => void;
  onApply: (sourceKeys: string[], name: string) => void;
  onClear: () => void;
}) {
  const [name, setName] = useState(artist.artist);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reinicia o estado ao (re)abrir para este artista.
  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== artist.key) {
    openedFor.current = artist.key;
    setName(artist.artist);
    setFilter("");
    setSelected(new Set());
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const filterNorm = normalizeForMatch(filter);
  const candidates = useMemo(
    () =>
      allArtists
        .filter((a) => a.key !== artist.key)
        .filter((a) => !filterNorm || normalizeForMatch(a.artist).includes(filterNorm))
        .slice(0, 60),
    [allArtists, artist.key, filterNorm],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    const target = name.trim() || artist.artist;
    // Chaves de origem: as deste artista + as de cada artista selecionado (fusão).
    const merged = allArtists.filter((a) => selected.has(a.key));
    const sourceKeys = [...new Set([...artist.sourceKeys, ...merged.flatMap((a) => a.sourceKeys)])];
    onApply(sourceKeys, target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar artista</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Nome do artista</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Juntar com outro artista (os álbuns são agrupados; álbuns coincidentes se somam)
            </span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar artista para juntar…"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum artista encontrado.</p>
              ) : (
                candidates.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggle(a.key)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                        on ? "bg-secondary" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex-1 truncate text-foreground">{a.artist}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.albums.length} álbuns · {a.count} vendas
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Isso vira um aprendizado do sistema: variações desses nomes passam a cair sempre neste
              grupo, agora e no futuro.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              title="Voltar ao agrupamento automático"
            >
              Desfazer curadoria
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editar/renomear/fundir ÁLBUM no escopo do artista. Mantém o nome DESTE álbum (salvo se
 *  renomeado); os selecionados se juntam a ele. */
function AlbumEditDialog({
  album,
  artistKey,
  siblings,
  open,
  onClose,
  onApply,
}: {
  album: AlbumAgg;
  artistKey: string;
  siblings: AlbumAgg[];
  open: boolean;
  onClose: () => void;
  onApply: (keys: string[], name: string) => void;
}) {
  const [name, setName] = useState(album.album);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== album.key) {
    openedFor.current = album.key;
    setName(album.album);
    setFilter("");
    setSelected(new Set());
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const filterNorm = normalizeForMatch(filter);
  const candidates = useMemo(
    () =>
      siblings
        .filter((a) => a.key !== album.key)
        .filter((a) => !filterNorm || normalizeForMatch(a.album).includes(filterNorm)),
    [siblings, album.key, filterNorm],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    const target = name.trim() || album.album;
    const merged = siblings.filter((a) => selected.has(a.key));
    // Chaves de origem, no escopo do artista: `${artistKey}|${albumSourceKey}`.
    const rawKeys = [...new Set([...album.sourceKeys, ...merged.flatMap((a) => a.sourceKeys)])];
    const keys = rawKeys.map((k) => `${artistKey}|${k}`);
    onApply(keys, target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar álbum</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Nome do álbum</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Juntar com outro álbum deste artista (viram o mesmo, mantendo este nome)
            </span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar álbum para juntar…"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Nenhum outro álbum deste artista.
                </p>
              ) : (
                candidates.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggle(a.key)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                        on ? "bg-secondary" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex-1 truncate text-foreground">{a.album}</span>
                      <span className="text-xs text-muted-foreground">{a.count} na base</span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Isso vira um aprendizado do sistema: os discos desses álbuns passam a contar como este
              álbum, agora e no futuro.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Colunas ordenáveis da tabela de Detalhes.
type SortCol =
  "data" | "disco" | "capa" | "score" | "faixa" | "inicial" | "valor" | "custo" | "demanda";
const GRADE_INDEX: Record<string, number> = {
  M: 0,
  NM: 1,
  EX: 2,
  "VG+": 3,
  VG: 4,
  "VG-": 5,
  "G+": 6,
  G: 7,
  "G-": 8,
  "F/P": 9,
};
/** Valor comparável de uma venda para cada coluna (null = sempre no fim). */
function sortValue(s: SaleRow, col: SortCol): number | string | null {
  switch (col) {
    case "data":
      return s.sold_date ?? null;
    case "disco":
      return s.media ? (GRADE_INDEX[s.media] ?? null) : null;
    case "capa":
      return s.sleeve ? (GRADE_INDEX[s.sleeve] ?? null) : null;
    case "score":
    case "faixa":
      return s.score;
    case "inicial":
      return s.initial_price ?? null;
    case "valor":
      return s.sold_price;
    case "custo":
      return netCost(s);
    case "demanda":
      return s.views ?? s.bids ?? null;
    default:
      return null;
  }
}

function DetailDialog({
  album,
  open,
  onClose,
}: {
  album: AlbumAgg;
  open: boolean;
  onClose: () => void;
}) {
  // Padrão: score ascendente (pior → melhor), como o eixo dos mini cards.
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "score", dir: 1 });
  const sorted = useMemo(() => {
    const list = [...album.sales];
    const { col, dir } = sort;
    list.sort((a, b) => {
      const va = sortValue(a, col);
      const vb = sortValue(b, col);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulos sempre ao fim
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
    return list;
  }, [album.sales, sort]);

  const onSort = (col: SortCol) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }));

  const arrow = (col: SortCol) => (sort.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ col, label, extra }: { col: SortCol; label: string; extra?: string }) => (
    <th className="py-1 pr-3" title={extra}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center hover:text-foreground ${
          sort.col === col ? "font-semibold text-foreground" : ""
        }`}
      >
        {label}
        {arrow(col)}
      </button>
    </th>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{album.album}</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <Th col="data" label="Data" />
                <Th col="disco" label="Disco" />
                <Th col="capa" label="Capa" />
                <Th col="score" label="Score" />
                <Th col="faixa" label="Faixa" />
                <Th col="inicial" label="Inicial" />
                <Th col="valor" label="Valor" />
                <Th
                  col="custo"
                  label="Custo c/ taxa"
                  extra="Custo real = valor + taxa do leiloeiro"
                />
                <Th col="demanda" label="Demanda" extra="Visualizações · lances" />
                <th className="py-1">Lote</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.lot_id} className="border-t border-border">
                  <td className="py-1 pr-3 text-muted-foreground">{s.sold_date ?? "—"}</td>
                  <td className="py-1 pr-3">{s.media || "—"}</td>
                  <td className="py-1 pr-3">{s.sleeve || "—"}</td>
                  <td className="py-1 pr-3">{s.score ?? "—"}</td>
                  <td className="py-1 pr-3">{s.faixa || "—"}</td>
                  <td className="py-1 pr-3 text-muted-foreground" title={discountTip(s)}>
                    {s.initial_price != null ? money(s.initial_price) : "—"}
                  </td>
                  <td className="py-1 pr-3 font-semibold text-foreground">{money(s.sold_price)}</td>
                  <td className="py-1 pr-3 text-muted-foreground" title={feeTip(s)}>
                    {netCost(s) != null ? money(netCost(s)) : "—"}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{demandLabel(s)}</td>
                  <td className="py-1">
                    {s.source_url ? (
                      <a
                        href={s.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                        aria-label="Abrir lote no leiloeiro"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

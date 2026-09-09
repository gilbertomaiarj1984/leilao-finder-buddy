import { useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Disc3,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AiProviderSelect } from "@/components/vinyl/ai-provider-controls";
import { scoreTone } from "@/components/vinyl/ai-score-utils";
import { fmtMoney } from "@/components/vinyl/ai-score-utils";
import { AI_PROVIDER_SHORT, type AiProvider } from "@/lib/ai-provider";
import { type AlbumAgg, type ArtistAgg, buildAnalytics, type SaleRow } from "@/lib/analytics";
import {
  getAiProvider,
  getVinylSales,
  reidentifySales,
  setAiProvider,
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

function VinilAnalyticsPage() {
  const queryClient = useQueryClient();
  const fetchSales = useServerFn(getVinylSales);
  const runReident = useServerFn(reidentifySales);
  const fetchAiProvider = useServerFn(getAiProvider);
  const runSetAiProvider = useServerFn(setAiProvider);
  const sales = useQuery({
    queryKey: ["vinyl-sales"] as const,
    queryFn: () => fetchSales(),
    staleTime: 10 * 60 * 1000,
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

  const rows = useMemo(() => (sales.data ?? []) as SaleRow[], [sales.data]);
  const analytics = useMemo(() => buildAnalytics(rows), [rows]);

  const [search, setSearch] = useState("");
  const searchNorm = normalizeForMatch(search);
  const artists = useMemo(
    () =>
      !searchNorm
        ? analytics
        : analytics.filter(
            (a) =>
              normalizeForMatch(a.artist).includes(searchNorm) ||
              a.albums.some((al) => normalizeForMatch(al.album).includes(searchNorm)),
          ),
    [analytics, searchNorm],
  );

  const totals = useMemo(() => {
    const priced = rows.map((r) => r.sold_price).filter((v): v is number => typeof v === "number");
    const sum = priced.reduce((a, b) => a + b, 0);
    return {
      sales: rows.length,
      artists: analytics.length,
      avg: priced.length ? Math.round(sum / priced.length) : null,
    };
  }, [rows, analytics]);

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
          <StatChip label="Preço médio" value={money(totals.avg)} />
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
              <ArtistRow key={a.artist} artist={a} />
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

function ArtistRow({ artist }: { artist: ArtistAgg }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/40"
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
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {artist.albums.map((al) => (
            <AlbumRow key={al.album} album={al} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AlbumRow({ album }: { album: AlbumAgg }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground">{album.album}</span>
        <span className="text-xs text-muted-foreground">
          {album.count} na base · {money(album.minPrice)}–{money(album.maxPrice)}
        </span>
        <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-semibold text-primary">
          {money(album.avgPrice)}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          {/* Médias por Faixa de Classificação. */}
          {album.faixas.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {album.faixas.map((f) => (
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
              <SaleMarker key={s.lot_id} sale={s} />
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
    </div>
  );
}

function SaleMarker({ sale }: { sale: SaleRow }) {
  const grade =
    sale.media || sale.sleeve
      ? `${sale.media || "?"}/${sale.sleeve || "?"}`
      : sale.faixa || "estado —";
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-1 rounded border border-border bg-card p-2 text-center">
      <span
        className={`w-full truncate rounded px-1 py-0.5 text-[11px] font-semibold ${scoreTone(sale.score)}`}
        title={`Disco ${sale.media || "—"} · Capa ${sale.sleeve || "—"}${
          sale.score !== null ? ` · Score ${sale.score}` : ""
        }`}
      >
        {sale.score !== null ? sale.score : "—"}
      </span>
      <span className="w-full truncate text-[10px] text-muted-foreground" title={grade}>
        {grade}
      </span>
      <span className="text-xs font-semibold text-foreground">{money(sale.sold_price)}</span>
    </div>
  );
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
                <th className="py-1 pr-3">Data</th>
                <th className="py-1 pr-3">Disco</th>
                <th className="py-1 pr-3">Capa</th>
                <th className="py-1 pr-3">Score</th>
                <th className="py-1 pr-3">Faixa</th>
                <th className="py-1 pr-3">Inicial</th>
                <th className="py-1 pr-3">Valor</th>
                <th className="py-1 pr-3" title="Custo real = valor + taxa do leiloeiro">
                  Custo c/ taxa
                </th>
                <th className="py-1 pr-3" title="Visualizações · lances">
                  Demanda
                </th>
                <th className="py-1">Lote</th>
              </tr>
            </thead>
            <tbody>
              {album.sales.map((s) => (
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

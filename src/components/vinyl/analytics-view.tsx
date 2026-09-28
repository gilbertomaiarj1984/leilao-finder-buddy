import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { BarChart3, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiProviderSelect, GeminiModelSelect } from "@/components/vinyl/ai-provider-controls";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import type { AiProvider, GeminiModel } from "@/lib/ai-provider";
import {
  type AnalyticsAliases,
  type ArtistAgg,
  buildAnalytics,
  type SaleRow,
} from "@/lib/analytics";
import { normalizeForMatch } from "@/lib/vinyl-parse";
import { ArtistRow, EmptyState, HiddenPanel, SortToggle, StatChip } from "./analytics-rows";
import {
  ApplySaleOverride,
  ArtistSort,
  ExcludeArtist,
  ExcludeSale,
  ReidentAllAlbums,
  ReidentGroup,
} from "./analytics-shared";

// Componente COMPARTILHADO entre a página autenticada (`/vinil-analytics`, com curadoria/IA) e a
// pública somente-leitura (`/vinil-analytics-publico`, link com token diário — ver
// `access.server.ts`/`leiloesbr.functions.ts`). `readOnly=true` esconde TODO controle de
// mutação (editar/fundir artista ou álbum, corrigir/excluir venda, excluir artista,
// reidentificar por IA, seletor de provedor/modelo de IA) — só ordenação/filtro/expansão
// continuam ativos. `handlers`/`ai` são omitidos no modo público (só existem no modo editável).

/** Handlers de MUTAÇÃO — só existem no modo editável (autenticado). No modo `readOnly`, todo
 *  controle que os chamaria é omitido do DOM (não só desabilitado). */
export type AnalyticsMutationHandlers = {
  onApplyArtistAlias: (sourceKeys: string[], name: string) => void;
  onClearArtist: (artist: ArtistAgg) => void;
  onApplyAlbumAlias: (keys: string[], name: string) => void;
  onApplySaleOverride: ApplySaleOverride;
  onExcludeSale: ExcludeSale;
  onExcludeArtist: ExcludeArtist;
  onReidentGroup: ReidentGroup;
  onReidentAllAlbums: ReidentAllAlbums;
  onRestoreSale: (lotId: string) => void;
  onRestoreArtist: (key: string) => void;
};

export type AnalyticsAiControls = {
  provider: AiProvider;
  geminiModel: GeminiModel;
  onChangeProvider: (provider: AiProvider) => void;
  onChangeGeminiModel: (model: GeminiModel) => void;
  reidentifying: boolean;
  onReidentifyAll: () => void;
};

export function AnalyticsView({
  rows,
  aliases,
  readOnly,
  isLoading = false,
  isFetching = false,
  onRefetch,
  handlers,
  ai,
  headerExtra,
}: {
  rows: SaleRow[];
  aliases: AnalyticsAliases | undefined;
  readOnly: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  onRefetch?: () => void;
  handlers?: AnalyticsMutationHandlers;
  ai?: AnalyticsAiControls;
  headerExtra?: ReactNode;
}) {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle`, só no mobile.
  const [barsHidden, setBarsHidden] = useState(false);
  const canEdit = !readOnly && !!handlers;

  const analytics = useMemo(() => buildAnalytics(rows, aliases), [rows, aliases]);

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
    const albumsByArtist = new Map<string, string[]>();
    for (const a of analytics) {
      artistsSet.add(a.artist);
      const albumNames = a.albums.map((al) => al.album);
      for (const name of albumNames) albumsSet.add(name);
      albumsByArtist.set(normalizeForMatch(a.artist), albumNames);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return { artists: sort(artistsSet), albums: sort(albumsSet), albumsByArtist };
  }, [analytics]);

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <HideableBar hidden={barsHidden} className="top-0 z-30">
        <header className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
            <div>
              <div className="flex items-center gap-3">
                {headerExtra}
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Vinil Analytics
                  {readOnly ? (
                    <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Somente leitura
                    </span>
                  ) : null}
                </h1>
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Preços de venda por artista e álbum (a casa de leilão é irrelevante). Da pior à
                melhor conservação, com médias por Faixa de Classificação.
              </p>
            </div>
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
              {canEdit && ai ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={ai.onReidentifyAll}
                  disabled={ai.reidentifying}
                  title="Passar a IA por todo o histórico: ajusta artista/álbum (título + descrição) e padroniza os nomes para não duplicar registros. Usa o provedor de IA selecionado ao lado."
                >
                  <Sparkles className={`mr-2 h-4 w-4 ${ai.reidentifying ? "animate-pulse" : ""}`} />
                  {ai.reidentifying ? "Reidentificando…" : "Reidentificar (IA)"}
                </Button>
              ) : null}
              {onRefetch ? (
                <Button variant="outline" size="sm" onClick={onRefetch} disabled={isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              ) : null}
              {canEdit && ai ? (
                <>
                  <AiProviderSelect
                    value={ai.provider}
                    onChange={ai.onChangeProvider}
                    disabled={ai.reidentifying}
                  />
                  <GeminiModelSelect
                    value={ai.geminiModel}
                    onChange={ai.onChangeGeminiModel}
                    disabled={ai.reidentifying}
                  />
                </>
              ) : null}
            </div>
          </div>
        </header>
      </HideableBar>

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

        {isLoading ? (
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
                readOnly={readOnly}
                onApplyArtist={handlers?.onApplyArtistAlias}
                onClearArtist={handlers ? () => handlers.onClearArtist(a) : undefined}
                onApplyAlbum={handlers?.onApplyAlbumAlias}
                onApplySaleOverride={handlers?.onApplySaleOverride}
                onReidentGroup={handlers?.onReidentGroup}
                onReidentAllAlbums={handlers?.onReidentAllAlbums}
                onExcludeArtist={handlers?.onExcludeArtist}
                onExcludeSale={handlers?.onExcludeSale}
              />
            ))}
          </div>
        )}

        {!readOnly && handlers ? (
          <HiddenPanel
            aliases={aliases}
            onRestoreSale={handlers.onRestoreSale}
            onRestoreArtist={handlers.onRestoreArtist}
          />
        ) : null}
      </div>
    </main>
  );
}

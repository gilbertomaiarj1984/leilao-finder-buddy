import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Disc3, Loader2, LogOut, RefreshCw, Sparkles } from "lucide-react";
import { Component, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { MobileDashboardHeader } from "@/components/vinyl/mobile/mobile-dashboard-header";
import { homeTabOf } from "@/components/vinyl/mobile/mobile-nav-utils";
import {
  setHomeNav,
  useMobileNavState,
  type HomeTab,
} from "@/components/vinyl/mobile/mobile-nav-store";
import { TODAY_INDEX } from "@/lib/day-bar";
import { useIsMobile } from "@/lib/use-is-mobile";
import { LiveAuctions } from "@/components/vinyl/live-auctions";
import { OwnedPanel } from "@/components/vinyl/owned-panel";
import { getAccessStatus } from "@/lib/leiloesbr.functions";
import { AiModelSelect } from "@/components/vinyl/ai-provider-controls";
import { LookoutAskDialog } from "@/components/vinyl/lookout-ask-dialog";
import { ExcludeLotDialog } from "@/components/vinyl/exclude-lot-dialog";
import { matchedAlbumTerms, ownedCandidate } from "@/lib/wantlist-match";

import { formatUpdatedAt, useDashboardData } from "@/components/vinyl/dashboard/use-dashboard-data";
import { BidsTab } from "@/components/vinyl/dashboard/bids-tab";
import { DashboardHeader } from "@/components/vinyl/dashboard/dashboard-header";
import { DayTab } from "@/components/vinyl/dashboard/day-tab";
import { WatchedTab } from "@/components/vinyl/dashboard/watched-tab";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Garimpo de Vinil — leilões dos próximos 5 dias" },
      {
        name: "description",
        content:
          "Varredura dos lotes de disco de vinil em leilão no LeilõesBR nos próximos 5 dias, agrupados por dia, casa de leilão e artista, com vigia sincronizada.",
      },
      { property: "og:title", content: "Garimpo de Vinil — leilões dos próximos 5 dias" },
      {
        property: "og:description",
        content:
          "LPs, compactos e bolachões em leilão nos próximos 5 dias, organizados por dia, casa e artista.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
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
    // /api/auth/logout limpa o cookie de sessão e redireciona pra /auth
    // (tratado direto em server.ts — ver auth.server.ts); navegação de página
    // inteira, não RPC de server function.
    window.location.href = "/api/auth/logout";
  }

  if (access.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (access.isError || !access.data?.allowed) {
    const accessMessage = access.isError
      ? "Não foi possível validar o seu acesso."
      : access.data?.configured === false
        ? "O e-mail autorizado não está carregado no servidor. Reinicie a prévia ou reconfigure o secret LEILOESBR_EMAIL."
        : access.data?.email
          ? `A conta ${access.data.email} não é o e-mail cadastrado nas casas de leilão.`
          : "Não foi possível validar o seu acesso.";
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">Acesso não autorizado</h1>
          <p className="mt-3 text-sm text-muted-foreground">{accessMessage}</p>
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

function VinylDashboard({ onSignOut, email }: { onSignOut: () => Promise<void>; email: string }) {
  const d = useDashboardData();
  const mobile = useIsMobile();
  const { menuExtraHost } = useMobileNavState();
  const {
    barsHidden,
    setBarsHidden,
    tab,
    setTab,
    setArtistFilter,
    lots,
    barDays,
    setOwnedPanelLot,
    setExcludeTarget,
    ownedPanelLot,
    ownedResolutionFor,
    collById,
    ownedCands,
    identityById,
    EMPTY_IDENTITY,
    collectionQuery,
    collectionLinksQuery,
    collectionFeedbackQuery,
    dismissCollectionMatchMutation,
    applyDecision,
    excludeTarget,
    excludeMutation,
    footerExtraHost,
    aiMode,
    changeAiMode,
    refreshAll,
    refreshingCollection,
    refreshCollectionMatches,
    refreshingAll,
    refreshPct,
    refreshPhase,
    watched,
    bids,
  } = d;

  const selectTab = (value: string) => {
    setTab(value);
    setArtistFilter("");
  };

  // Celular: a barra inferior (montada no layout) troca de aba por aqui e mostra os contadores.
  const watchedCount = (watched.data ?? []).length;
  const bidsCount = (bids.data ?? []).length;
  useEffect(() => {
    if (!mobile) return;
    setHomeNav({
      tab: homeTabOf(tab),
      setTab: (target: HomeTab) =>
        selectTab(
          target === "days" ? (/^day-\d+$/.test(tab) ? tab : `day-${TODAY_INDEX}`) : target,
        ),
      watchedCount,
      bidsCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectTab só usa setters estáveis
  }, [mobile, tab, watchedCount, bidsCount]);
  useEffect(() => () => setHomeNav(null), []);

  return (
    <main className="min-h-screen bg-background">
      {mobile ? null : (
        <MobileTopToggle
          collapsed={barsHidden}
          onToggle={() => setBarsHidden((c) => !c)}
          alwaysVisible
        />
      )}
      <Tabs value={tab} onValueChange={selectTab}>
        {mobile ? (
          <MobileDashboardHeader d={d} onSelectTab={selectTab} />
        ) : (
          <DashboardHeader d={d} onSignOut={onSignOut} email={email} />
        )}

        <div className="mx-auto max-w-6xl px-4 pt-3 pb-8">
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
            <>
              {barDays.map((day, index) => (
                <DayTab key={day} d={d} day={day} index={index} />
              ))}

              <WatchedTab d={d} />

              <BidsTab d={d} />
            </>
          )}
        </div>
      </Tabs>
      {ownedPanelLot
        ? (() => {
            const lot = ownedPanelLot;
            const res = ownedResolutionFor(lot);
            const relatedId =
              res.kind === "linked" || res.kind === "suggested"
                ? res.itemId
                : res.kind === "auto"
                  ? res.hit.id
                  : null;
            const relatedItem = relatedId ? (collById.get(relatedId) ?? null) : null;
            // Termos que causaram o casamento AUTOMÁTICO/sugerido (só faz sentido oferecer
            // negar quando não foi o próprio usuário quem vinculou manualmente).
            const matchedTerms =
              relatedId && (res.kind === "auto" || res.kind === "suggested")
                ? matchedAlbumTerms(
                    ownedCands.find((c) => c.id === relatedId) ??
                      ownedCandidate({ id: "", artist: "", album: null, year: null }),
                    identityById.get(lot.id) ?? EMPTY_IDENTITY,
                  )
                : [];
            return (
              <OwnedPanel
                open
                onClose={() => setOwnedPanelLot(null)}
                lotTitle={lot.title}
                resolution={res}
                relatedItem={relatedItem}
                collection={collectionQuery.data ?? []}
                busy={collectionLinksQuery.isFetching || collectionFeedbackQuery.isFetching}
                matchedTerms={matchedTerms}
                onDismissTerm={(term) => dismissCollectionMatchMutation.mutate([term])}
                onConfirm={() => {
                  if (relatedId) applyDecision(lot, relatedId, relatedId);
                  setOwnedPanelLot(null);
                }}
                onReject={() => {
                  applyDecision(lot, false, relatedId);
                  setOwnedPanelLot(null);
                }}
                onReactivate={() => {
                  applyDecision(lot, null, null);
                  setOwnedPanelLot(null);
                }}
                onLink={(itemId) => {
                  applyDecision(lot, itemId, itemId);
                  setOwnedPanelLot(null);
                }}
              />
            );
          })()
        : null}
      <LookoutAskDialog
        label={d.lookoutAsk ? d.lookoutAsk.lot.title : null}
        candidates={d.lookoutAsk?.candidates ?? []}
        onChoose={d.answerLookoutAsk}
        onCancel={() => d.setLookoutAsk(null)}
      />
      <ExcludeLotDialog
        target={excludeTarget}
        busy={excludeMutation.isPending}
        onClose={() => setExcludeTarget(null)}
        onConfirm={(reason) =>
          excludeMutation.mutate({ lotId: excludeTarget!.id, reason: reason || undefined })
        }
      />
      {(mobile ? menuExtraHost : footerExtraHost) &&
        createPortal(
          <>
            <div
              className="flex items-center gap-1.5"
              title="Modo da avaliação automática por IA (controla o gasto de créditos). A análise sob demanda, pelos botões nos dias/casas, funciona em qualquer modo."
            >
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <Select
                value={aiMode}
                onValueChange={(value) => changeAiMode(value as "off" | "all" | "watched")}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Modo da IA">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">IA: desligada</SelectItem>
                  <SelectItem value="all">IA: tudo</SelectItem>
                  <SelectItem value="watched">IA: vigiados + lances</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <AiModelSelect />
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={refreshingAll || lots.isFetching}
              title="Forçar atualização geral da lista"
            >
              {refreshingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {refreshingAll && refreshPct !== null
                ? `Atualizando… ${refreshPct}%`
                : refreshingAll && refreshPhase
                  ? refreshPhase
                  : "Atualizar tudo"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshCollectionMatches()}
              disabled={refreshingCollection}
              title="Relaciona todos os lotes com os discos recém-adicionados à Coleção, sem refazer relações que você já marcou como 'não tenho'"
            >
              {refreshingCollection ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Disc3 className="mr-2 h-4 w-4" />
              )}
              Atualizar relações
            </Button>
            {lots.data?.updatedAt ? (
              <span className="ml-auto shrink-0" title="Última atualização da lista">
                Atualizado: {formatUpdatedAt(lots.data.updatedAt)}
              </span>
            ) : null}
          </>,
          (mobile ? menuExtraHost : footerExtraHost)!,
        )}
    </main>
  );
}

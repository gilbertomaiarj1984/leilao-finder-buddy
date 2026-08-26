import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  Gavel,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BidStatBadges, HouseStatBadges } from "@/components/vinyl/badges";
import { BidHouseSections, type BidCard } from "@/components/vinyl/bid-house-sections";
import { ArtistFilter, PriceFilter } from "@/components/vinyl/filters";
import {
  artistOptions,
  bidMatchesSearch,
  computeBidStats,
  computeHouseStats,
  dayLabel,
  groupByArtist,
  groupByHouse,
  groupWatchedByHouse,
  houseAnchor,
  matchesPriceRange,
  watchedDateToKey,
  watchedMatchesSearch,
  type HouseGroup,
} from "@/components/vinyl/grouping";
import { LiveAuctions } from "@/components/vinyl/live-auctions";
import { LotCard } from "@/components/vinyl/lot-card";
import {
  buildInterestMatcher,
  toLotMarket,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import { supabase } from "@/integrations/supabase/client";
import {
  enrichLotes,
  getAccessStatus,
  getLotAi,
  getLotMarket,
  getNextBids,
  getUserInterests,
  getVerifiedHouses,
  getVinylLots,
  listMyBids,
  scrapeVinylChunk,
  setVerifiedHouses,
} from "@/lib/leiloesbr.functions";
import { listWatched, toggleWatch } from "@/lib/leiloesbr-watch.functions";
import {
  auctionFinished,
  normalizeForMatch,
  UNCLASSIFIED_LABEL,
  type VinylLot,
} from "@/lib/vinyl-parse";

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

const lotsQuery = { queryKey: ["vinyl-lots"] as const };
const watchedQuery = { queryKey: ["vinyl-watched"] as const };

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

/** "26/08 às 14:30" no fuso de São Paulo, ou "" quando não há data. */
function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return fmt.format(date).replace(", ", " às ");
}

function VinylDashboard({ onSignOut, email }: { onSignOut: () => Promise<void>; email: string }) {
  const [tab, setTab] = useState<string>("day-0");
  const [artistFilter, setArtistFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [watchedViewDay, setWatchedViewDay] = useState<string | null>(null);
  const [bidsViewDay, setBidsViewDay] = useState<string | null>(null);
  const [showFinishedDays, setShowFinishedDays] = useState<Set<string>>(new Set());
  const toggleShowFinished = (day: string) =>
    setShowFinishedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
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
  // Casas já verificadas (chave `${dia}|${casa}`): marcador verde que move a casa
  // para a seção "Já verificadas" no fim da lista. PERSISTE no servidor (app_state,
  // via getVerifiedHouses/setVerifiedHouses) — antes ficava só no localStorage do
  // navegador, que se perdia ao trocar de dispositivo/navegador ou usar a URL de
  // preview (outra origem). O localStorage vira só um cache local (leitura instantânea).
  const [verifiedHouses, setVerifiedSet] = useState<Set<string>>(new Set());
  const setHouseArtistFor = (key: string, value: string) =>
    setHouseArtist((prev) => ({ ...prev, [key]: value }));
  const setHousePriceFor = (key: string, value: string) =>
    setHousePrice((prev) => ({ ...prev, [key]: value }));
  const queryClient = useQueryClient();
  const fetchLots = useServerFn(getVinylLots);
  const fetchWatched = useServerFn(listWatched);
  const fetchBids = useServerFn(listMyBids);
  const runToggle = useServerFn(toggleWatch);
  const runChunk = useServerFn(scrapeVinylChunk);
  const runEnrich = useServerFn(enrichLotes);
  const fetchVerified = useServerFn(getVerifiedHouses);
  const saveVerified = useServerFn(setVerifiedHouses);
  const fetchNextBids = useServerFn(getNextBids);
  const fetchLotAi = useServerFn(getLotAi);
  const fetchLotMarket = useServerFn(getLotMarket);
  const fetchInterests = useServerFn(getUserInterests);

  const lots = useQuery({
    ...lotsQuery,
    queryFn: () => fetchLots(),
    // Carrega uma vez ao abrir; não recarrega ao navegar/trocar de aba/focar a janela.
    staleTime: 2 * 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const watched = useQuery({
    ...watchedQuery,
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
  // Avaliações da IA (score/raridade/oportunidade) e interesses do usuário: alimentam o
  // badge de nota no canto do card. Best-effort — sem avaliação, o card fica como hoje.
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
  const lotMarketQuery = useQuery({
    queryKey: ["lot-market"] as const,
    queryFn: () => fetchLotMarket(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const marketById = useMemo(() => {
    const map = new Map<string, LotMarket>();
    for (const r of lotMarketQuery.data ?? []) map.set(r.id, toLotMarket(r));
    return map;
  }, [lotMarketQuery.data]);
  // Junta a avaliação (por id) com o "casa com meus interesses" (calculado do título).
  const aiFor = (lot: { id: string; title?: string }): LotAi | undefined => {
    const base = aiById.get(lot.id);
    if (!base) return undefined;
    return { ...base, matchesInterests: matchesInterest(lot.title ?? "") };
  };
  const marketFor = (lot: { id: string }): LotMarket | undefined => marketById.get(lot.id);

  // Casas verificadas: fonte da verdade é o servidor (app_state). O localStorage é só
  // um cache para pintar a tela na hora, sem esperar a rede.
  const LS_VERIFIED = "garimpo:verifiedHouses";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_VERIFIED);
      if (raw) setVerifiedSet(new Set<string>(JSON.parse(raw)));
    } catch {
      /* localStorage indisponível: segue sem cache */
    }
  }, []);
  const verifiedQuery = useQuery({
    queryKey: ["verified-houses"] as const,
    queryFn: () => fetchVerified(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const migratedVerified = useRef(false);
  useEffect(() => {
    if (!verifiedQuery.data || migratedVerified.current) return;
    migratedVerified.current = true;
    const server = new Set<string>(verifiedQuery.data);
    // Migração única: se o localStorage tinha marcações que o servidor ainda não
    // conhece (estado pré-persistência), envia para o servidor para não perdê-las.
    let local: string[] = [];
    try {
      local = JSON.parse(localStorage.getItem(LS_VERIFIED) ?? "[]");
    } catch {
      local = [];
    }
    const merged = new Set<string>([...server, ...local]);
    setVerifiedSet(merged);
    try {
      localStorage.setItem(LS_VERIFIED, JSON.stringify([...merged]));
    } catch {
      /* ignore */
    }
    if (merged.size > server.size) {
      void saveVerified({ data: { keys: [...merged] } }).catch(() => {
        /* best-effort: a marcação continua no cache local */
      });
    }
  }, [verifiedQuery.data, saveVerified]);
  const toggleVerified = (key: string) => {
    setVerifiedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      const list = [...next];
      try {
        localStorage.setItem(LS_VERIFIED, JSON.stringify(list));
      } catch {
        /* localStorage indisponível: segue sem cache */
      }
      // Persiste no servidor; em falha, reverte o estado local e avisa.
      void saveVerified({ data: { keys: list } })
        .then(() => queryClient.setQueryData(["verified-houses"], list))
        .catch((error: unknown) => {
          setVerifiedSet(prev);
          try {
            localStorage.setItem(LS_VERIFIED, JSON.stringify([...prev]));
          } catch {
            /* ignore */
          }
          toast.error((error as Error)?.message || "Não foi possível salvar a casa verificada");
        });
      return next;
    });
  };

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

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshPct, setRefreshPct] = useState<number | null>(null);
  // Atualiza tudo em BLOCOS sequenciais de páginas (uma requisição por vez),
  // evitando uma varredura completa que estoura o tempo do servidor em produção.
  const refreshAll = () => {
    void (async () => {
      setRefreshingAll(true);
      setRefreshPct(0);
      try {
        const SIZE = 15;
        let fromPage: number | null = null;
        let total = 0;
        for (let guard = 0; guard < 80; guard += 1) {
          const res = await runChunk({ data: { fromPage, size: SIZE } });
          if (fromPage === null) total = res.total || 0;
          fromPage = res.nextPage;
          // páginas vão da última (total) em direção ao começo da janela
          const scannedTop = total ? total - (fromPage ?? 0) : 0;
          setRefreshPct(total ? Math.min(99, Math.round((scannedTop / total) * 100)) : null);
          if (fromPage === null) break;
        }
        // Preenche o nº do lote (via catálogo das casas) percorrendo os leilões por cursor.
        let enrichOffset = 0;
        for (let guard = 0; guard < 60; guard += 1) {
          const res = await runEnrich({ data: { max: 6, offset: enrichOffset } });
          if (res.done || res.nextOffset == null) break;
          enrichOffset = res.nextOffset;
        }
        const fresh = await fetchLots({ data: {} });
        queryClient.setQueryData(lotsQuery.queryKey, fresh);
        setRefreshPct(100);
        toast.success("Lista atualizada");
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar a lista agora");
      } finally {
        setRefreshingAll(false);
        setRefreshPct(null);
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
  const searchNorm = normalizeForMatch(search);
  const matchesSearch = (lot: VinylLot) =>
    !searchNorm ||
    normalizeForMatch(`${lot.title} ${lot.artist} ${lot.house} ${lot.lote}`).includes(searchNorm);
  const watchedIds = useMemo(
    () => new Set((watched.data ?? []).map((item) => item.idPeca)),
    [watched.data],
  );
  // Status do meu lance por peça (para colorir: verde = ganhando, vermelho = coberto).
  const bidStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bids.data ?? []) map.set(b.idPeca, b.status);
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
  // Valor ATUAL por lote (id `${idLeilao}-${idPeca}`). Não vem na página "Meus lances"
  // nem "Vigiados" — casamos pela varredura geral para exibir o valor atual nesses cards.
  const priceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const lot of lots.data?.lots ?? []) if (lot.price) map.set(lot.id, lot.price);
    return map;
  }, [lots.data]);
  // Meu lance por peça — para exibir "Meu lance" e corrigir o "Atual" (quando venço, o
  // valor atual É o meu lance) também nas abas de dia/vigiados, não só em "Meus lances".
  const myBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bids.data ?? []) if (b.myBid) map.set(b.idPeca, b.myBid);
    return map;
  }, [bids.data]);
  // Próximo lance (NOVO_VALOR do peca.asp) só para VIGIADOS + LANCES (conjunto pequeno;
  // 1 requisição por lote). Alvos = idPeca + url para montar a URL da peça no servidor.
  const nextBidTargets = useMemo(() => {
    const byPeca = new Map<string, { idPeca: string; url: string }>();
    for (const w of watched.data ?? [])
      if (w.idPeca && w.url) byPeca.set(w.idPeca, { idPeca: w.idPeca, url: w.url });
    for (const b of bids.data ?? [])
      if (b.idPeca && b.url && !byPeca.has(b.idPeca))
        byPeca.set(b.idPeca, { idPeca: b.idPeca, url: b.url });
    return [...byPeca.values()];
  }, [watched.data, bids.data]);
  const nextBidsKey = useMemo(
    () =>
      nextBidTargets
        .map((t) => t.idPeca)
        .sort()
        .join(","),
    [nextBidTargets],
  );
  const nextBids = useQuery({
    queryKey: ["next-bids", nextBidsKey] as const,
    queryFn: () => fetchNextBids({ data: { targets: nextBidTargets } }),
    enabled: nextBidTargets.length > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const nextBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [idPeca, value] of Object.entries(nextBids.data ?? {})) map.set(idPeca, value);
    return map;
  }, [nextBids.data]);
  // A URL do site da casa não vem na página de lances — casamos pelo nome da casa
  // com o que já lemos da varredura geral e dos vigiados.
  const houseUrlByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const lot of lots.data?.lots ?? [])
      if (lot.house && lot.houseUrl) map.set(lot.house, lot.houseUrl);
    for (const w of watched.data ?? [])
      if (w.house && w.houseUrl && !map.has(w.house)) map.set(w.house, w.houseUrl);
    return map;
  }, [lots.data, watched.data]);
  // Lances com a URL da casa preenchida, prontos para o agrupamento por casa.
  const bidsWithHouseUrl = useMemo(
    () => (bids.data ?? []).map((b) => ({ ...b, houseUrl: houseUrlByName.get(b.house) ?? "#" })),
    [bids.data, houseUrlByName],
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
              LPs, compactos e bolachões que vão a leilão nos próximos 5 dias, agrupados por dia,
              casa de leilão e artista. A vigia é sincronizada com a sua conta do LeilõesBR.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <Button variant="outline" size="sm" asChild title="Análise de lotes com IA">
              <Link to="/analise">
                <Sparkles className="mr-2 h-4 w-4" />
                Análise
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild title="Painel de mudanças">
              <Link to="/dashboard">
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Painel
              </Link>
            </Button>
            <div className="flex flex-col items-start gap-0.5 sm:items-end">
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
                  : "Atualizar tudo"}
              </Button>
              {lots.data?.updatedAt ? (
                <span
                  className="text-[11px] text-muted-foreground"
                  title="Última atualização da lista"
                >
                  Atualizado: {formatUpdatedAt(lots.data.updatedAt)}
                </span>
              ) : null}
            </div>
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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por título, artista, casa ou nº do lote…"
                className="w-full sm:max-w-md"
              />
              {search ? (
                <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                  Limpar busca
                </Button>
              ) : null}
            </div>
            <TabsList className="mb-6 flex h-auto flex-wrap justify-start gap-1 bg-secondary">
              {days.map((day, index) => (
                <TabsTrigger key={day} value={`day-${index}`}>
                  {dayLabel(day, index)}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {lots.data?.lots.filter(
                      (lot) =>
                        lot.dayKey === day &&
                        !auctionFinished(lot.dayKey, lot.time) &&
                        matchesSearch(lot),
                    ).length ?? 0}
                  </span>
                </TabsTrigger>
              ))}
              <TabsTrigger value="watched">
                Vigiados
                <span className="ml-2 text-xs text-muted-foreground">
                  {
                    (watched.data ?? []).filter((lot) => watchedMatchesSearch(lot, searchNorm))
                      .length
                  }
                </span>
              </TabsTrigger>
              <TabsTrigger value="bids">
                Lances
                <span className="ml-2 text-xs text-muted-foreground">
                  {(bids.data ?? []).filter((bid) => bidMatchesSearch(bid, searchNorm)).length}
                </span>
              </TabsTrigger>
            </TabsList>

            {days.map((day, index) => {
              const rawDay = (lots.data?.lots ?? [])
                .map((lot) =>
                  watchedIds.size ? { ...lot, watched: watchedIds.has(lot.idPeca) } : lot,
                )
                .filter((lot) => lot.dayKey === day);
              const finishedCount = rawDay.filter((lot) =>
                auctionFinished(lot.dayKey, lot.time),
              ).length;
              const showFinished = showFinishedDays.has(day);
              // Por padrão esconde os finalizados (3h após o início); o usuário pode incluí-los.
              // A busca geral (searchNorm) filtra por título/artista/casa/nº do lote.
              const dayLots = (
                showFinished
                  ? rawDay
                  : rawDay.filter((lot) => !auctionFinished(lot.dayKey, lot.time))
              ).filter(matchesSearch);
              const artists = artistOptions(dayLots);
              const globalActive = artistFilter !== "";
              const visibleLots = globalActive
                ? dayLots.filter((lot) => (lot.artist || UNCLASSIFIED_LABEL) === artistFilter)
                : dayLots;
              const groups = groupByHouse(visibleLots);
              const isWatchedView = watchedViewDay === day;
              // Vigiados do dia: a busca principal também filtra aqui.
              const watchedForDay = (watched.data ?? []).filter(
                (lot) =>
                  watchedDateToKey(lot.date) === day && watchedMatchesSearch(lot, searchNorm),
              );
              // Vigiados do dia agrupados por casa e ordenados por nº do lote.
              const watchedByHouse = groupWatchedByHouse(watchedForDay);
              const isBidsView = bidsViewDay === day;
              // Lances do dia: a busca principal também filtra aqui.
              const bidsForDay = bidsWithHouseUrl.filter(
                (bid) => watchedDateToKey(bid.date) === day && bidMatchesSearch(bid, searchNorm),
              );
              // Lances do dia agrupados por casa e ordenados por nº do lote.
              const bidsByHouse = groupWatchedByHouse(bidsForDay);

              return (
                <TabsContent key={day} value={`day-${index}`} className="space-y-6">
                  <div className="sticky top-0 z-20 -mx-4 mb-2 space-y-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-foreground">
                        {dayLabel(day, index)}
                      </span>
                      <button
                        type="button"
                        onClick={() => refreshDay(day)}
                        disabled={refreshingDay === day}
                        title="Forçar atualização deste dia"
                        aria-label={`Forçar atualização de ${dayLabel(day, index)}`}
                        className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                      >
                        {refreshingDay === day ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBidsViewDay(null);
                          setWatchedViewDay((cur) => (cur === day ? null : day));
                        }}
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
                      <button
                        type="button"
                        onClick={() => {
                          setWatchedViewDay(null);
                          setBidsViewDay((cur) => (cur === day ? null : day));
                        }}
                        title="Ver lances deste dia"
                        aria-label={`Ver lances de ${dayLabel(day, index)}`}
                        aria-pressed={isBidsView}
                        className={
                          isBidsView
                            ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                            : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                        }
                      >
                        <Gavel className="h-3.5 w-3.5" />
                        Lances do dia
                        {bidsForDay.length ? (
                          <span className="ml-0.5 text-muted-foreground">{bidsForDay.length}</span>
                        ) : null}
                      </button>
                      {!isWatchedView && !isBidsView ? (
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
                          {finishedCount > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleShowFinished(day)}
                            >
                              {showFinished
                                ? `Ocultar finalizados (${finishedCount})`
                                : `Incluir finalizados (${finishedCount})`}
                            </Button>
                          ) : null}
                        </>
                      ) : isWatchedView ? (
                        <span className="text-xs text-muted-foreground">
                          {watchedForDay.length} lote(s) vigiado(s) neste dia
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {bidsForDay.length} lance(s) neste dia
                          <BidStatBadges stats={computeBidStats(bidsForDay)} />
                        </span>
                      )}
                    </div>
                    {!isWatchedView && !isBidsView && groups.length > 0 ? (
                      <nav className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                        {groups.map((group) => {
                          const houseKey = `${day}|${group.house}`;
                          const isOpen = openHouses.has(houseKey);
                          return (
                            <button
                              key={group.house}
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => {
                                const willOpen = !openHouses.has(houseKey);
                                toggleHouse(houseKey);
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
                              {group.house}
                              <span className="text-muted-foreground">{group.count}</span>
                              <HouseStatBadges
                                stats={computeHouseStats(group.lots, watchedIds, bidStatusById)}
                              />
                            </button>
                          );
                        })}
                      </nav>
                    ) : null}
                  </div>
                  {isWatchedView ? (
                    watched.isLoading ? (
                      <Skeleton className="h-40 w-full" />
                    ) : watchedForDay.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum lote vigiado neste dia.
                      </p>
                    ) : (
                      <div className="space-y-8">
                        {watchedByHouse.map((houseGroup) => (
                          <section key={houseGroup.house} className="space-y-3">
                            <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                                {houseGroup.house}
                              </h2>
                              <Badge variant="secondary">{houseGroup.lots.length} lote(s)</Badge>
                              <HouseStatBadges
                                stats={computeHouseStats(
                                  houseGroup.lots,
                                  watchedIds,
                                  bidStatusById,
                                )}
                              />
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
                                  lot={{
                                    ...lot,
                                    dayKey: lot.date,
                                    watched: true,
                                    myBid: myBidById.get(lot.idPeca),
                                    nextBid: nextBidById.get(lot.idPeca),
                                  }}
                                  busy={pending === lot.idPeca}
                                  ai={aiFor(lot)}
                                  market={marketFor(lot)}
                                  bidStatus={bidStatusById.get(lot.idPeca)}
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
                  ) : isBidsView ? (
                    bids.isLoading ? (
                      <Skeleton className="h-40 w-full" />
                    ) : bidsForDay.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum lance neste dia.</p>
                    ) : (
                      <BidHouseSections
                        houses={bidsByHouse}
                        pending={pending}
                        loteById={loteById}
                        priceById={priceById}
                        nextBidById={nextBidById}
                        onToggle={(bid) => toggle.mutate(bid)}
                      />
                    )
                  ) : groups.length === 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {searchNorm
                          ? "Nenhum lote corresponde à busca neste dia."
                          : artistFilter
                            ? "Nenhum lote deste artista neste dia."
                            : rawDay.length === 0
                              ? "Nenhum disco de vinil na varredura para este dia. Leilões que já estão ao vivo somem da listagem pública — tente “Atualizar tudo”."
                              : `Todos os ${finishedCount} leilão(ões) deste dia já começaram há mais de 3h.`}
                      </p>
                      {!artistFilter && rawDay.length > 0 && !showFinished ? (
                        <Button variant="outline" size="sm" onClick={() => toggleShowFinished(day)}>
                          Mostrar finalizados ({finishedCount})
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    (() => {
                      const renderHouse = (group: HouseGroup) => {
                        const houseKey = `${day}|${group.house}`;
                        const isOpen = openHouses.has(houseKey);
                        const isVerified = verifiedHouses.has(houseKey);
                        const perArtist = globalActive ? "" : (houseArtist[houseKey] ?? "");
                        const perPrice = housePrice[houseKey] ?? "";
                        let houseLots = group.lots;
                        if (perArtist)
                          houseLots = houseLots.filter(
                            (lot) => (lot.artist || UNCLASSIFIED_LABEL) === perArtist,
                          );
                        if (perPrice)
                          houseLots = houseLots.filter((lot) =>
                            matchesPriceRange(lot.price, perPrice),
                          );
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
                                  onClick={() => toggleVerified(houseKey)}
                                  aria-pressed={isVerified}
                                  title={
                                    isVerified
                                      ? "Casa verificada — clique para desmarcar"
                                      : "Marcar casa como verificada"
                                  }
                                  aria-label={
                                    isVerified
                                      ? `Desmarcar ${group.house} como verificada`
                                      : `Marcar ${group.house} como verificada`
                                  }
                                  className={
                                    isVerified
                                      ? "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-green-600 bg-green-600 text-white"
                                      : "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-green-600 hover:text-green-600"
                                  }
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
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
                                <HouseStatBadges
                                  stats={computeHouseStats(houseLots, watchedIds, bidStatusById)}
                                />
                                {group.time ? (
                                  <span className="text-sm text-muted-foreground">
                                    às {group.time}
                                  </span>
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
                              <>
                                {artistGroups.length === 0 ? (
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
                                            lot={{
                                              ...lot,
                                              lote: lot.lote || loteById.get(lot.idPeca) || "",
                                              myBid: myBidById.get(lot.idPeca),
                                              nextBid: nextBidById.get(lot.idPeca),
                                            }}
                                            busy={pending === lot.idPeca}
                                            ai={aiFor(lot)}
                                            market={marketFor(lot)}
                                            bidStatus={bidStatusById.get(lot.idPeca)}
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
                                )}
                                <div className="pt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      toggleHouse(houseKey);
                                      requestAnimationFrame(() =>
                                        document
                                          .getElementById(houseAnchor(group.house, index))
                                          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                                      );
                                    }}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                                  >
                                    <ChevronUp className="h-4 w-4" />
                                    Fechar {group.house}
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </section>
                        );
                      };
                      const verifiedGroups = groups.filter((group) =>
                        verifiedHouses.has(`${day}|${group.house}`),
                      );
                      const unverifiedGroups = groups.filter(
                        (group) => !verifiedHouses.has(`${day}|${group.house}`),
                      );
                      return (
                        <>
                          {unverifiedGroups.map(renderHouse)}
                          {verifiedGroups.length ? (
                            <div className="space-y-6 pt-4">
                              <h2 className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                                <Check className="h-4 w-4 text-green-600" />
                                Já verificadas
                                <span className="font-normal normal-case tracking-normal">
                                  {verifiedGroups.length} casa(s)
                                </span>
                              </h2>
                              {verifiedGroups.map(renderHouse)}
                            </div>
                          ) : null}
                        </>
                      );
                    })()
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
                (() => {
                  // A busca principal filtra os vigiados; o resultado é apresentado
                  // separado por dia e casa de leilão, igual às abas de dia.
                  const filtered = (watched.data ?? []).filter((lot) =>
                    watchedMatchesSearch(lot, searchNorm),
                  );
                  if (filtered.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        Nenhum lote vigiado corresponde à busca.
                      </p>
                    );
                  }
                  const byDay = new Map<string, typeof filtered>();
                  for (const lot of filtered) {
                    const key = watchedDateToKey(lot.date) || lot.date || "";
                    const list = byDay.get(key) ?? [];
                    list.push(lot);
                    byDay.set(key, list);
                  }
                  // Dias sem data ("") vão para o fim; os demais em ordem crescente.
                  const dayKeys = [...byDay.keys()].sort((a, b) => {
                    if (!a) return 1;
                    if (!b) return -1;
                    return a.localeCompare(b);
                  });

                  return (
                    <div className="space-y-10">
                      {dayKeys.map((dayKey) => {
                        const dayLots = byDay.get(dayKey) ?? [];
                        const idx = days.indexOf(dayKey);
                        const label = dayKey ? dayLabel(dayKey, idx >= 0 ? idx : 99) : "Sem data";
                        const houses = groupWatchedByHouse(dayLots);
                        return (
                          <section key={dayKey || "sem-data"} className="space-y-6">
                            <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                              <span className="text-sm font-semibold text-foreground">{label}</span>
                              <span className="text-xs text-muted-foreground">
                                {dayLots.length} lote(s) vigiado(s) em {houses.length} casa(s)
                              </span>
                            </div>
                            {houses.map((houseGroup) => (
                              <section key={houseGroup.house} className="space-y-3">
                                <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
                                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                                    {houseGroup.house}
                                  </h2>
                                  <Badge variant="secondary">
                                    {houseGroup.lots.length} lote(s)
                                  </Badge>
                                  <HouseStatBadges
                                    stats={computeHouseStats(
                                      houseGroup.lots,
                                      watchedIds,
                                      bidStatusById,
                                    )}
                                  />
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
                                      lot={{
                                        ...lot,
                                        dayKey: lot.date,
                                        watched: true,
                                        myBid: myBidById.get(lot.idPeca),
                                      }}
                                      busy={pending === lot.idPeca}
                                      ai={aiFor(lot)}
                                      market={marketFor(lot)}
                                      bidStatus={bidStatusById.get(lot.idPeca)}
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
                          </section>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </TabsContent>

            <TabsContent value="bids" className="space-y-4">
              {bids.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : bids.isError ? (
                <p className="text-sm text-destructive">
                  Não foi possível ler os lances: {(bids.error as Error).message}
                </p>
              ) : (bids.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Você ainda não deu lance em nenhum lote.
                </p>
              ) : (
                (() => {
                  // A busca principal filtra os lances; o resultado é apresentado
                  // separado por dia e casa de leilão, igual às abas de dia e vigiados.
                  const filtered = bidsWithHouseUrl.filter((bid) =>
                    bidMatchesSearch(bid, searchNorm),
                  );
                  if (filtered.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        Nenhum lance corresponde à busca.
                      </p>
                    );
                  }
                  const byDay = new Map<string, BidCard[]>();
                  for (const bid of filtered) {
                    const key = watchedDateToKey(bid.date) || bid.date || "";
                    const list = byDay.get(key) ?? [];
                    list.push(bid);
                    byDay.set(key, list);
                  }
                  // Dias sem data ("") vão para o fim; os demais em ordem crescente.
                  const dayKeys = [...byDay.keys()].sort((a, b) => {
                    if (!a) return 1;
                    if (!b) return -1;
                    return a.localeCompare(b);
                  });

                  return (
                    <div className="space-y-10">
                      {dayKeys.map((dayKey) => {
                        const dayBids = byDay.get(dayKey) ?? [];
                        const idx = days.indexOf(dayKey);
                        const label = dayKey ? dayLabel(dayKey, idx >= 0 ? idx : 99) : "Sem data";
                        const houses = groupWatchedByHouse(dayBids);
                        return (
                          <section key={dayKey || "sem-data"} className="space-y-6">
                            <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
                              <span className="text-sm font-semibold text-foreground">{label}</span>
                              <span className="text-xs text-muted-foreground">
                                {dayBids.length} lance(s) em {houses.length} casa(s)
                              </span>
                              <BidStatBadges stats={computeBidStats(dayBids)} />
                            </div>
                            <BidHouseSections
                              houses={houses}
                              pending={pending}
                              loteById={loteById}
                              priceById={priceById}
                              nextBidById={nextBidById}
                              onToggle={(bid) => toggle.mutate(bid)}
                            />
                          </section>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
}

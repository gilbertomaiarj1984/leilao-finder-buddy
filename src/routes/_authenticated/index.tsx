import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  Gavel,
  Library,
  Loader2,
  LogOut,
  Radio,
  RefreshCw,
  Search as SearchIcon,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuctionStatusInline, BidStatBadges, HouseStatBadges } from "@/components/vinyl/badges";
import { BidHouseSections, type BidCard } from "@/components/vinyl/bid-house-sections";
import { ArtistFilter, PriceFilter } from "@/components/vinyl/filters";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
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
  houseAuctionInfo,
  matchesPriceRange,
  watchedDateToKey,
  watchedMatchesSearch,
  type HouseGroup,
} from "@/components/vinyl/grouping";
import { LiveAuctions } from "@/components/vinyl/live-auctions";
import { LotCard } from "@/components/vinyl/lot-card";
import { type Condition, type Grade, parseConditionFromText, scoreCondition } from "@/lib/grading";
import { OwnedPanel } from "@/components/vinyl/owned-panel";
import {
  buildInterestMatcher,
  parseAiAlbum,
  toLotMarket,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeOnDemand,
  applyCollectionDecision,
  enrichLotes,
  getAccessStatus,
  getAiMode,
  getAiProvider,
  getCollectionFeedback,
  getCollectionLinks,
  getLotAi,
  getLotCondition,
  getLotIdent,
  getLotMarket,
  getLotDetails,
  getSoldLots,
  getUserInterests,
  getVerifiedHouses,
  getVinylLots,
  listMyBids,
  scrapeVinylChunk,
  setAiMode,
  setAiProvider,
  setLotTags,
  setVerifiedHouses,
} from "@/lib/leiloesbr.functions";
import { AiProviderSelect } from "@/components/vinyl/ai-provider-controls";
import { AI_PROVIDER_SHORT, type AiProvider } from "@/lib/ai-provider";
import { listWatched, toggleWatch } from "@/lib/leiloesbr-watch.functions";
import type { WatchedLot } from "@/lib/leiloesbr-watch.server";
import type { MyBid } from "@/lib/leiloesbr-bids.server";
import { useBidCoveredAlerts } from "@/lib/bid-alerts";
import { getCollection } from "@/lib/collection.functions";
import type { CollectionItem } from "@/lib/collection.server";
import {
  BIDS_ACCUM_STORAGE_KEY,
  loadAccum,
  mergeWatchedAccum,
  saveAccum,
  WATCHED_ACCUM_STORAGE_KEY,
} from "@/lib/watched-accum";
import {
  auctionFinished,
  COMPILATION_LABEL,
  isDiscBundle,
  LOTE_LABEL,
  normalizeForMatch,
  searchRelevance,
  titleCase,
  UNCLASSIFIED_LABEL,
  type VinylLot,
} from "@/lib/vinyl-parse";
import {
  lotIdentity,
  ownedCandidate,
  ownedMatchForLot,
  ownedSignatureFromLot,
  resolveOwned,
  type CollectionLinks,
  type LotIdentity,
  type OwnedFeedback,
  type OwnedHit,
  type OwnedResolution,
} from "@/lib/wantlist-match";

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
const bidsQuery = { queryKey: ["vinyl-my-bids"] as const };

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

// Mede a altura de um elemento ao vivo via `ResizeObserver`, reanexando sozinho quando o nó
// muda (cobre conteúdo condicional, ex.: só monta depois que `lots` carrega).
function useMeasuredHeight() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, height] as const;
}

function VinylDashboard({ onSignOut, email }: { onSignOut: () => Promise<void>; email: string }) {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle` (agora visível também no
  // desktop) — desde que a versão anterior por scroll (`useHideOnScroll`) ficava piscando
  // (recálculo de altura de um `sticky` durante a transição realimentava a lógica de
  // direção do scroll). No desktop, esconder recolhe tudo MENOS a lista de dias/abas
  // (`TabsList`) — ela fica de fora do `HideableBar` colapsável, sempre visível, pra sempre
  // dar pra trocar de dia/Vigiados/Lances mesmo com o resto escondido.
  const [barsHidden, setBarsHidden] = useState(false);
  // Altura real de cada parte do header sticky, medida ao vivo — as barras sticky internas
  // (dia/casas, seções de Vigiados/Lances) usam a soma como `top` para colar logo abaixo do
  // que estiver visível no momento, em vez de ficarem escondidas atrás. A `ref` fica no
  // CONTEÚDO de cada parte (altura natural estável), não no wrapper que esconde/mostra
  // (`HideableBar`) — senão o ResizeObserver ficaria medindo a própria transição de altura
  // dele.
  const [headerRef, headerHeight] = useMeasuredHeight();
  const [tabsBarRef, tabsBarHeight] = useMeasuredHeight();
  const stickyBelowHeader = { top: tabsBarHeight + (barsHidden ? 0 : headerHeight) };

  const [tab, setTab] = useState<string>("day-0");
  // Alvo (via portal) para a barra de controles do dia (Vigiados/Lances/Analisar/casas),
  // renderizada dentro do header — acima da lista de dias — em vez de sticky abaixo dele.
  const [dayBarHost, setDayBarHost] = useState<HTMLDivElement | null>(null);
  // Alvo (via portal) para o modo/provedor de IA + "Atualizar tudo", que vivem na MESMA
  // barra do rodapé global (Footer.tsx, montado no __root.tsx) — não um <footer> próprio.
  const [footerExtraHost, setFooterExtraHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setFooterExtraHost(document.getElementById("footer-extra"));
  }, []);
  const [artistFilter, setArtistFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  // A busca só roda ao confirmar (Enter/botão) — evita filtrar a lista a cada tecla.
  const [searchDraft, setSearchDraft] = useState<string>("");
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
  const fetchLotDetails = useServerFn(getLotDetails);
  const fetchSoldLots = useServerFn(getSoldLots);
  const fetchLotAi = useServerFn(getLotAi);
  const fetchLotIdent = useServerFn(getLotIdent);
  const runSaveTags = useServerFn(setLotTags);
  const fetchLotMarket = useServerFn(getLotMarket);
  const fetchLotCondition = useServerFn(getLotCondition);
  const fetchInterests = useServerFn(getUserInterests);
  const fetchAiMode = useServerFn(getAiMode);
  const runSetAiMode = useServerFn(setAiMode);
  const fetchAiProvider = useServerFn(getAiProvider);
  const runSetAiProvider = useServerFn(setAiProvider);
  const runAnalyze = useServerFn(analyzeOnDemand);
  const fetchCollection = useServerFn(getCollection);
  const fetchCollectionLinks = useServerFn(getCollectionLinks);
  const fetchCollectionFeedback = useServerFn(getCollectionFeedback);
  const runApplyDecision = useServerFn(applyCollectionDecision);

  const lots = useQuery({
    ...lotsQuery,
    queryFn: () => fetchLots(),
    // Carrega uma vez ao abrir; não recarrega ao navegar/trocar de aba/focar a janela.
    staleTime: 2 * 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Vigiados/lances "vistos" na janela de dias: a conta do LeilõesBR (l=8/l=4) pode parar de
  // trazer um lote assim que o leilão termina — igual à listagem pública, que já "some" um
  // leilão que ficou ao vivo. Sem isso, o card do vigiado/lance (e a tarja "Vendido" que ele
  // carrega) desaparecia da tela assim que o leilão acabava, mesmo ainda sendo "hoje". Por
  // isso o `queryFn` MESCLA (nunca substitui) num acumulador local (`mergeWatchedAccum`,
  // `@/lib/watched-accum`): cada fetch novo entra por `id`, e um item só sai quando (a) o
  // usuário desvigia explicitamente (`toggle.onSuccess` remove na hora, ver abaixo), (b) o
  // dia dele já saiu da janela de dias do app — poda que evita crescimento sem limite numa
  // sessão longa — ou (c) ele sumiu do fetch fresco e o leilão ainda não terminou (vigia
  // removida fora do app, ex. direto no site do LeilõesBR). Persistido em `localStorage` — um
  // `useRef` puro some ao recarregar a
  // página/fechar a aba, o que fazia os vigiados "sumirem depois de um tempo" mesmo sem o
  // usuário ter desvigiado nada. ⚠️ A rota `/analise` lê a MESMA chave de query
  // (`["vinyl-watched"]`/`["vinyl-my-bids"]`, compartilhada no `QueryClient` do app inteiro) —
  // ela usa esta MESMA função, senão a versão dela (sem mesclar) sobrescreve o acumulado
  // desta rota ao navegar entre as duas.
  const watchedAccumRef = useRef<Map<string, WatchedLot> | null>(null);
  if (watchedAccumRef.current === null)
    watchedAccumRef.current = loadAccum<WatchedLot>(WATCHED_ACCUM_STORAGE_KEY);
  const bidsAccumRef = useRef<Map<string, MyBid> | null>(null);
  if (bidsAccumRef.current === null)
    bidsAccumRef.current = loadAccum<MyBid>(BIDS_ACCUM_STORAGE_KEY);
  const watched = useQuery({
    ...watchedQuery,
    queryFn: async () => {
      const fresh = await fetchWatched();
      return mergeWatchedAccum(watchedAccumRef.current!, fresh, WATCHED_ACCUM_STORAGE_KEY);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const bids = useQuery({
    ...bidsQuery,
    queryFn: async () => {
      const fresh = await fetchBids();
      return mergeWatchedAccum(bidsAccumRef.current!, fresh, BIDS_ACCUM_STORAGE_KEY);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Aviso (toast) quando um lote com lance vira "Coberto" — só com o app aberto, ver
  // `@/lib/bid-alerts`.
  useBidCoveredAlerts(bids.data);
  // Avaliações da IA (score/raridade/oportunidade) e interesses do usuário: alimentam o
  // badge de nota no canto do card. Best-effort — sem avaliação, o card fica como hoje.
  const lotAiQuery = useQuery({
    queryKey: ["lot-ai"] as const,
    queryFn: () => fetchLotAi(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Identificação simplificada (artista/álbum/ano) — roda para TODOS os lotes, barata.
  // Alimenta a exibição, a busca e o filtro por artista, priorizada sobre o título.
  const lotIdentQuery = useQuery({
    queryKey: ["lot-ident"] as const,
    queryFn: () => fetchLotIdent(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const interestsQuery = useQuery({
    queryKey: ["user-interests"] as const,
    queryFn: () => fetchInterests(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Modo da IA automática (controla o gasto de créditos). Fonte da verdade é o servidor.
  const aiModeQuery = useQuery({
    queryKey: ["ai-mode"] as const,
    queryFn: () => fetchAiMode(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const aiMode: "off" | "all" | "watched" = aiModeQuery.data ?? "watched";
  const changeAiMode = (mode: "off" | "all" | "watched") => {
    const prev = aiModeQuery.data;
    queryClient.setQueryData(["ai-mode"], mode); // otimista: pinta a seleção na hora
    void runSetAiMode({ data: { mode } })
      .then(() =>
        toast.success(
          mode === "off"
            ? "IA desligada — não gasta créditos automaticamente"
            : mode === "all"
              ? "IA avaliando todos os lotes novos"
              : "IA avaliando só vigiados e com lance",
        ),
      )
      .catch((error: unknown) => {
        queryClient.setQueryData(["ai-mode"], prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o modo da IA");
      });
  };

  // Provedor de IA PADRÃO (Claude/Gemini). Fonte da verdade é o servidor (`app_state`).
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
  // Análise SOB DEMANDA (botões por dia/casa). `analyzing` guarda a chave em execução:
  // o dia (`day`) ou a casa (`${day}|${casa}`). Roda em laço até esgotar os não avaliados
  // (ou parar de progredir), depois revalida o cache ["lot-ai"] para as notas aparecerem.
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const analyzeScope = (opts: { day: string; house?: string }) => {
    if (analyzing) return; // uma análise por vez (evita disparar vários batches síncronos)
    const key = opts.house ? `${opts.day}|${opts.house}` : opts.day;
    // Usa SEMPRE o provedor selecionado no topo da página (sem perguntar).
    const provider = aiProvider;
    void (async () => {
      setAnalyzing(key);
      let evaluated = 0;
      let failed = 0;
      let lastError: string | null = null;
      let switchedTo: AiProvider | null = null;
      try {
        for (let guard = 0; guard < 60; guard += 1) {
          const res = await runAnalyze({
            data: { day: opts.day, house: opts.house, max: 25, provider },
          });
          evaluated += res.evaluated;
          failed += res.failed ?? 0;
          if (res.error) lastError = res.error;
          if (res.switched && res.served) switchedTo = res.served;
          // Para quando não sobra nada OU quando a rodada não avaliou nada (lotes que
          // falham sempre voltariam ao "pendente" e causariam laço infinito).
          if (res.remaining === 0 || res.evaluated === 0) break;
        }
        await queryClient.invalidateQueries({ queryKey: ["lot-ai"] });
        // Avisa se houve failover (o provedor pedido ficou sem créditos ou indisponível).
        if (switchedTo && switchedTo !== provider) {
          toast.warning(
            `${AI_PROVIDER_SHORT[provider]} indisponível — usei ${AI_PROVIDER_SHORT[switchedTo]}`,
          );
        }
        if (evaluated) {
          toast.success(
            `IA avaliou ${evaluated} lote(s) ${opts.house ? "desta casa" : "deste dia"}`,
          );
        } else if (failed) {
          // Havia lotes pendentes, mas a IA não devolveu nada (vazio/erro) — não é "já avaliado".
          toast.error(
            `A IA não retornou avaliação${lastError ? ` (${lastError})` : ""} — verifique a chave/limite do provedor`,
          );
        } else {
          toast.success("Nada novo para avaliar aqui (já avaliado)");
        }
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível analisar agora");
      } finally {
        setAnalyzing(null);
      }
    })();
  };
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
  // Álbum RESOLVIDO por lote: prefere a avaliação completa (`lot_ai`); senão a
  // identificação simplificada (`lot_ident`). Usado na exibição, busca e no artista efetivo.
  const albumById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of lotIdentQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    for (const r of lotAiQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    return map;
  }, [lotIdentQuery.data, lotAiQuery.data]);
  const albumFor = (lot: { id: string }): string | null => albumById.get(lot.id) ?? null;
  // Artista efetivo: o identificado pela IA (parte antes do "-") quando existir, senão o
  // artista heurístico do título. Alimenta o agrupamento e o filtro "por artista".
  const effectiveArtist = (lot: { id: string; artist: string; title?: string }): string => {
    // Lote de vários discos vem primeiro: agrupa como "Lote" mesmo que a IA tenha
    // arriscado um álbum específico para o conjunto.
    if (isDiscBundle(lot.title ?? "") || lot.artist === LOTE_LABEL) return LOTE_LABEL;
    const parsed = parseAiAlbum(albumById.get(lot.id) ?? null).artist;
    return parsed ? titleCase(parsed) : lot.artist;
  };
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
  // Estado de conservação (Disco/Capa). Prioriza o CACHE do servidor (`lot_condition`,
  // alimentado pelo descritivo do catálogo — mais rico); cai no parse do TÍTULO quando não
  // há linha no cache ainda (ou ela ficou indefinida).
  const lotConditionQuery = useQuery({
    queryKey: ["lot-condition"] as const,
    queryFn: () => fetchLotCondition(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const conditionById = useMemo(() => {
    const map = new Map<string, Condition>();
    for (const r of lotConditionQuery.data ?? []) {
      const rawMedia = (r.media || null) as Grade | null;
      const rawSleeve = (r.sleeve || null) as Grade | null;
      // scoreCondition ESPELHA quando só um lado é conhecido (padrão do app) — usa o retorno
      // (não os campos crus) para o badge refletir isso mesmo em linhas antigas do cache.
      const { media, sleeve, score, faixa } = scoreCondition(rawMedia, rawSleeve);
      const insert = r.insert_state === "sim" ? "sim" : r.insert_state === "nao" ? "nao" : null;
      if (!media && !sleeve && insert === null) continue; // indefinido → não guarda
      map.set(r.id, { media, sleeve, insert, score, faixa, source: "regex", raw: "" });
    }
    return map;
  }, [lotConditionQuery.data]);
  const conditionFor = (lot: { id?: string; title?: string }): Condition => {
    const cached = lot.id ? conditionById.get(lot.id) : undefined;
    return cached ?? parseConditionFromText(lot.title ?? "");
  };
  // Demanda (visualizações/lances) por lote, do mesmo cache `lot_condition`.
  const demandById = useMemo(() => {
    const map = new Map<string, { views: number | null; bids: number | null }>();
    for (const r of lotConditionQuery.data ?? []) {
      if (r.views == null && r.bids == null) continue;
      map.set(r.id, { views: r.views ?? null, bids: r.bids ?? null });
    }
    return map;
  }, [lotConditionQuery.data]);
  const demandFor = (lot: { id?: string }) => (lot.id ? demandById.get(lot.id) : undefined) ?? null;

  // Coleção do usuário: discos que ele JÁ possui (`collection_items`). Usada só para marcar
  // no card, com um ícone roxo, os lotes que ele já tem — evitando arrematar duplicado. Mesma
  // query key da página Coleção → compartilha o cache (1 GET leve, base pequena, single-user).
  const collectionQuery = useQuery<CollectionItem[]>({
    queryKey: ["collection"] as const,
    queryFn: () => fetchCollection() as Promise<CollectionItem[]>,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Relações manuais (override por lote) e aprendizado (feedback por assinatura). Mesmas
  // chaves de app_state; compartilham cache entre telas.
  // Best-effort: um erro aqui NUNCA pode derrubar a home (a relação/aprendizado é acessório).
  const collectionLinksQuery = useQuery<CollectionLinks>({
    queryKey: ["collection-links"] as const,
    queryFn: async () => {
      try {
        return ((await fetchCollectionLinks()) as CollectionLinks) ?? {};
      } catch {
        return {};
      }
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const collectionFeedbackQuery = useQuery<OwnedFeedback[]>({
    queryKey: ["collection-feedback"] as const,
    queryFn: async () => {
      try {
        return ((await fetchCollectionFeedback()) as OwnedFeedback[]) ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const collById = useMemo(() => {
    const map = new Map<string, CollectionItem>();
    for (const it of collectionQuery.data ?? []) map.set(it.id, it);
    return map;
  }, [collectionQuery.data]);
  const collLabel = (itemId: string): string => {
    const it = collById.get(itemId);
    return it ? [it.artist, it.album].filter(Boolean).join(" ") : "";
  };
  // Candidatos de casamento a partir da coleção (`ownedCandidate` separa tokens de artista e
  // álbum para dosar a confiança). Ignora buckets ruidosos (Lote/Coletâneas/Não classificados)
  // e artista vazio, que gerariam tokens fracos e falsos positivos.
  const ownedCands = useMemo(
    () =>
      (collectionQuery.data ?? [])
        .filter(
          (it) =>
            it.artist &&
            it.artist !== LOTE_LABEL &&
            it.artist !== COMPILATION_LABEL &&
            it.artist !== UNCLASSIFIED_LABEL,
        )
        .map((it) =>
          ownedCandidate({ id: it.id, artist: it.artist, album: it.album, year: it.year }),
        ),
    [collectionQuery.data],
  );
  // `lot_id` das peças EXATAS já arrematadas → id do item da coleção (casamento 100% preciso).
  const ownedByLotId = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of collectionQuery.data ?? []) if (it.lotId) map.set(it.lotId, it.id);
    return map;
  }, [collectionQuery.data]);
  // Identidade de cada lote (título + artista efetivo + álbum IA + release Discogs), reusada
  // pelo casamento automático, pelo aprendizado e pela assinatura das decisões.
  const identityById = useMemo(() => {
    const map = new Map<string, LotIdentity>();
    for (const lot of lots.data?.lots ?? []) {
      try {
        const parsedArtist = parseAiAlbum(albumById.get(lot.id) ?? null).artist;
        const artist =
          isDiscBundle(lot.title ?? "") || lot.artist === LOTE_LABEL
            ? LOTE_LABEL
            : parsedArtist
              ? titleCase(parsedArtist)
              : lot.artist;
        const market = marketById.get(lot.id);
        map.set(
          lot.id,
          lotIdentity({
            title: lot.title,
            artist,
            album: albumById.get(lot.id) ?? null,
            marketTitle: market?.releaseTitle ?? null,
            marketYear: market?.year ?? null,
          }),
        );
      } catch {
        /* um lote problemático não pode derrubar a home */
      }
    }
    return map;
  }, [lots.data, albumById, marketById]);
  // Casamento AUTOMÁTICO cru (antes de override/aprendizado): peça exata (score 1) ou ≥50%.
  const ownedAutoById = useMemo(() => {
    const map = new Map<string, OwnedHit>();
    for (const lot of lots.data?.lots ?? []) {
      try {
        const exactId = ownedByLotId.get(lot.id);
        if (exactId) {
          map.set(lot.id, { id: exactId, label: collLabel(exactId), score: 1 });
          continue;
        }
        if (!ownedCands.length) continue;
        const identity = identityById.get(lot.id);
        if (!identity) continue;
        const best = ownedMatchForLot(ownedCands, identity);
        if (best) map.set(lot.id, best);
      } catch {
        /* idem: falha de casamento de um lote é ignorada */
      }
    }
    return map;
    // collLabel depende de collById (memo estável); ownedByLotId/identityById cobrem os dados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedCands, ownedByLotId, identityById, collById]);

  const EMPTY_IDENTITY: LotIdentity = useMemo(
    () => ({ text: "", tokens: new Set<string>(), years: new Set<number>() }),
    [],
  );
  const links: CollectionLinks = collectionLinksQuery.data ?? {};
  const feedback: OwnedFeedback[] = collectionFeedbackQuery.data ?? [];
  // Resolução tolerante: qualquer erro no casamento/aprendizado vira "sem relação" (cinza),
  // nunca uma exceção que derrube a home.
  const ownedResolutionFor = (lot: { id: string }): OwnedResolution => {
    try {
      return resolveOwned(
        lot.id,
        links,
        ownedAutoById.get(lot.id) ?? null,
        feedback,
        identityById.get(lot.id) ?? EMPTY_IDENTITY,
      );
    } catch {
      return { kind: "none" };
    }
  };
  // `OwnedHit` efetivo para o ícone do card (cinza quando null).
  const ownedFor = (lot: { id: string }): OwnedHit | null => {
    const res = ownedResolutionFor(lot);
    switch (res.kind) {
      case "linked":
        return { id: res.itemId, label: collLabel(res.itemId), score: 1 };
      case "auto":
        return res.hit;
      case "suggested":
        return { id: res.itemId, label: collLabel(res.itemId), score: res.score };
      default:
        return null; // none / rejected → cinza
    }
  };

  // Painel de relação (abre ao tocar o ícone) + assinatura da decisão + gravação. O lote é
  // um formato mínimo (id/título/artista) — serve tanto para VinylLot quanto para os lances.
  type PanelLot = { id: string; title: string; artist?: string };
  const [ownedPanelLot, setOwnedPanelLot] = useState<PanelLot | null>(null);
  const sigForLot = (lot: PanelLot) => {
    const ai = parseAiAlbum(albumById.get(lot.id) ?? null);
    const market = marketById.get(lot.id);
    return ownedSignatureFromLot({
      artist: ai.artist ?? lot.artist ?? null,
      album: ai.album ?? null,
      title: lot.title,
      year: ai.year ?? market?.year ?? null,
    });
  };
  const applyDecision = (lot: PanelLot, value: string | false | null, itemId: string | null) => {
    const sig = sigForLot(lot);
    const prevLinks = collectionLinksQuery.data ?? {};
    const prevFeedback = collectionFeedbackQuery.data ?? [];
    // Otimista: reflete na hora nas duas caches.
    queryClient.setQueryData<CollectionLinks>(["collection-links"], (old) => {
      const next = { ...(old ?? {}) };
      if (value === null) delete next[lot.id];
      else next[lot.id] = value;
      return next;
    });
    queryClient.setQueryData<OwnedFeedback[]>(["collection-feedback"], (old) => {
      const kept = (old ?? []).filter((e) => e.lotId !== lot.id);
      if (value === null || !itemId) return kept;
      return [
        ...kept,
        {
          lotId: lot.id,
          itemId,
          verdict: value === false ? "neg" : "pos",
          artist: sig.artist,
          album: sig.album,
          year: sig.year,
        },
      ];
    });
    void runApplyDecision({ data: { lotId: lot.id, value, itemId, sig } })
      .catch((error: unknown) => {
        queryClient.setQueryData(["collection-links"], prevLinks);
        queryClient.setQueryData(["collection-feedback"], prevFeedback);
        toast.error((error as Error)?.message || "Não foi possível salvar a relação");
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["collection-links"] });
        void queryClient.invalidateQueries({ queryKey: ["collection-feedback"] });
      });
  };

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
      else {
        next.add(key);
        // Ao MARCAR como verificada, fecha a casa (não faz sentido deixá-la expandida
        // depois de conferida; ela também migra para a seção "Já verificadas").
        setOpenHouses((open) => {
          if (!open.has(key)) return open;
          const n = new Set(open);
          n.delete(key);
          return n;
        });
      }
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

  // Força a atualização de Vigiados/Lances (conta LeilõesBR) fora do TTL de 5min — inclui o
  // status "Vendido" (`lot_sales` + peca.asp), que depende desses dados. Não refaz a varredura
  // geral (`refreshDay` já cobre isso): só a conta + os detalhes por lote (peca.asp) que casam
  // com ela.
  const [refreshingWatched, setRefreshingWatched] = useState(false);
  const [refreshingBids, setRefreshingBids] = useState(false);

  // `queryClient.invalidateQueries` resolve quando o refetch TERMINA (sucesso OU erro), não
  // quando dá certo — então usamos `refetch()` da própria query (expõe o erro de verdade) em
  // vez de `invalidateQueries` para os vigiados/lances, cujo sucesso o toast precisa refletir.
  // As duas queries de status "Vendido" (`lot-details`/`sold-lots`) já são leves e escopadas
  // (peca.asp por lote + leitura de `lot_sales`, nunca o catálogo inteiro) — o botão só força
  // essas duas a refazer a busca agora, o mesmo que `refetchOnMount: "always"` já faz sozinho
  // ao abrir a tela.
  const refreshWatched = () => {
    void (async () => {
      setRefreshingWatched(true);
      try {
        const result = await watched.refetch({ throwOnError: true });
        if (result.error) throw result.error;
        toast.success("Vigiados atualizados");
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar os vigiados agora");
      } finally {
        setRefreshingWatched(false);
        void queryClient.invalidateQueries({ queryKey: ["lot-details"] });
        void queryClient.invalidateQueries({ queryKey: ["sold-lots"] });
      }
    })();
  };

  const refreshBids = () => {
    void (async () => {
      setRefreshingBids(true);
      try {
        const result = await bids.refetch({ throwOnError: true });
        if (result.error) throw result.error;
        toast.success("Lances atualizados");
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar os lances agora");
      } finally {
        setRefreshingBids(false);
        void queryClient.invalidateQueries({ queryKey: ["lot-details"] });
        void queryClient.invalidateQueries({ queryKey: ["sold-lots"] });
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
      // O acumulador de "vigiados vistos" (ver comentário acima de `watched`) precisa refletir
      // as DUAS direções NA HORA, sem esperar o refetch de `listWatched` (que lê a conta do
      // LeilõesBR de novo): `watchedIds` (linha ~1091) tem PRIORIDADE sobre `lot.watched` do
      // card sempre que `watchedIds.size > 0` — então vigiar um lote pela primeira vez (com
      // outros já vigiados) confirmava no site mas o card no dia continuava aparecendo "não
      // vigiado" até o próximo refetch pegar o lote novo (a conta do LeilõesBR pode demorar a
      // refletir o toggle que acabou de fazer). Desvigiar já saía na hora (delete); vigiar
      // precisa do mesmo tratamento (set), reconstruindo o `WatchedLot` a partir do lote já
      // conhecido na varredura geral (`lotsQuery`) — os únicos campos que o toggle devolve são
      // idPeca/idLeilao/base/watch.
      const key = `${lot.idLeilao}-${lot.idPeca}`;
      if (!result.watched) {
        watchedAccumRef.current!.delete(key);
      } else {
        const src = lots.data?.lots.find((item) => item.idPeca === lot.idPeca);
        if (src) {
          const [yyyy, mm, dd] = src.dayKey.split("-");
          watchedAccumRef.current!.set(key, {
            id: key,
            idPeca: lot.idPeca,
            idLeilao: lot.idLeilao,
            base: lot.base,
            lote: src.lote,
            title: src.title,
            url: src.url,
            image: src.image,
            price: src.price,
            date: dd && mm && yyyy ? `${dd}/${mm}/${yyyy}` : "",
            time: src.time,
            house: src.house,
            houseUrl: src.houseUrl,
            uf: src.uf,
            artist: src.artist,
            watched: true,
          });
        }
      }
      saveAccum(WATCHED_ACCUM_STORAGE_KEY, watchedAccumRef.current!);
      queryClient.setQueryData(watchedQuery.queryKey, [...watchedAccumRef.current!.values()]);
      void queryClient.invalidateQueries({ queryKey: watchedQuery.queryKey });
      toast.success(result.watched ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível sincronizar a vigia"),
    onSettled: () => setPending(null),
  });

  // Edição manual de tags da IA (add/remove ao passar o mouse): atualiza o cache ["lot-ai"]
  // otimisticamente e persiste no banco.
  const patchTags = (id: string, tags: string[]) =>
    queryClient.setQueryData(["lot-ai"], (old: unknown) =>
      Array.isArray(old)
        ? old.map((r) => (r && (r as { id: string }).id === id ? { ...r, tags } : r))
        : old,
    );
  const saveTagsMut = useMutation({
    mutationFn: (v: { id: string; tags: string[] }) => runSaveTags({ data: v }),
    onMutate: (v: { id: string; tags: string[] }) => patchTags(v.id, v.tags),
    onSuccess: (res: { id: string; tags: string[] }) => {
      patchTags(res.id, res.tags);
      toast.success("Tags atualizadas");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Não foi possível salvar as tags");
      void queryClient.invalidateQueries({ queryKey: ["lot-ai"] });
    },
  });
  const editTags = (id: string) => (tags: string[]) => saveTagsMut.mutate({ id, tags });

  const days = lots.data?.days ?? [];
  const searchNorm = normalizeForMatch(search);
  // Relevância da busca: identidade (álbum da IA + artista + título) tem prioridade;
  // casa e nº do lote entram só como campos fracos, para não trazer lotes "muito
  // diferentes" quando o termo casa apenas no nome da casa.
  const searchScore = (lot: VinylLot) =>
    searchRelevance(
      `${albumFor(lot) ?? ""} ${lot.artist} ${lot.title}`,
      `${lot.house} ${lot.lote}`,
      searchNorm,
    );
  const matchesSearch = (lot: VinylLot) => searchScore(lot) > 0;
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
  // Dia do LEILÃO de cada lote (id `${idLeilao}-${idPeca}`), pela varredura geral. A página
  // "Meus lances" mostra a data do lance (quando lancei), não a data em que o lote vai a
  // pregão — então os lances/vigiados do dia devem ser agrupados por ESTE dia (o do leilão),
  // não por `bid.date`. Fallback: a data do próprio card quando o lote não está na varredura.
  const dayKeyByLotId = useMemo(() => {
    const map = new Map<string, string>();
    for (const lot of lots.data?.lots ?? []) if (lot.dayKey) map.set(lot.id, lot.dayKey);
    return map;
  }, [lots.data]);
  const bidDayKey = (bid: { id: string; date: string }) =>
    dayKeyByLotId.get(bid.id) || watchedDateToKey(bid.date) || bid.date || "";
  // Meu lance por peça — para exibir "Meu lance" e corrigir o "Atual" (quando venço, o
  // valor atual É o meu lance) também nas abas de dia/vigiados, não só em "Meus lances".
  const myBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bids.data ?? []) if (b.myBid) map.set(b.idPeca, b.myBid);
    return map;
  }, [bids.data]);
  // Próximo lance (NOVO_VALOR) e resultado da venda (fallback rápido de "vendido" para quem
  // só VIGIA, sem lance) lidos do peca.asp — só para VIGIADOS + LANCES (conjunto pequeno; 1
  // requisição por lote). Alvos = id (`${idLeilao}-${idPeca}`) + idPeca + url para montar a
  // URL da peça no servidor. Dedup/chave por `id`, NUNCA por `idPeca` sozinho: `idPeca` só é
  // único DENTRO de uma casa (cada casa parceira é uma instalação independente da mesma
  // plataforma, com sua própria contagem) — indexar por `idPeca` já misturou o resultado de
  // venda de um lote vigiado de uma casa com outro lote (de outra casa/leilão) que só
  // coincidia no número.
  const lotDetailTargets = useMemo(() => {
    const byId = new Map<string, { id: string; idPeca: string; url: string }>();
    for (const w of watched.data ?? [])
      if (w.id && w.idPeca && w.url) byId.set(w.id, { id: w.id, idPeca: w.idPeca, url: w.url });
    for (const b of bids.data ?? [])
      if (b.id && b.idPeca && b.url && !byId.has(b.id))
        byId.set(b.id, { id: b.id, idPeca: b.idPeca, url: b.url });
    return [...byId.values()];
  }, [watched.data, bids.data]);
  const lotDetailTargetsKey = useMemo(
    () =>
      lotDetailTargets
        .map((t) => t.id)
        .sort()
        .join(","),
    [lotDetailTargets],
  );
  const lotDetails = useQuery({
    queryKey: ["lot-details", lotDetailTargetsKey] as const,
    queryFn: () => fetchLotDetails({ data: { targets: lotDetailTargets } }),
    enabled: lotDetailTargets.length > 0,
    staleTime: 3 * 60 * 1000,
    // Sempre rechecar ao abrir a tela (o conjunto já é pequeno/escopado — vigiados+lances,
    // nunca mais que 100 — então isso não pesa mais do que o request que já existia).
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const nextBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, d] of Object.entries(lotDetails.data ?? {}))
      if (d.nextBid) map.set(id, d.nextBid);
    return map;
  }, [lotDetails.data]);
  // Status "Vendido" (tarja diagonal) — só para VIGIADOS + LANCES, casado por `id`
  // (${idLeilao}-${idPeca}) com `lot_sales` (fonte mais rica, com valor de venda).
  const soldTargets = useMemo(() => {
    const ids = new Set<string>();
    for (const w of watched.data ?? []) if (w.id) ids.add(w.id);
    for (const b of bids.data ?? []) if (b.id) ids.add(b.id);
    return [...ids];
  }, [watched.data, bids.data]);
  const soldTargetsKey = useMemo(() => soldTargets.slice().sort().join(","), [soldTargets]);
  const soldLots = useQuery({
    queryKey: ["sold-lots", soldTargetsKey] as const,
    queryFn: () => fetchSoldLots({ data: { ids: soldTargets } }),
    enabled: soldTargets.length > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const soldById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of soldLots.data ?? []) map.set(r.lot_id, r.sold_price_raw?.trim() || "Vendido");
    // Fallback do peca.asp (mais rápido que lot_sales, único sinal para vigiados sem lance) —
    // já vem indexado por `id` (${idLeilao}-${idPeca}); só preenche o que a lot_sales ainda
    // não trouxe.
    for (const [id, d] of Object.entries(lotDetails.data ?? {})) {
      if (!d.sold) continue;
      if (!map.has(id)) map.set(id, d.sold);
    }
    return map;
  }, [soldLots.data, lotDetails.data]);
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
      <MobileTopToggle
        collapsed={barsHidden}
        onToggle={() => setBarsHidden((c) => !c)}
        alwaysVisible
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          setArtistFilter("");
        }}
      >
        <div className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          {/* Colapsa com o botão do topo (`MobileTopToggle`) — também no desktop agora.
          A lista de dias/abas (`TabsList`, logo abaixo) fica DE FORA, sempre visível, pra
          sempre dar pra trocar de dia/Vigiados/Lances mesmo com o resto escondido. */}
          <HideableBar hidden={barsHidden} collapseOnDesktop>
            <div ref={headerRef}>
              <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1 sm:py-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <LogOut className="h-3 w-3" />
                    Sair
                  </button>
                </div>
                {/* No mobile a barra de ações rola na horizontal (uma linha), para o header sticky
              ficar baixo e não atrapalhar; no desktop volta a quebrar em linhas (flex-wrap). */}
                <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    title="Leilões ao vivo (pregão presencial)"
                  >
                    <Link to="/ao-vivo">
                      <Radio className="mr-2 h-4 w-4" />
                      Ao vivo
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild title="Análise de lotes com IA">
                    <Link to="/analise">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Análise
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild title="Minha coleção de vinil">
                    <Link to="/colecao">
                      <Library className="mr-2 h-4 w-4" />
                      Coleção
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild title="Minhas compras (vinil)">
                    <Link to="/compras">
                      <ShoppingBag className="mr-2 h-4 w-4" />
                      Compras
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    title="Preços de venda por artista e álbum"
                  >
                    <Link to="/vinil-analytics">
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Analytics
                    </Link>
                  </Button>
                  <div className="flex items-center gap-2">
                    <Input
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          setSearch(searchDraft);
                        }
                      }}
                      placeholder="Buscar por título, artista, casa ou nº do lote… (Enter para pesquisar)"
                      className="h-8 w-[220px] text-xs sm:w-64"
                    />
                    <Button size="sm" onClick={() => setSearch(searchDraft)}>
                      <SearchIcon className="mr-2 h-4 w-4" />
                      Pesquisar
                    </Button>
                    {search || searchDraft ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setSearchDraft("");
                        }}
                      >
                        Limpar busca
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {!lots.isError && !lots.isLoading ? (
                <div className="mx-auto max-w-6xl px-4 pb-1.5 sm:pb-2">
                  {/* Alvo da barra de controles do dia (portal) — renderizada aqui, acima da
                lista de dias, em vez de sticky abaixo do header (ver dayBarHost). */}
                  <div ref={setDayBarHost} />
                </div>
              ) : null}
            </div>
          </HideableBar>

          {!lots.isError && !lots.isLoading ? (
            <div ref={tabsBarRef} className="mx-auto max-w-6xl px-4 pb-1.5 sm:pb-2">
              {/* No mobile a lista de dias rola na horizontal (uma linha), evitando que o
              header sticky cresça por causa da quebra de linha; no desktop volta a
              quebrar em linhas (flex-wrap). Fica sempre visível (fora do HideableBar acima) —
              nunca esconde, mesmo com o resto do topo recolhido. */}
              <TabsList className="flex h-auto flex-nowrap justify-start gap-1 overflow-x-auto bg-secondary sm:flex-wrap sm:overflow-visible">
                {days.map((day, index) => (
                  <TabsTrigger key={day} value={`day-${index}`} className="shrink-0">
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
                <TabsTrigger value="watched" className="shrink-0">
                  Vigiados
                  <span className="ml-2 text-xs text-muted-foreground">
                    {
                      (watched.data ?? []).filter((lot) =>
                        watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
                      ).length
                    }
                  </span>
                </TabsTrigger>
                <TabsTrigger value="bids" className="shrink-0">
                  Lances
                  <span className="ml-2 text-xs text-muted-foreground">
                    {
                      (bids.data ?? []).filter((bid) =>
                        bidMatchesSearch(bid, searchNorm, albumFor(bid)),
                      ).length
                    }
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>
          ) : null}
        </div>

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
              {days.map((day, index) => {
                const rawDay = (lots.data?.lots ?? [])
                  .map((lot) => ({
                    ...lot,
                    watched: watchedIds.size ? watchedIds.has(lot.idPeca) : lot.watched,
                    // Prioriza o artista identificado pela IA no agrupamento/filtro por artista.
                    artist: effectiveArtist(lot),
                  }))
                  .filter((lot) => lot.dayKey === day);
                // "Finalizado" pra fins do toggle "Mostrar finalizados" NÃO conta vigiado/com
                // lance — esses o usuário está ativamente acompanhando (quer ver se vendeu,
                // valor final etc.), então continuam aparecendo na grade geral mesmo depois do
                // leilão encerrar, sem precisar abrir "Mostrar finalizados". Só o "resto" (sem
                // relação com o usuário) some por padrão.
                const isTracked = (lot: { idPeca: string; watched: boolean }) =>
                  lot.watched || bidStatusById.has(lot.idPeca);
                const finishedCount = rawDay.filter(
                  (lot) => auctionFinished(lot.dayKey, lot.time) && !isTracked(lot),
                ).length;
                const showFinished = showFinishedDays.has(day);
                // Por padrão esconde os finalizados (3h após o início); o usuário pode incluí-los.
                // A busca geral (searchNorm) filtra por título/artista/casa/nº do lote.
                const dayLots = (
                  showFinished
                    ? rawDay
                    : rawDay.filter(
                        (lot) => isTracked(lot) || !auctionFinished(lot.dayKey, lot.time),
                      )
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
                    watchedDateToKey(lot.date) === day &&
                    watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
                );
                // Vigiados do dia agrupados por casa e ordenados por nº do lote.
                const watchedByHouse = groupWatchedByHouse(watchedForDay);
                const isBidsView = bidsViewDay === day;
                // Lances do dia: a busca principal também filtra aqui.
                const bidsForDay = bidsWithHouseUrl.filter(
                  (bid) =>
                    bidDayKey(bid) === day && bidMatchesSearch(bid, searchNorm, albumFor(bid)),
                );
                // Lances do dia agrupados por casa e ordenados por nº do lote.
                const bidsByHouse = groupWatchedByHouse(bidsForDay);

                return (
                  <TabsContent key={day} value={`day-${index}`} className="space-y-6">
                    {dayBarHost &&
                      createPortal(
                        <div className="space-y-3 border-t border-border px-4 py-2 sm:py-3">
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
                              onClick={refreshWatched}
                              disabled={refreshingWatched}
                              title="Forçar atualização dos vigiados (inclui status Vendido)"
                              aria-label="Forçar atualização dos vigiados"
                              className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                            >
                              {refreshingWatched ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
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
                                <span className="ml-0.5 text-muted-foreground">
                                  {bidsForDay.length}
                                </span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              onClick={refreshBids}
                              disabled={refreshingBids}
                              title="Forçar atualização dos lances (inclui status Vendido)"
                              aria-label="Forçar atualização dos lances"
                              className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                            >
                              {refreshingBids ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => analyzeScope({ day })}
                              disabled={analyzing !== null}
                              title="Analisar com IA os lotes ainda não avaliados deste dia (sob demanda)"
                              aria-label={`Analisar com IA ${dayLabel(day, index)}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                            >
                              {analyzing === day ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                              )}
                              Analisar dia
                            </button>
                            {!isWatchedView && !isBidsView ? (
                              <>
                                <ArtistFilter
                                  artists={artists}
                                  value={artistFilter}
                                  onChange={setArtistFilter}
                                />
                                {artistFilter ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setArtistFilter("")}
                                  >
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
                                    {group.house}
                                    <span className="text-muted-foreground">{group.count}</span>
                                    <HouseStatBadges
                                      stats={computeHouseStats(
                                        group.lots,
                                        watchedIds,
                                        bidStatusById,
                                      )}
                                    />
                                  </button>
                                );
                              })}
                            </nav>
                          ) : null}
                        </div>,
                        dayBarHost,
                      )}
                    {isWatchedView ? (
                      watched.isLoading ? (
                        <Skeleton className="h-40 w-full" />
                      ) : watchedForDay.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhum lote vigiado neste dia.
                        </p>
                      ) : (
                        <div className="space-y-8">
                          {watchedByHouse.map((houseGroup) => {
                            const auctionInfo = houseAuctionInfo(day, houseGroup.lots[0]);
                            return (
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
                                  <AuctionStatusInline info={auctionInfo} />
                                  <div className="ml-auto flex flex-wrap items-center gap-3">
                                    {auctionInfo?.presencialUrl ? (
                                      <a
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                        href={auctionInfo.presencialUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Acompanhar o pregão presencial desta casa"
                                      >
                                        <Radio className="h-3 w-3" /> pregão presencial
                                      </a>
                                    ) : null}
                                    <a
                                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                      href={houseGroup.houseUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      site da casa <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                  {houseGroup.lots.map((lot) => (
                                    <LotCard
                                      key={lot.id}
                                      lot={{
                                        ...lot,
                                        dayKey: watchedDateToKey(lot.date) || lot.date,
                                        watched: true,
                                        myBid: myBidById.get(lot.idPeca),
                                        nextBid: nextBidById.get(lot.id),
                                      }}
                                      busy={pending === lot.idPeca}
                                      ai={aiFor(lot)}
                                      market={marketFor(lot)}
                                      album={albumFor(lot)}
                                      condition={conditionFor(lot)}
                                      demand={demandFor(lot)}
                                      owned={ownedFor(lot)}
                                      onOpenOwned={() => setOwnedPanelLot(lot)}
                                      onEditTags={editTags(lot.id)}
                                      bidStatus={bidStatusById.get(lot.idPeca)}
                                      sold={soldById.get(lot.id)}
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
                            );
                          })}
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
                          albumById={albumById}
                          soldById={soldById}
                          ownedFor={ownedFor}
                          onOpenOwned={(bid) => setOwnedPanelLot(bid)}
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleShowFinished(day)}
                          >
                            Mostrar finalizados ({finishedCount})
                          </Button>
                        ) : null}
                      </div>
                    ) : searchNorm ? (
                      // Busca ativa: lista única ordenada por relevância (mais exato →
                      // parecido), em vez do agrupamento por casa, para o topo bater com o
                      // que foi digitado.
                      (() => {
                        const ranked = [...visibleLots].sort(
                          (a, b) => searchScore(b) - searchScore(a),
                        );
                        return (
                          <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                              {ranked.length} resultado(s) para “{search.trim()}”, dos mais
                              parecidos aos menos.
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {ranked.map((lot) => (
                                <LotCard
                                  key={lot.id}
                                  lot={{
                                    ...lot,
                                    lote: lot.lote || loteById.get(lot.idPeca) || "",
                                    myBid: myBidById.get(lot.idPeca),
                                    nextBid: nextBidById.get(lot.id),
                                  }}
                                  busy={pending === lot.idPeca}
                                  ai={aiFor(lot)}
                                  market={marketFor(lot)}
                                  album={albumFor(lot)}
                                  condition={conditionFor(lot)}
                                  demand={demandFor(lot)}
                                  owned={ownedFor(lot)}
                                  onOpenOwned={() => setOwnedPanelLot(lot)}
                                  onEditTags={editTags(lot.id)}
                                  bidStatus={bidStatusById.get(lot.idPeca)}
                                  sold={soldById.get(lot.id)}
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
                        );
                      })()
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
                          const auctionInfo = houseAuctionInfo(day, group.lots[0]);

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
                                    onClick={() => analyzeScope({ day, house: group.house })}
                                    disabled={analyzing !== null}
                                    title="Analisar com IA os lotes ainda não avaliados desta casa (sob demanda)"
                                    aria-label={`Analisar com IA ${group.house}`}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                                  >
                                    {analyzing === houseKey ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="h-3.5 w-3.5" />
                                    )}
                                    Analisar
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
                                  <AuctionStatusInline info={auctionInfo} />
                                  <div className="ml-auto flex flex-wrap items-center gap-3">
                                    {auctionInfo?.presencialUrl ? (
                                      <a
                                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                        href={auctionInfo.presencialUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Acompanhar o pregão presencial desta casa"
                                      >
                                        <Radio className="h-3 w-3" /> pregão presencial
                                      </a>
                                    ) : null}
                                    <a
                                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                      href={group.houseUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      site da casa <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
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
                                                nextBid: nextBidById.get(lot.id),
                                              }}
                                              busy={pending === lot.idPeca}
                                              ai={aiFor(lot)}
                                              market={marketFor(lot)}
                                              album={albumFor(lot)}
                                              condition={conditionFor(lot)}
                                              demand={demandFor(lot)}
                                              owned={ownedFor(lot)}
                                              onOpenOwned={() => setOwnedPanelLot(lot)}
                                              onEditTags={editTags(lot.id)}
                                              bidStatus={bidStatusById.get(lot.idPeca)}
                                              sold={soldById.get(lot.id)}
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
                                            ?.scrollIntoView({
                                              behavior: "smooth",
                                              block: "start",
                                            }),
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
                      watchedMatchesSearch(lot, searchNorm, albumFor(lot)),
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
                              <HideableBar
                                hidden={barsHidden}
                                style={stickyBelowHeader}
                                className="z-10 -mx-4"
                              >
                                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:py-3">
                                  <span className="text-sm font-semibold text-foreground">
                                    {label}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {dayLots.length} lote(s) vigiado(s) em {houses.length} casa(s)
                                  </span>
                                </div>
                              </HideableBar>
                              {houses.map((houseGroup) => {
                                const auctionInfo = houseAuctionInfo(dayKey, houseGroup.lots[0]);
                                return (
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
                                      <AuctionStatusInline info={auctionInfo} />
                                      <div className="ml-auto flex flex-wrap items-center gap-3">
                                        {auctionInfo?.presencialUrl ? (
                                          <a
                                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                            href={auctionInfo.presencialUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            title="Acompanhar o pregão presencial desta casa"
                                          >
                                            <Radio className="h-3 w-3" /> pregão presencial
                                          </a>
                                        ) : null}
                                        <a
                                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                          href={houseGroup.houseUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          site da casa <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </div>
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                      {houseGroup.lots.map((lot) => (
                                        <LotCard
                                          key={lot.id}
                                          lot={{
                                            ...lot,
                                            dayKey: watchedDateToKey(lot.date) || lot.date,
                                            watched: true,
                                            myBid: myBidById.get(lot.idPeca),
                                          }}
                                          busy={pending === lot.idPeca}
                                          ai={aiFor(lot)}
                                          market={marketFor(lot)}
                                          album={albumFor(lot)}
                                          condition={conditionFor(lot)}
                                          demand={demandFor(lot)}
                                          owned={ownedFor(lot)}
                                          onOpenOwned={() => setOwnedPanelLot(lot)}
                                          onEditTags={editTags(lot.id)}
                                          bidStatus={bidStatusById.get(lot.idPeca)}
                                          sold={soldById.get(lot.id)}
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
                                );
                              })}
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
                      bidMatchesSearch(bid, searchNorm, albumFor(bid)),
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
                      const key = bidDayKey(bid);
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
                              <HideableBar
                                hidden={barsHidden}
                                style={stickyBelowHeader}
                                className="z-10 -mx-4"
                              >
                                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:py-3">
                                  <span className="text-sm font-semibold text-foreground">
                                    {label}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {dayBids.length} lance(s) em {houses.length} casa(s)
                                  </span>
                                  <BidStatBadges stats={computeBidStats(dayBids)} />
                                </div>
                              </HideableBar>
                              <BidHouseSections
                                houses={houses}
                                pending={pending}
                                loteById={loteById}
                                priceById={priceById}
                                nextBidById={nextBidById}
                                albumById={albumById}
                                soldById={soldById}
                                ownedFor={ownedFor}
                                onOpenOwned={(bid) => setOwnedPanelLot(bid)}
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
            return (
              <OwnedPanel
                open
                onClose={() => setOwnedPanelLot(null)}
                lotTitle={lot.title}
                resolution={res}
                relatedItem={relatedItem}
                collection={collectionQuery.data ?? []}
                busy={collectionLinksQuery.isFetching || collectionFeedbackQuery.isFetching}
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
      {footerExtraHost &&
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
                <SelectTrigger className="h-8 w-[176px] text-xs" aria-label="Modo da IA">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">IA: desligada</SelectItem>
                  <SelectItem value="all">IA: tudo</SelectItem>
                  <SelectItem value="watched">IA: vigiados + lances</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <AiProviderSelect value={aiProvider} onChange={changeAiProvider} />
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
              <span title="Última atualização da lista">
                Atualizado: {formatUpdatedAt(lots.data.updatedAt)}
              </span>
            ) : null}
          </>,
          footerExtraHost,
        )}
    </main>
  );
}

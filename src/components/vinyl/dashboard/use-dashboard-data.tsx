import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  localDayKey,
  setCodec,
  shiftSavedDayTab,
  usePersistedScroll,
  usePersistedState,
} from "@/lib/persisted-state";
import { toast } from "sonner";

import { watchedDateToKey, type HouseStats } from "@/components/vinyl/grouping";
import { type Condition, type Grade, parseConditionFromText, scoreCondition } from "@/lib/grading";
import {
  buildInterestMatcher,
  parseAiAlbum,
  toLotMarket,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import {
  analyzeOnDemand,
  getAiMode,
  repriceLotAi,
  runAiident,
  setAiMode,
  setAiProvider,
  setGeminiModel,
  setLotTags,
} from "@/lib/ai.functions";
import {
  applyCollectionDecision,
  dismissCollectionMatchTerms,
  getCollectionKeywordDenylist,
} from "@/lib/collection.functions";
import {
  enrichLotes,
  getLotCondition,
  getLotDetails,
  getSoldLots,
  getVerifiedHouses,
  getVinylLots,
  runCondition,
  runGalleryscan,
  scrapeVinylChunk,
  setVerifiedHouses,
} from "@/lib/leiloesbr.functions";
import {
  AI_PROVIDER_SHORT,
  formatFailoverTrail,
  type AiProvider,
  type GeminiModel,
} from "@/lib/ai-provider";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { useBidCoveredAlerts } from "@/lib/bid-alerts";
import type { CollectionItem } from "@/lib/collection.server";
import {
  dismissPossibleTrash,
  excludeLot,
  getExcludedLotsForMatching,
  getTrashKeywordDenylist,
} from "@/lib/lot-exclusion.functions";
import { buildTrashModel, matchPossibleTrash, trashProfile } from "@/lib/lot-exclusion";
import { saveAccum, WATCHED_ACCUM_STORAGE_KEY } from "@/lib/watched-accum";
import {
  bidIsCovered,
  bidIsWinning,
  COMPILATION_LABEL,
  isDiscBundle,
  LOTE_LABEL,
  normalizeForMatch,
  parsePrice,
  searchRelevance,
  titleCase,
  UNCLASSIFIED_LABEL,
  type VinylLot,
} from "@/lib/vinyl-parse";
import { priceRoseSinceEval } from "@/lib/ai-reprice";
import {
  lotIdentity,
  ownedCandidate,
  ownedMatchForLot,
  ownedSignatureFromLot,
  resolveArtistAlias,
  resolveOwned,
  type CollectionLinks,
  type LotIdentity,
  type OwnedFeedback,
  type OwnedHit,
  type OwnedResolution,
} from "@/lib/wantlist-match";
import {
  useAiProviderQuery,
  useAnalyticsAliasesQuery,
  useCollectionFeedbackQuery,
  useCollectionLinksQuery,
  useCollectionQuery,
  useGeminiModelQuery,
  useInterestsQuery,
  useLotAiQuery,
  useLotIdentQuery,
  useLotMarketQuery,
  useLotsQuery,
  useLotsRangeQueries,
  patchLotsCaches,
  useBidsQuery,
  useWatchedQuery,
  queryKeys,
} from "@/lib/queries";
import { BAR_PAGES, buildBarDays, DAY_PAGE, TODAY_INDEX, TODAY_PAGE } from "@/lib/day-bar";

/** Tamanho de cada bloco da busca de detalhes (peca.asp) — o servidor aceita até 100. */
const LOT_DETAILS_CHUNK = 50;

type LotDetailsMap = Record<string, { currentValue?: string; nextBid?: string; sold?: string }>;

/** Dia de hoje (fuso local) no formato das chaves de dia do app (`yyyy-mm-dd`). */
function localTodayKey(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** Junta os blocos da busca de detalhes num só mapa por `id` (estável: fora do componente). */
function combineLotDetails(results: { data?: LotDetailsMap }[]): LotDetailsMap {
  const out: LotDetailsMap = {};
  for (const r of results) if (r.data) Object.assign(out, r.data);
  return out;
}

/** "26/08 às 14:30" no fuso de São Paulo, ou "" quando não há data. */
export function formatUpdatedAt(iso: string | null | undefined): string {
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

/**
 * Estado, queries, derivações e mutações da tela inicial (`VinylDashboard`). Separado da
 * renderização para cada parte caber numa leitura; a tela consome o objeto devolvido.
 */
export function useDashboardData() {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle` (agora visível também no
  // desktop) — desde que a versão anterior por scroll (`useHideOnScroll`) ficava piscando
  // (recálculo de altura de um `sticky` durante a transição realimentava a lógica de
  // direção do scroll). No desktop, esconder recolhe tudo MENOS a lista de dias/abas
  // (`TabsList`) — ela fica de fora do `HideableBar` colapsável, sempre visível, pra sempre
  // dar pra trocar de dia/Vigiados/Lances mesmo com o resto escondido.
  const [barsHidden, setBarsHidden] = usePersistedState("home-bars-hidden", false);
  // Altura real de cada parte do header sticky, medida ao vivo — as barras sticky internas
  // (dia/casas, seções de Vigiados/Lances) usam a soma como `top` para colar logo abaixo do
  // que estiver visível no momento, em vez de ficarem escondidas atrás. A `ref` fica no
  // CONTEÚDO de cada parte (altura natural estável), não no wrapper que esconde/mostra
  // (`HideableBar`) — senão o ResizeObserver ficaria medindo a própria transição de altura
  // dele.
  const [headerRef, headerHeight] = useMeasuredHeight();
  const [tabsBarRef, tabsBarHeight] = useMeasuredHeight();
  const stickyBelowHeader = { top: tabsBarHeight + (barsHidden ? 0 : headerHeight) };

  const [tab, setTab] = useState<string>(`day-${TODAY_INDEX}`);
  // Aba/página da barra de dias persistidas (recarregar ou reabrir o site volta ao mesmo lugar).
  // `savedOn` permite reapontar `day-N` para o mesmo dia quando a data virou.
  const [savedNav, setSavedNav, navHydrated] = usePersistedState<{
    tab: string;
    dayPage: number;
    savedOn: string;
  } | null>("home-nav", null);
  const [navReady, setNavReady] = useState(false);
  // Página (de 5 dias) da barra de dias em exibição e as já visitadas: as páginas de histórico
  // e futuro só são buscadas (`useLotsRangeQueries`) depois de abertas pela primeira vez.
  const [dayPage, setDayPageState] = useState<number>(TODAY_PAGE);
  const [visitedPages, setVisitedPages] = useState<number[]>([TODAY_PAGE]);
  const setDayPage = (page: number) => {
    setDayPageState(page);
    setVisitedPages((cur) => (cur.includes(page) ? cur : [...cur, page]));
  };
  useEffect(() => {
    if (!navHydrated) return;
    if (savedNav && typeof savedNav.tab === "string") {
      const today = localDayKey();
      const restoredTab = shiftSavedDayTab(
        savedNav.tab,
        savedNav.savedOn,
        today,
        BAR_PAGES * DAY_PAGE,
      );
      const dayMatch = /^day-(\d+)$/.exec(restoredTab);
      const page =
        savedNav.savedOn === today && Number.isInteger(savedNav.dayPage)
          ? savedNav.dayPage
          : dayMatch
            ? Math.floor(Number(dayMatch[1]) / DAY_PAGE)
            : TODAY_PAGE;
      const safePage = Math.max(0, Math.min(BAR_PAGES - 1, page));
      setTab(restoredTab);
      setDayPage(safePage);
    }
    setNavReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navHydrated]);
  useEffect(() => {
    if (!navReady) return;
    setSavedNav({ tab, dayPage, savedOn: localDayKey() });
  }, [navReady, tab, dayPage, setSavedNav]);
  // Alvo (via portal) para a barra de controles do dia (Vigiados/Lances/Analisar/casas),
  // renderizada dentro do header — acima da lista de dias — em vez de sticky abaixo dele.
  const [dayBarHost, setDayBarHost] = useState<HTMLDivElement | null>(null);
  // Alvo (via portal) para o botão "Incluir/Ocultar finalizados", renderizado ao final da
  // faixa de dias (depois de "Lances"), em vez de junto com a barra de controles do dia.
  const [finishedToggleHost, setFinishedToggleHost] = useState<HTMLDivElement | null>(null);
  // Alvo (via portal) para o modo/provedor de IA + "Atualizar tudo", que vivem na MESMA
  // barra do rodapé global (Footer.tsx, montado no __root.tsx) — não um <footer> próprio.
  const [footerExtraHost, setFooterExtraHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setFooterExtraHost(document.getElementById("footer-extra"));
  }, []);
  const [artistFilter, setArtistFilter] = usePersistedState<string>("home-artist-filter", "");
  // A busca só roda ao confirmar (Enter/botão) — evita filtrar a lista a cada tecla. O rascunho
  // digitado vive isolado em `LotSearchBox` para não re-renderizar esta árvore inteira a cada
  // tecla (era isso que travava a digitação, mesmo já não filtrando em tempo real).
  const [search, setSearch] = usePersistedState<string>("home-search", "");
  const [watchedViewDay, setWatchedViewDay] = usePersistedState<string | null>(
    "home-watched-view-day",
    null,
  );
  const [bidsViewDay, setBidsViewDay] = usePersistedState<string | null>(
    "home-bids-view-day",
    null,
  );
  // Estado de abertura dos grupos por dia na aba geral de Lances (chave = dayKey). Sem override
  // explícito, o dia atual (days[0]) começa aberto e os demais fechados — só grava aqui quando
  // o usuário clica, então o padrão segue acompanhando qual é "hoje" mesmo com o passar dos dias.
  const [bidsDayOpen, setBidsDayOpen] = usePersistedState<Record<string, boolean>>(
    "home-bids-day-open",
    {},
  );
  const [showFinishedDays, setShowFinishedDays] = usePersistedState<Set<string>>(
    "home-show-finished",
    new Set(),
    setCodec,
  );
  const toggleShowFinished = (day: string) =>
    setShowFinishedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  // Estado por casa (chave `${dia}|${casa}`): casas iniciam fechadas.
  const [openHouses, setOpenHouses] = usePersistedState<Set<string>>(
    "home-open-houses",
    new Set(),
    setCodec,
  );
  const [houseArtist, setHouseArtist] = usePersistedState<Record<string, string>>(
    "home-house-artist",
    {},
  );
  const [housePrice, setHousePrice] = usePersistedState<Record<string, string>>(
    "home-house-price",
    {},
  );
  const toggleHouse = (key: string) =>
    setOpenHouses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  /** Fecha de uma vez todas as casas de um dia (grade principal). */
  const closeAllHouses = (day: string) =>
    setOpenHouses((prev) => new Set([...prev].filter((key) => !key.startsWith(`${day}|`))));
  // Seções de casa em Vigiados/Lances (dia e geral) não tinham como recolher — ficavam
  // sempre abertas. Aqui o padrão é o OPOSTO do `openHouses` acima: a casa começa ABERTA e
  // só entra neste set quando o usuário fecha (chave livre, cada tela usa seu prefixo:
  // `watched-day|`, `bids-day|`, `watched|`, `bids|`).
  // Filtro pelos badges de casa/catálogo/artista (vigia / lance ganhando / lance coberto),
  // único para o app todo (abas de dia, Vigiados do dia e aba Vigiados); clicar de novo limpa.
  // Seleção múltipla (OU): vazio = sem filtro.
  const [statFilterRaw, setStatFilterRaw] = usePersistedState<Set<string>>(
    "home-stat-filter",
    new Set(),
    setCodec,
  );
  const statFilter = statFilterRaw as ReadonlySet<keyof HouseStats>;
  const setStatFilter = setStatFilterRaw as unknown as Dispatch<
    SetStateAction<ReadonlySet<keyof HouseStats>>
  >;
  const clearStatFilter = () => setStatFilter(new Set());
  const toggleStatFilter = (key: keyof HouseStats) =>
    setStatFilter((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [closedHouseSections, setClosedHouseSections] = usePersistedState<Set<string>>(
    "home-closed-sections",
    new Set(),
    setCodec,
  );
  const toggleHouseSection = (key: string) =>
    setClosedHouseSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const closeAllHouseSections = (keys: string[]) =>
    setClosedHouseSections((prev) => new Set([...prev, ...keys]));
  const openAllHouseSections = (keys: string[]) =>
    setClosedHouseSections((prev) => new Set([...prev].filter((key) => !keys.includes(key))));
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
  const runToggle = useServerFn(toggleWatch);
  const runChunk = useServerFn(scrapeVinylChunk);
  const runGalleryscanFn = useServerFn(runGalleryscan);
  const runEnrich = useServerFn(enrichLotes);
  const runConditionFn = useServerFn(runCondition);
  const runAiidentFn = useServerFn(runAiident);
  const fetchVerified = useServerFn(getVerifiedHouses);
  const saveVerified = useServerFn(setVerifiedHouses);
  const fetchLotDetails = useServerFn(getLotDetails);
  const runRepriceLotAi = useServerFn(repriceLotAi);
  const fetchSoldLots = useServerFn(getSoldLots);
  const runSaveTags = useServerFn(setLotTags);
  const fetchLotCondition = useServerFn(getLotCondition);
  const fetchAiMode = useServerFn(getAiMode);
  const runSetAiMode = useServerFn(setAiMode);
  const runSetAiProvider = useServerFn(setAiProvider);
  const runSetGeminiModel = useServerFn(setGeminiModel);
  const runAnalyze = useServerFn(analyzeOnDemand);
  const runApplyDecision = useServerFn(applyCollectionDecision);
  const fetchCollectionKeywordDenylist = useServerFn(getCollectionKeywordDenylist);
  const runDismissCollectionMatch = useServerFn(dismissCollectionMatchTerms);
  const runExcludeLot = useServerFn(excludeLot);
  const fetchExcludedLots = useServerFn(getExcludedLotsForMatching);
  const fetchTrashDenylist = useServerFn(getTrashKeywordDenylist);
  const runDismissTrash = useServerFn(dismissPossibleTrash);

  const baseLots = useLotsQuery();
  // `days` do servidor = hoje..+4 (janela padrão); hoje é o primeiro.
  const todayKey = baseLots.data?.days[0] ?? null;
  const barDays = useMemo(() => (todayKey ? buildBarDays(todayKey) : []), [todayKey]);
  const rangeQueries = useLotsRangeQueries(
    Array.from({ length: BAR_PAGES }, (_, page) =>
      page === TODAY_PAGE || !barDays.length || !visitedPages.includes(page)
        ? null
        : { from: barDays[page * DAY_PAGE]!, to: barDays[page * DAY_PAGE + DAY_PAGE - 1]! },
    ),
  );
  const rangeStamp = rangeQueries.map((q) => q.dataUpdatedAt).join(",");
  // Mescla a janela padrão com as páginas de histórico/futuro carregadas — o resto da tela lê
  // `lots.data.lots` sem saber de onde cada lote veio.
  const mergedLots = useMemo(() => {
    if (!baseLots.data) return baseLots.data;
    const byId = new Map<string, VinylLot>();
    for (const q of rangeQueries) for (const lot of q.data?.lots ?? []) byId.set(lot.id, lot);
    for (const lot of baseLots.data.lots) byId.set(lot.id, lot);
    return { ...baseLots.data, lots: [...byId.values()] };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rangeStamp` representa `rangeQueries`
  }, [baseLots.data, rangeStamp]);
  const lots = { ...baseLots, data: mergedLots };
  const pageLoading = rangeQueries.some((q) => q.isLoading);
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
  // (`queryKeys.watched`/`queryKeys.bids`, compartilhada no `QueryClient` do app inteiro) —
  // ela usa esta MESMA função, senão a versão dela (sem mesclar) sobrescreve o acumulado
  // desta rota ao navegar entre as duas.
  const { query: watched, accumRef: watchedAccumRef } = useWatchedQuery();
  const { query: bids } = useBidsQuery();
  // Avaliações da IA (score/raridade/oportunidade) e interesses do usuário: alimentam o
  // badge de nota no canto do card. Best-effort — sem avaliação, o card fica como hoje.
  const lotAiQuery = useLotAiQuery();
  // Identificação simplificada (artista/álbum/ano) — roda para TODOS os lotes, barata.
  // Alimenta a exibição, a busca e o filtro por artista, priorizada sobre o título.
  const lotIdentQuery = useLotIdentQuery();
  const interestsQuery = useInterestsQuery();
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
  const aiProviderQuery = useAiProviderQuery();
  const aiProvider: AiProvider = aiProviderQuery.data ?? "anthropic";
  const changeAiProvider = (provider: AiProvider) => {
    const prev = aiProviderQuery.data;
    queryClient.setQueryData(queryKeys.aiProvider, provider); // otimista
    void runSetAiProvider({ data: { provider } })
      .then(() => toast.success(`Provedor padrão: ${AI_PROVIDER_SHORT[provider]}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.aiProvider, prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o provedor de IA");
      });
  };

  // Modelo do Gemini (Flash-Lite/Flash/Pro). Vale mesmo com Claude escolhido: o failover
  // por falta de créditos pode acabar caindo no Gemini com esse modelo.
  const geminiModelQuery = useGeminiModelQuery();
  const geminiModel: GeminiModel = geminiModelQuery.data ?? "gemini-3.1-flash-lite";
  const changeGeminiModel = (model: GeminiModel) => {
    const prev = geminiModelQuery.data;
    queryClient.setQueryData(queryKeys.geminiModel, model); // otimista
    void runSetGeminiModel({ data: { model } })
      .then(() => toast.success(`Modelo do Gemini: ${model}`))
      .catch((error: unknown) => {
        queryClient.setQueryData(queryKeys.geminiModel, prev);
        toast.error((error as Error)?.message || "Não foi possível salvar o modelo do Gemini");
      });
  };
  // Análise SOB DEMANDA (botões por dia/casa). `analyzing` guarda a chave em execução:
  // o dia (`day`) ou a casa (`${day}|${casa}`). Roda em laço até esgotar os não avaliados
  // (ou parar de progredir), depois revalida o cache queryKeys.lotAi para as notas aparecerem.
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
      let attemptErrors: Partial<Record<AiProvider, string>> = {};
      try {
        for (let guard = 0; guard < 60; guard += 1) {
          const res = await runAnalyze({
            data: { day: opts.day, house: opts.house, max: 25, provider },
          });
          evaluated += res.evaluated;
          failed += res.failed ?? 0;
          if (res.error) lastError = res.error;
          if (res.switched && res.served) switchedTo = res.served;
          if (res.attemptErrors) attemptErrors = { ...attemptErrors, ...res.attemptErrors };
          // Para quando não sobra nada OU quando a rodada não avaliou nada (lotes que
          // falham sempre voltariam ao "pendente" e causariam laço infinito).
          if (res.remaining === 0 || res.evaluated === 0) break;
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.lotAi });
        // Avisa se houve failover: mostra o motivo de CADA provedor pulado (ex.: "Claude: sem
        // chave de API configurada · Gemini: sem créditos/quota") em vez de um "trocou" genérico.
        const trail = formatFailoverTrail(attemptErrors);
        if (switchedTo && switchedTo !== provider) {
          toast.warning(
            trail
              ? `${trail} — usei ${AI_PROVIDER_SHORT[switchedTo]}`
              : `${AI_PROVIDER_SHORT[provider]} indisponível — usei ${AI_PROVIDER_SHORT[switchedTo]}`,
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
        evalPrice: r.eval_price,
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
  // Aviso (toast) quando um lote com lance vira "Coberto" — só com o app aberto, ver
  // `@/lib/bid-alerts`.
  useBidCoveredAlerts(bids.data, (id) => albumById.get(id) ?? null);
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
  const lotMarketQuery = useLotMarketQuery();
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
  // Lotes já excluídos (ver src/lib/lot-exclusion.server.ts) — alimenta o badge "possível
  // lixo" na listagem. Calculado no CLIENTE (não persistido): volume baixo, sem gasto de IA.
  const excludedLotsQuery = useQuery({
    queryKey: ["excluded-lots"] as const,
    queryFn: () => fetchExcludedLots(),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // Termos que o usuário já negou ("isto não é lixo" — clique no badge, ver
  // `onDismissTrash`/`dismissPossibleTrash`). Filtrados de AMBOS os lados do casamento por
  // palavras-chave, então o aprendizado vale globalmente, não só pro lote clicado.
  const trashDenylistQuery = useQuery({
    queryKey: ["trash-keyword-denylist"] as const,
    queryFn: () => fetchTrashDenylist(),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  // "Possível lixo": cada lote vira um perfil (termos do título SEM artista/álbum do próprio
  // lote, indicadores de tipo de objeto, sinal forte de vinil) e é comparado com o MOTIVO de
  // cada lote excluído (motivo digitado, indicador DVD/CD/livro…, ou termos raros) — ver
  // `buildTrashModel`/`matchPossibleTrash` em `lot-exclusion.ts`. A própria listagem serve de
  // corpus para saber quais termos são comuns demais para indicar lixo.
  const possibleTrashById = useMemo(() => {
    const excluded = excludedLotsQuery.data ?? [];
    const map = new Map<string, ReturnType<typeof matchPossibleTrash>>();
    if (!excluded.length) return map;
    const all = lots.data?.lots ?? [];
    const profiles = all.map((lot) => {
      const album = albumById.get(lot.id) ?? null;
      return trashProfile({
        title: lot.title,
        artist: lot.artist,
        content: [parseAiAlbum(album).artist, album, marketById.get(lot.id)?.releaseTitle],
      });
    });
    const model = buildTrashModel(excluded, profiles, new Set(trashDenylistQuery.data ?? []));
    all.forEach((lot, i) => {
      const signal = matchPossibleTrash(profiles[i]!, model);
      if (signal) map.set(lot.id, signal);
    });
    return map;
  }, [excludedLotsQuery.data, trashDenylistQuery.data, lots.data, albumById, marketById]);
  const possibleTrashFor = (lot: { id: string }) => possibleTrashById.get(lot.id) ?? null;
  const dismissTrashMutation = useMutation({
    mutationFn: async (terms: string[]) => await runDismissTrash({ data: { terms } }),
    onMutate: (terms) => {
      // Otimista: o badge some NA HORA (o memo acima recalcula assim que o cache muda).
      const prev = trashDenylistQuery.data ?? [];
      queryClient.setQueryData(["trash-keyword-denylist"], [...new Set([...prev, ...terms])]);
      return { prev };
    },
    onError: (error: unknown, _terms, ctx) => {
      if (ctx) queryClient.setQueryData(["trash-keyword-denylist"], ctx.prev);
      toast.error((error as Error)?.message || "Não foi possível salvar");
    },
    onSuccess: () => toast.success('Marcado como "não é lixo" — o sistema aprendeu'),
  });
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
  const collectionQuery = useCollectionQuery();
  // Relações manuais (override por lote) e aprendizado (feedback por assinatura). Mesmas
  // chaves de app_state; compartilham cache entre telas.
  // Best-effort: um erro aqui NUNCA pode derrubar a home (a relação/aprendizado é acessório).
  const collectionLinksQuery = useCollectionLinksQuery();
  const collectionFeedbackQuery = useCollectionFeedbackQuery();
  // Termos negados como genéricos demais para casar a Coleção (clique no painel de relação
  // quando o casamento foi falso positivo por causa de uma palavra específica — ver
  // `matchedAlbumTerms`/`ownedScore` em `wantlist-match.ts`). Mesmo padrão do
  // "possível lixo": filtrado dos dois lados, só cresce, vale globalmente.
  const collectionKeywordDenylistQuery = useQuery<string[]>({
    queryKey: ["collection-keyword-denylist"] as const,
    queryFn: async () => {
      try {
        return ((await fetchCollectionKeywordDenylist()) as string[]) ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const collectionKeywordDenylist = useMemo(
    () => new Set(collectionKeywordDenylistQuery.data ?? []),
    [collectionKeywordDenylistQuery.data],
  );
  // Apelidos de artista curados no Analytics (fusão manual de grafias) — mesma chave/cache da
  // tela de Analytics (`queryKeys.analyticsAliases`). Reusados aqui pra uma correção de grafia feita
  // lá também valer no casamento da Coleção, sem precisar corrigir duas vezes.
  const analyticsAliasesQuery = useAnalyticsAliasesQuery();
  const artistAliases = useMemo(
    () => analyticsAliasesQuery.data?.artists ?? {},
    [analyticsAliasesQuery.data],
  );
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
          ownedCandidate({
            id: it.id,
            artist: resolveArtistAlias(it.artist, artistAliases),
            album: it.album,
            year: it.year,
          }),
        ),
    [collectionQuery.data, artistAliases],
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
            artist: resolveArtistAlias(artist, artistAliases),
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
  }, [lots.data, albumById, marketById, artistAliases]);
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
        const best = ownedMatchForLot(ownedCands, identity, collectionKeywordDenylist);
        if (best) map.set(lot.id, best);
      } catch {
        /* idem: falha de casamento de um lote é ignorada */
      }
    }
    return map;
    // collLabel depende de collById (memo estável); ownedByLotId/identityById cobrem os dados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedCands, ownedByLotId, identityById, collById, collectionKeywordDenylist]);

  // "Atualizar relações": rebusca Coleção, vínculos, rejeições ("não tenho") e termos negados —
  // a Coleção fica em cache por 1h, então discos recém-adicionados (aqui ou em outro aparelho)
  // não casavam com os lotes até expirar. O casamento é recalculado para TODOS os lotes e
  // `resolveOwned` continua respeitando as decisões do usuário (rejeitado/vinculado não muda).
  const [refreshingCollection, setRefreshingCollection] = useState(false);
  const refreshCollectionMatches = async () => {
    setRefreshingCollection(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.collection }),
        queryClient.refetchQueries({ queryKey: queryKeys.collectionLinks }),
        queryClient.refetchQueries({ queryKey: queryKeys.collectionFeedback }),
        queryClient.refetchQueries({ queryKey: ["collection-keyword-denylist"] }),
      ]);
    } finally {
      setRefreshingCollection(false);
    }
  };

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
    queryClient.setQueryData<CollectionLinks>(queryKeys.collectionLinks, (old) => {
      const next = { ...(old ?? {}) };
      if (value === null) delete next[lot.id];
      else next[lot.id] = value;
      return next;
    });
    queryClient.setQueryData<OwnedFeedback[]>(queryKeys.collectionFeedback, (old) => {
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
        queryClient.setQueryData(queryKeys.collectionLinks, prevLinks);
        queryClient.setQueryData(queryKeys.collectionFeedback, prevFeedback);
        toast.error((error as Error)?.message || "Não foi possível salvar a relação");
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.collectionLinks });
        void queryClient.invalidateQueries({ queryKey: queryKeys.collectionFeedback });
      });
  };

  // "Este termo não deveria contar" (painel de relação, casamento com falso positivo) — mesmo
  // padrão otimista do `dismissTrashMutation`: o termo some do cálculo do score na hora.
  const dismissCollectionMatchMutation = useMutation({
    mutationFn: async (terms: string[]) => await runDismissCollectionMatch({ data: { terms } }),
    onMutate: (terms) => {
      const prev = collectionKeywordDenylistQuery.data ?? [];
      queryClient.setQueryData(["collection-keyword-denylist"], [...new Set([...prev, ...terms])]);
      return { prev };
    },
    onError: (error: unknown, _terms, ctx) => {
      if (ctx) queryClient.setQueryData(["collection-keyword-denylist"], ctx.prev);
      toast.error((error as Error)?.message || "Não foi possível salvar");
    },
    onSuccess: () => toast.success("Termo marcado como genérico — o casamento vai melhorar"),
  });

  // Exclusão definitiva de lote (DELETE físico + aprendizado — ver
  // src/lib/lot-exclusion.server.ts). Um diálogo só, controlado por este estado.
  const [excludeTarget, setExcludeTarget] = useState<{ id: string; title: string } | null>(null);
  const excludeMutation = useMutation({
    mutationFn: async (input: { lotId: string; reason?: string }) =>
      await runExcludeLot({ data: input }),
    onSuccess: (result, input) => {
      if (!result.ok) {
        toast.error("Este lote já não estava mais na listagem");
        return;
      }
      patchLotsCaches(queryClient, (list) => list.filter((item) => item.id !== input.lotId));
      void queryClient.invalidateQueries({ queryKey: ["excluded-lots"] });
      toast.success("Lote excluído — não volta a aparecer");
      setExcludeTarget(null);
    },
    onError: (error: unknown) => {
      toast.error((error as Error)?.message || "Não foi possível excluir o lote");
    },
  });

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
        queryClient.setQueryData(queryKeys.lots, fresh);
        toast.success("Dia atualizado");
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar este dia agora");
      } finally {
        setRefreshingDay(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.watched });
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

  // Vigiados + lances de uma vez (botão "Atualizar" da aba Vigiados e o auto-refresh de 1 min
  // enquanto ela está aberta). `silent` = disparo automático: sem toast (nem de erro), para não
  // poluir a tela a cada minuto. Ignora a chamada se a anterior ainda não terminou.
  const [refreshingWatchedAndBids, setRefreshingWatchedAndBids] = useState(false);
  const refreshingWatchedAndBidsRef = useRef(false);
  const refreshWatchedAndBids = (silent = false) => {
    if (refreshingWatchedAndBidsRef.current) return;
    refreshingWatchedAndBidsRef.current = true;
    void (async () => {
      setRefreshingWatchedAndBids(true);
      try {
        const results = await Promise.all([
          watched.refetch({ throwOnError: true }),
          bids.refetch({ throwOnError: true }),
        ]);
        for (const r of results) if (r.error) throw r.error;
        if (!silent) toast.success("Vigiados e lances atualizados");
      } catch (error) {
        if (!silent) {
          toast.error((error as Error)?.message || "Não foi possível atualizar agora");
        }
      } finally {
        refreshingWatchedAndBidsRef.current = false;
        setRefreshingWatchedAndBids(false);
        void queryClient.invalidateQueries({ queryKey: ["lot-details"] });
        void queryClient.invalidateQueries({ queryKey: ["sold-lots"] });
      }
    })();
  };

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshPct, setRefreshPct] = useState<number | null>(null);
  // Fase atual (rótulo no botão) depois que a varredura geral (com % preciso) termina —
  // as fases seguintes têm tamanhos heterogêneos demais pra uma % confiável, então só
  // mostram o que estão fazendo (mesmo espírito das seções do `refresh.yml`).
  const [refreshPhase, setRefreshPhase] = useState<string | null>(null);
  // Atualiza tudo em BLOCOS sequenciais (uma requisição por vez), evitando uma varredura
  // completa que estoura o tempo do servidor em produção — mesma ordem do cron automático
  // (`refresh.yml`): varredura geral → descoberta por galeria → nº de lote → estado
  // Disco/Capa → identificação por IA (só dispara, não espera terminar).
  const refreshAll = () => {
    void (async () => {
      setRefreshingAll(true);
      setRefreshPct(0);
      setRefreshPhase(null);
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
        setRefreshPct(null);

        // Descoberta por galeria: casas fora da plataforma ou cuja categoria "Disco de
        // Vinil" não bate com a marcação da LeilõesBR (ex.: Abreu Colecionismo) — sem isso
        // essas casas nunca aparecem só pela varredura geral acima.
        setRefreshPhase("Descobrindo por galeria…");
        let galleryOffset = 0;
        for (let guard = 0; guard < 70; guard += 1) {
          const res = await runGalleryscanFn({ data: { offset: galleryOffset, count: 3 } });
          if (res.done || res.nextOffset == null) break;
          galleryOffset = res.nextOffset;
        }

        // Preenche o nº do lote (via catálogo das casas) percorrendo os leilões por cursor.
        setRefreshPhase("Preenchendo nº de lote…");
        let enrichOffset = 0;
        for (let guard = 0; guard < 60; guard += 1) {
          const res = await runEnrich({ data: { max: 6, offset: enrichOffset } });
          if (res.done || res.nextOffset == null) break;
          enrichOffset = res.nextOffset;
        }

        // Estado Disco/Capa (lê o mesmo catálogo já usado acima, sem custo extra de rede).
        setRefreshPhase("Lendo estado Disco/Capa…");
        for (let guard = 0; guard < 40; guard += 1) {
          const res = await runConditionFn({ data: { max: 8 } });
          if (res.done) break;
        }

        const fresh = await fetchLots({ data: {} });
        queryClient.setQueryData(queryKeys.lots, fresh);
        toast.success("Lista atualizada");

        // Identificação por IA (artista/álbum): UMA chamada só, nunca espera o batch
        // terminar — a Claude processa em Batches (minutos) e o resto completa sozinho no
        // próximo ciclo do cron ou no próximo "Atualizar tudo".
        setRefreshPhase("Enviando identificação por IA…");
        try {
          const identRes = await runAiidentFn();
          if ("skipped" in identRes) {
            // nenhum provedor de IA configurado — nada a informar
          } else if ("pending" in identRes) {
            toast.info("Identificação por IA: coletando o lote anterior — vai completar sozinho");
          } else if ("submitted" in identRes && (identRes.submitted ?? 0) > 0) {
            toast.info(
              `Identificação por IA enviada (${identRes.submitted} lote(s)) — vai completar sozinho`,
            );
          } else if ("sync" in identRes && !identRes.done) {
            toast.info("Identificação por IA: mais um lote processado — o resto completa sozinho");
          }
        } catch (error) {
          console.error("[refreshAll] falha ao disparar identificação por IA", error);
        }
      } catch (error) {
        toast.error((error as Error)?.message || "Não foi possível atualizar a lista agora");
      } finally {
        setRefreshingAll(false);
        setRefreshPct(null);
        setRefreshPhase(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.watched });
      }
    })();
  };

  const toggle = useMutation({
    mutationFn: async (lot: { idPeca: string; idLeilao: string; base: string; watch: boolean }) =>
      await runToggle({ data: lot }),
    onMutate: (lot) => setPending(lot.idPeca),
    onSuccess: (result, lot) => {
      patchLotsCaches(queryClient, (list) =>
        list.map((item) =>
          item.idPeca === lot.idPeca ? { ...item, watched: result.watched } : item,
        ),
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
      // NÃO invalida queryKeys.watched aqui: a conta do LeilõesBR pode demorar a refletir o
      // toggle que acabou de ser confirmado (ver `toggleWatchOnSite`), e um refetch imediato
      // trazia a lista "atrasada" (sem o lote recém-vigiado, ou ainda com o recém-desvigiado) —
      // o `mergeWatchedAccum` então desfazia a atualização otimista acima (apagava o vigiado
      // novo por "sumiu do fresh e o leilão não terminou", ou reinseria o desvigiado por ainda
      // vir no fresh), fazendo o card voltar ao estado errado mesmo com o LeilõesBR já
      // confirmado. O estado que acabamos de gravar já é autoritativo (veio da resposta do
      // próprio endpoint de toggle); o próximo refetch natural (`staleTime`, refresh manual etc.)
      // reconcilia quando a conta do LeilõesBR já tiver atualizado.
      queryClient.setQueryData(queryKeys.watched, [...watchedAccumRef.current!.values()]);
      if (result.watched) toast.success("Lote vigiado no LeilõesBR");
      else
        toast.success("Vigia removida no LeilõesBR", {
          duration: 5000,
          action: { label: "Desfazer", onClick: () => toggle.mutate({ ...lot, watch: true }) },
        });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível sincronizar a vigia"),
    onSettled: () => setPending(null),
  });

  // Edição manual de tags da IA (add/remove ao passar o mouse): atualiza o cache queryKeys.lotAi
  // otimisticamente e persiste no banco.
  const patchTags = (id: string, tags: string[]) =>
    queryClient.setQueryData(queryKeys.lotAi, (old: unknown) =>
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.lotAi });
    },
  });
  const editTags = (id: string) => (tags: string[]) => saveTagsMut.mutate({ id, tags });

  const days = lots.data?.days ?? [];
  // (`days` acima = janela padrão hoje..+4; `barDays` = os 25 dias da barra, com histórico.)
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
  // Por casa: tem algum lote com lance vencendo (estrela verde) e/ou coberto (vermelha) —
  // mostradas ao lado do nome da casa nos cards de Vigiados.
  const houseBidFlags = useMemo(() => {
    const map = new Map<string, { winning: boolean; covered: boolean }>();
    for (const b of bids.data ?? []) {
      const cur = map.get(b.house) ?? { winning: false, covered: false };
      if (bidIsWinning(b.status)) cur.winning = true;
      if (bidIsCovered(b.status)) cur.covered = true;
      map.set(b.house, cur);
    }
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
  // Horário do leilão por `${dia}|casa` — "Meus lances" não traz o horário (só a data do
  // lance), então casamos pelo dia+casa com a varredura geral e os vigiados, pra ordenar os
  // lances por horário do leilão igual às outras telas.
  const houseTimeByDayHouse = useMemo(() => {
    const map = new Map<string, string>();
    for (const lot of lots.data?.lots ?? [])
      if (lot.dayKey && lot.house && lot.time) map.set(`${lot.dayKey}|${lot.house}`, lot.time);
    for (const w of watched.data ?? []) {
      const key = `${watchedDateToKey(w.date)}|${w.house}`;
      if (w.house && w.time && !map.has(key)) map.set(key, w.time);
    }
    return map;
  }, [lots.data, watched.data]);
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
  //
  // Ordem = prioridade (os pregões de HOJE/próximos primeiro, depois os passados do mais
  // recente pro mais antigo) e busca FATIADA em blocos de `LOT_DETAILS_CHUNK`: o servidor tem
  // teto de 100 alvos por chamada e os vigiados ACUMULAM (`watched-accum`, incluem dias já
  // passados) — com ~180 vigiados + lances, o teto cortava lotes arbitrários (inclusive de
  // hoje) e o card ficava sem "Próximo". Cada bloco é uma query própria (renderiza assim que
  // chega; o primeiro traz justamente os pregões mais próximos).
  const lotDetailTargets = useMemo(() => {
    const today = localTodayKey();
    const byId = new Map<string, { id: string; idPeca: string; url: string; day: string }>();
    for (const w of watched.data ?? [])
      if (w.id && w.idPeca && w.url)
        byId.set(w.id, {
          id: w.id,
          idPeca: w.idPeca,
          url: w.url,
          day: dayKeyByLotId.get(w.id) || watchedDateToKey(w.date),
        });
    for (const b of bids.data ?? [])
      if (b.id && b.idPeca && b.url && !byId.has(b.id))
        byId.set(b.id, {
          id: b.id,
          idPeca: b.idPeca,
          url: b.url,
          // `b.date` é a data do LANCE, não a do pregão: sem o dia da varredura (o lote some
          // dela quando o pregão entra AO VIVO), trata como pregão atual — lances são poucos e
          // são justamente os que mais precisam do "Próximo".
          day: dayKeyByLotId.get(b.id) || today,
        });
    const rank = (day: string) => (!day ? 2 : day >= today ? 0 : 1);
    return [...byId.values()]
      .sort((a, b) => {
        const ra = rank(a.day);
        const rb = rank(b.day);
        if (ra !== rb) return ra - rb;
        if (ra === 0) return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; // próximos: mais cedo 1º
        return a.day > b.day ? -1 : a.day < b.day ? 1 : 0; // passados: mais recente 1º
      })
      .map(({ id, idPeca, url }) => ({ id, idPeca, url }));
  }, [watched.data, bids.data, dayKeyByLotId]);
  const lotDetailChunks = useMemo(() => {
    const chunks: (typeof lotDetailTargets)[] = [];
    for (let i = 0; i < lotDetailTargets.length; i += LOT_DETAILS_CHUNK)
      chunks.push(lotDetailTargets.slice(i, i + LOT_DETAILS_CHUNK));
    return chunks;
  }, [lotDetailTargets]);
  const lotDetailsData = useQueries({
    queries: lotDetailChunks.map((chunk) => ({
      queryKey: [
        "lot-details",
        chunk
          .map((t) => t.id)
          .sort()
          .join(","),
      ] as const,
      queryFn: () => fetchLotDetails({ data: { targets: chunk } }),
      staleTime: 3 * 60 * 1000,
      // Sempre rechecar ao abrir a tela (o conjunto já é pequeno/escopado — vigiados+lances).
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: false,
    })),
    combine: combineLotDetails,
  });
  const nextBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, d] of Object.entries(lotDetailsData)) if (d.nextBid) map.set(id, d.nextBid);
    return map;
  }, [lotDetailsData]);
  // Valor atual AO VIVO (VALOR_VALUE do peca.asp) — para VIGIADOS + LANCES, mesmo fetch que já
  // traz `nextBid`/`sold`. Mais fresco que `priceById` (varredura geral, cron 3×/dia) e cobre o
  // caso em que o leilão já está ao vivo e o lote some da listagem pública (`priceById` fica
  // sem entrada nesse caso). Usado como override em `currentPriceFor` abaixo.
  const currentValueById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, d] of Object.entries(lotDetailsData))
      if (d.currentValue) map.set(id, d.currentValue);
    return map;
  }, [lotDetailsData]);
  // "Atual" preferindo o valor AO VIVO (peca.asp) sobre o da varredura geral/conta, quando
  // disponível — ver comentário de `currentValueById`.
  const currentPriceFor = (id: string, fallback: string) => currentValueById.get(id) || fallback;
  // Nota da IA acompanha o PREÇO (vigiados + lances): a nota mistura raridade + oportunidade
  // e é dada com o preço do momento da avaliação (`lot_ai.eval_price`). Quando o valor atual
  // (ao vivo quando houver, senão varredura/vigia) sobe o bastante (`priceRoseSinceEval`,
  // `ai-reprice.ts`), pede a reavaliação desses lotes ao servidor (que reconfere a subida) e
  // grava as linhas novas direto no cache `queryKeys.lotAi`. Cada `id|preço` só é tentado 1× por
  // sessão (sem laço se a IA falhar). Nada acontece com a IA no modo "off".
  const repriceAttemptedRef = useRef<Set<string>>(new Set());
  const repriceRunningRef = useRef(false);
  useEffect(() => {
    if (aiMode === "off" || repriceRunningRef.current || !lotAiQuery.data) return;
    const aiRowById = new Map(lotAiQuery.data.map((r) => [r.id, r]));
    const info = new Map<
      string,
      {
        id: string;
        title: string;
        price: string;
        house: string;
        image: string | null;
        day: string;
      }
    >();
    for (const w of watched.data ?? [])
      if (w.id && w.title)
        info.set(w.id, {
          id: w.id,
          title: w.title,
          price: currentValueById.get(w.id) || priceById.get(w.id) || w.price,
          house: w.house,
          image: w.image,
          day: watchedDateToKey(w.date),
        });
    for (const b of bids.data ?? [])
      if (b.id && b.title && !info.has(b.id))
        info.set(b.id, {
          id: b.id,
          title: b.title,
          price: currentValueById.get(b.id) || priceById.get(b.id) || "",
          house: b.house,
          image: b.image,
          // `b.date` é a data do LANCE, não a do pregão — sem ela, só `dayKeyByLotId` decide.
          day: "",
        });
    const today = localTodayKey();
    const pending = [...info.values()].filter((l) => {
      // Pregão já encerrado: a nota não serve mais pra decidir lance — não gasta IA.
      const day = dayKeyByLotId.get(l.id) || l.day;
      if (day && day < today) return false;
      const row = aiRowById.get(l.id);
      if (!row || !l.price) return false;
      if (repriceAttemptedRef.current.has(`${l.id}|${l.price}`)) return false;
      return priceRoseSinceEval(row.eval_price, parsePrice(l.price));
    });
    if (!pending.length) return;
    for (const l of pending) repriceAttemptedRef.current.add(`${l.id}|${l.price}`);
    repriceRunningRef.current = true;
    void (async () => {
      try {
        for (let i = 0; i < pending.length; i += 10) {
          const lots = pending.slice(i, i + 10).map(({ day: _day, ...l }) => l);
          const { rows } = await runRepriceLotAi({ data: { lots } });
          if (!rows.length) continue;
          const byId = new Map(rows.map((r) => [r.id, r]));
          queryClient.setQueryData(queryKeys.lotAi, (old: unknown) =>
            Array.isArray(old)
              ? [
                  ...old.map((r) => byId.get((r as { id: string })?.id) ?? r),
                  ...rows.filter((r) => !old.some((o) => (o as { id: string })?.id === r.id)),
                ]
              : old,
          );
        }
      } catch (error) {
        console.error("[lot-ai] reavaliação por subida de preço falhou", error);
      } finally {
        repriceRunningRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runRepriceLotAi/queryClient estáveis
  }, [
    aiMode,
    lotAiQuery.data,
    watched.data,
    bids.data,
    currentValueById,
    priceById,
    dayKeyByLotId,
  ]);
  // `priceById` (varredura geral) com o valor AO VIVO sobrescrevendo quando disponível — usado
  // pelas seções de "Meus lances" (`BidHouseSections`, que não tem preço próprio nenhum).
  const effectivePriceById = useMemo(() => {
    if (currentValueById.size === 0) return priceById;
    const map = new Map(priceById);
    for (const [id, value] of currentValueById) map.set(id, value);
    return map;
  }, [priceById, currentValueById]);
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
    for (const [id, d] of Object.entries(lotDetailsData)) {
      if (!d.sold) continue;
      if (!map.has(id)) map.set(id, d.sold);
    }
    return map;
  }, [soldLots.data, lotDetailsData]);
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
  // Lances com a URL da casa e o horário do leilão preenchidos, prontos para o agrupamento
  // por casa (o horário ordena as casas, igual às outras telas).
  const bidsWithHouseUrl = useMemo(
    () =>
      (bids.data ?? []).map((b) => ({
        ...b,
        houseUrl: houseUrlByName.get(b.house) ?? "#",
        time: houseTimeByDayHouse.get(`${bidDayKey(b)}|${b.house}`) ?? "",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bidDayKey só lê dayKeyByLotId (já na lista)
    [bids.data, houseUrlByName, houseTimeByDayHouse, dayKeyByLotId],
  );

  usePersistedScroll(
    `home:${tab}:${watchedViewDay ?? ""}:${bidsViewDay ?? ""}`,
    navReady && !lots.isLoading,
  );

  return {
    barsHidden,
    setBarsHidden,
    tab,
    setTab,
    setArtistFilter,
    headerRef,
    search,
    setSearch,
    lots,
    setDayBarHost,
    tabsBarRef,
    days,
    barDays,
    todayKey,
    dayPage,
    setDayPage,
    pageLoading,
    matchesSearch,
    watched,
    searchNorm,
    albumFor,
    bids,
    setFinishedToggleHost,
    watchedIds,
    effectiveArtist,
    bidStatusById,
    houseBidFlags,
    showFinishedDays,
    artistFilter,
    watchedViewDay,
    bidsViewDay,
    bidsWithHouseUrl,
    bidDayKey,
    dayBarHost,
    refreshDay,
    refreshingDay,
    setBidsViewDay,
    setWatchedViewDay,
    refreshWatched,
    refreshingWatched,
    refreshBids,
    refreshingBids,
    refreshWatchedAndBids,
    refreshingWatchedAndBids,
    statFilter,
    clearStatFilter,
    refreshingCollection,
    refreshCollectionMatches,
    toggleStatFilter,
    analyzeScope,
    analyzing,
    finishedToggleHost,
    toggleShowFinished,
    closeAllHouseSections,
    openAllHouseSections,
    closedHouseSections,
    toggleHouseSection,
    currentPriceFor,
    myBidById,
    nextBidById,
    pending,
    aiFor,
    marketFor,
    conditionFor,
    demandFor,
    ownedFor,
    setOwnedPanelLot,
    editTags,
    soldById,
    toggle,
    loteById,
    effectivePriceById,
    albumById,
    searchScore,
    possibleTrashFor,
    setExcludeTarget,
    dismissTrashMutation,
    openHouses,
    verifiedHouses,
    houseArtist,
    housePrice,
    toggleVerified,
    toggleHouse,
    setHouseArtistFor,
    setHousePriceFor,
    closeAllHouses,
    stickyBelowHeader,
    bidsDayOpen,
    setBidsDayOpen,
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
    aiProvider,
    changeAiProvider,
    geminiModel,
    changeGeminiModel,
    refreshAll,
    refreshingAll,
    refreshPct,
    refreshPhase,
  };
}

export type DashboardData = ReturnType<typeof useDashboardData>;

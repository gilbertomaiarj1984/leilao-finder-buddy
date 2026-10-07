import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Gavel,
  Loader2,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { usePersistedScroll, usePersistedState } from "@/lib/persisted-state";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LotTags,
  RarityLabel,
  RarityLegend,
  ReevaluateIconButton,
  ScoreBadge,
} from "@/components/vinyl/ai-score";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import {
  buildInterestMatcher,
  dealLabel,
  dealTone,
  discogsUrl,
  fmtMoney,
  formatAiAlbum,
  marketDeal,
  RARITY_LEGEND,
  rowStatusTone,
  toLotMarket,
  type LotAi,
  type LotMarket,
} from "@/components/vinyl/ai-score-utils";
import { dayLabel } from "@/components/vinyl/grouping";
import { setLotTags, setUserInterests } from "@/lib/ai.functions";
import {
  addWantlistItem,
  deleteWantlistItem,
  importWantlist,
  updateWantlistItem,
} from "@/lib/wantlist.functions";
import { toggleWatch } from "@/lib/leiloesbr-watch.functions";
import { useBidCoveredAlerts } from "@/lib/bid-alerts";
import { bidIsWinning, formatDayLabel, normalizeForMatch, type VinylLot } from "@/lib/vinyl-parse";
import { saveAccum, WATCHED_ACCUM_STORAGE_KEY } from "@/lib/watched-accum";
import {
  bestWantForLot,
  lotIdentity,
  wantCandidate,
  type WantCandidate,
} from "@/lib/wantlist-match";
import {
  useInterestsQuery,
  useLotAiQuery,
  useLotIdentQuery,
  useLotMarketQuery,
  useLotsQuery,
  useWantlistQuery,
  useBidsQuery,
  useWatchedQuery,
  queryKeys,
} from "@/lib/queries";
import { InterestsDialog, SondagemDialog } from "@/components/vinyl/analise-dialogs";

export const Route = createFileRoute("/_authenticated/analise")({
  head: () => ({ meta: [{ title: "Análise de Lotes — Garimpo de Vinil" }] }),
  component: AnalisePage,
});

const TOP_N = 30;

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type WantHit = { work: string; year: number | null; score: number };

function LotTitle({
  lot,
  want,
  album,
  marketYear,
}: {
  lot: VinylLot;
  want?: WantHit | null;
  album?: string | null;
  marketYear?: number | null;
}) {
  const wantTitle = want
    ? `Sondagem: ${want.work}${want.year ? ` (${want.year})` : ""} · ${Math.round(want.score * 100)}%`
    : undefined;
  // Artista/álbum da IA (mais acertivo) em destaque; o título original vira linha secundária.
  const aiLabel = album ? formatAiAlbum(album, marketYear) : "";
  return (
    <span className="inline-flex items-start gap-1" title={wantTitle}>
      {want ? (
        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label={wantTitle} />
      ) : null}
      {aiLabel ? (
        <span className="flex min-w-0 flex-col">
          <a
            href={lot.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 font-medium text-foreground hover:text-primary hover:underline"
            title={lot.title}
          >
            {aiLabel}
          </a>
          <span className="line-clamp-1 text-xs text-muted-foreground" title={lot.title}>
            {lot.title}
          </span>
        </span>
      ) : (
        <a
          href={lot.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-foreground hover:text-primary hover:underline"
          title={lot.title}
        >
          {lot.title}
        </a>
      )}
    </span>
  );
}

/**
 * Campos que ficam ABAIXO do título nas tabelas: raridade, oportunidade, âncora de mercado
 * (clicável → Discogs), motivo da IA e tags. A nota (com a explicação completa no hover)
 * fica na coluna à esquerda via `ScoreBadge`.
 */
function LotSummary({
  ai,
  market,
  price,
  onEditTags,
}: {
  ai?: LotAi;
  market?: LotMarket;
  price?: string;
  onEditTags?: (next: string[]) => void;
}) {
  if (!ai) return null;
  const mDeal = market ? marketDeal(price ?? "", market) : "indefinido";
  const href = market?.matched ? discogsUrl(market.releaseId) : null;
  // Faixa real no Brasil (total = preço + frete). Sempre mostrada quando existe.
  const range =
    market?.priceLowBr != null
      ? market.priceHighBr != null && market.priceHighBr > market.priceLowBr
        ? `${fmtMoney(market.priceLowBr, "BRL")}–${fmtMoney(market.priceHighBr, "BRL")}`
        : fmtMoney(market.priceLowBr, "BRL")
      : null;
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {ai.rarity ? (
          <span className="rounded bg-secondary px-1.5 py-0.5">
            <RarityLabel rarity={ai.rarity} />
          </span>
        ) : null}
        {ai.deal && ai.deal !== "indefinido" ? (
          <span className={`font-medium ${dealTone(ai.deal)}`}>{dealLabel(ai.deal)}</span>
        ) : null}
        {mDeal !== "indefinido" ? (
          <span className={`font-medium ${dealTone(mDeal)}`}>{dealLabel(mDeal)} vs. mercado</span>
        ) : null}
        {range ? (
          <span
            className="text-muted-foreground"
            title="Faixa no Discogs — vendedores do Brasil, já com o frete somado"
          >
            Discogs BR: <span className="font-medium text-foreground">{range}</span>
          </span>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Discogs <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      {ai.reason ? <p className="max-w-md text-xs text-muted-foreground">{ai.reason}</p> : null}
      <LotTags tags={ai.tags} onEdit={onEditTags} />
    </div>
  );
}

/** Botão de vigiar/desvigiar (só ícone) para as linhas das tabelas — sincroniza com o LeilõesBR. */
function WatchButton({
  watched,
  busy,
  onToggle,
}: {
  watched: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={watched ? "default" : "outline"}
      className="h-8 w-8 p-0"
      onClick={onToggle}
      disabled={busy}
      title={watched ? "Vigiando — clique para remover" : "Vigiar este lote"}
      aria-label={watched ? "Deixar de vigiar" : "Vigiar"}
      aria-pressed={watched}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : watched ? (
        <EyeOff className="h-4 w-4" />
      ) : (
        <Eye className="h-4 w-4" />
      )}
    </Button>
  );
}

/** Chip de filtro (liga/desliga) no mesmo formato dos botões da parte principal do site. */
function filterChipClass(active: boolean): string {
  return active
    ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
    : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50";
}

/** Seção recolhível de um Top (cabeçalho clicável + conteúdo). */
function TopSection({
  title,
  open,
  onToggle,
  filtered,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  filtered: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
      >
        {open ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <Star className="h-5 w-5 text-primary" />
        {title}
        {filtered ? (
          <Badge variant="secondary" className="ml-1 font-normal">
            filtrado
          </Badge>
        ) : null}
      </button>
      {open ? children : null}
    </section>
  );
}

function AnalisePage() {
  // Esconder/mostrar o topo é MANUAL — botão `MobileTopToggle`, só no mobile — desde que a
  // versão anterior por scroll (`useHideOnScroll`) ficava piscando.
  const [barsHidden, setBarsHidden] = usePersistedState("analise-bars-hidden", false);
  usePersistedScroll("analise", true);

  const queryClient = useQueryClient();
  const saveInterests = useServerFn(setUserInterests);
  const importWant = useServerFn(importWantlist);
  const addWant = useServerFn(addWantlistItem);
  const updateWant = useServerFn(updateWantlistItem);
  const deleteWant = useServerFn(deleteWantlistItem);
  const runToggle = useServerFn(toggleWatch);
  const saveTags = useServerFn(setLotTags);

  // Filtros (valem para os dois Tops). O dia vem da barra de dias ("" = todos).
  const [search, setSearch] = usePersistedState("analise-search", "");
  const [houseFilter, setHouseFilter] = usePersistedState("analise-house", "");
  const [dayFilter, setDayFilter] = usePersistedState("analise-day", "");
  const [scoreMin, setScoreMin] = usePersistedState("analise-score-min", "");
  const [scoreMax, setScoreMax] = usePersistedState("analise-score-max", "");
  const [rarityFilter, setRarityFilter] = usePersistedState("analise-rarity", "");
  const [onlyWant, setOnlyWant] = usePersistedState("analise-only-want", false);
  const [onlyBid, setOnlyBid] = usePersistedState("analise-only-bid", false);
  const [watchedOpen, setWatchedOpen] = usePersistedState("analise-top-open", true);
  const [restOpen, setRestOpen] = usePersistedState("analise-rest-open", true);
  const [pending, setPending] = useState<string | null>(null);

  const lots = useLotsQuery();
  const lotAiQuery = useLotAiQuery();
  const lotIdentQuery = useLotIdentQuery();
  const interestsQuery = useInterestsQuery();
  const lotMarketQuery = useLotMarketQuery();
  const wantlistQuery = useWantlistQuery();
  // Vigiados + meus lances: alimentam a divisão em dois Tops, o filtro "Com lance", a borda
  // colorida das linhas, o status do lance e o botão de vigiar (mesma mecânica da página
  // principal). MESMO acumulador local de `index.tsx` (`@/lib/watched-accum`, MESMA chave de
  // `localStorage` e de query, `queryKeys.watched`/`queryKeys.bids`) — essas duas rotas
  // compartilham o `QueryClient` do app inteiro, então um `queryFn` aqui que apenas
  // SUBSTITUÍSSE (sem mesclar) sobrescreveria o acumulado da outra rota ao navegar entre elas,
  // fazendo os vigiados "sumirem depois de um tempo" mesmo sem o usuário ter desvigiado nada.
  const { query: watchedQuery, accumRef: watchedAccumRef } = useWatchedQuery();
  const { query: bidsQuery } = useBidsQuery();

  const saveInterestsMut = useMutation({
    mutationFn: (items: string[]) => saveInterests({ data: { items } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.interests });
      toast.success("Interesses salvos");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar"),
  });

  const invalidateWant = () => queryClient.invalidateQueries({ queryKey: queryKeys.wantlist });
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

  // Vigiar/desvigiar direto na tabela — sincroniza com o LeilõesBR (igual aos cards).
  const toggle = useMutation({
    mutationFn: (lot: { idPeca: string; idLeilao: string; base: string; watch: boolean }) =>
      runToggle({ data: lot }),
    onMutate: (lot) => setPending(lot.idPeca),
    onSuccess: (result: { watched: boolean }, lot) => {
      // Desvigiar é a ÚNICA saída explícita do acumulador (mesma lógica de `index.tsx`) —
      // remove na hora, sem esperar o refetch, senão o card ficaria vigiado na tela mesmo
      // depois do usuário desvigiar.
      if (!result.watched) {
        watchedAccumRef.current!.delete(`${lot.idLeilao}-${lot.idPeca}`);
        saveAccum(WATCHED_ACCUM_STORAGE_KEY, watchedAccumRef.current!);
        queryClient.setQueryData(queryKeys.watched, [...watchedAccumRef.current!.values()]);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.watched });
      toast.success(result.watched ? "Lote vigiado no LeilõesBR" : "Vigia removida no LeilõesBR");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível sincronizar a vigia"),
    onSettled: () => setPending(null),
  });

  // Edição manual de tags: atualiza o cache queryKeys.lotAi de forma otimista e persiste.
  const patchTags = (id: string, tags: string[]) =>
    queryClient.setQueryData(queryKeys.lotAi, (old: unknown) =>
      Array.isArray(old)
        ? old.map((r) => (r && (r as { id: string }).id === id ? { ...r, tags } : r))
        : old,
    );
  const saveTagsMut = useMutation({
    mutationFn: (v: { id: string; tags: string[] }) => saveTags({ data: v }),
    onMutate: (v: { id: string; tags: string[] }) => patchTags(v.id, v.tags),
    onSuccess: (res: { id: string; tags: string[] }) => {
      patchTags(res.id, res.tags);
      toast.success("Tags atualizadas");
    },
    onError: (e: Error) => {
      toast.error(e.message || "Não foi possível salvar as tags");
      void queryClient.invalidateQueries({ queryKey: queryKeys.lotAi });
    },
  });

  const watchedIds = useMemo(
    () => new Set((watchedQuery.data ?? []).map((w) => w.idPeca)),
    [watchedQuery.data],
  );
  // Status do meu lance por peça (verde = ganhando, vermelho = coberto).
  const bidStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bidsQuery.data ?? []) map.set(b.idPeca, b.status);
    return map;
  }, [bidsQuery.data]);
  // Meu lance por peça: corrige o "Atual" quando estou vencendo (a listagem pública traz o
  // valor defasado — quem vence detém o maior lance).
  const myBidById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bidsQuery.data ?? []) if (b.myBid) map.set(b.idPeca, b.myBid);
    return map;
  }, [bidsQuery.data]);

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
        tracklist: r.tracklist,
      });
    return map;
  }, [lotAiQuery.data]);
  // Mapa id→álbum com identidade ESTÁVEL enquanto os álbuns não mudam (assinatura id:album).
  // O casamento com a sondagem (`wantByLot`) usa só o álbum; sem isto, editar uma tag muda
  // `lotAiQuery.data` e forçava o recálculo pesado do casamento (jank de ~1s na edição).
  const aiAlbumSig = useMemo(
    () => (lotAiQuery.data ?? []).map((r) => `${r.id}:${r.album ?? ""}`).join("|"),
    [lotAiQuery.data],
  );
  const identAlbumSig = useMemo(
    () => (lotIdentQuery.data ?? []).map((r) => `${r.id}:${r.album ?? ""}`).join("|"),
    [lotIdentQuery.data],
  );
  // Álbum RESOLVIDO por lote: prefere a avaliação completa (`lot_ai`); senão a
  // identificação simplificada (`lot_ident`). Identidade estável pelas assinaturas
  // acima (evita recomputar o casamento pesado da sondagem ao editar uma tag).
  const albumById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of lotIdentQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    for (const r of lotAiQuery.data ?? []) if (r.album) map.set(r.id, r.album);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAlbumSig, identAlbumSig]);
  const albumFor = (lot: VinylLot): string | null => albumById.get(lot.id) ?? null;
  // Aviso (toast) quando um lote com lance vira "Coberto" — só com o app aberto, ver
  // `@/lib/bid-alerts`.
  useBidCoveredAlerts(bidsQuery.data, (id) => albumById.get(id) ?? null);
  const matchesInterest = useMemo(
    () => buildInterestMatcher(interestsQuery.data ?? []),
    [interestsQuery.data],
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

  // Estado por lote (vigia/lance) e o valor "Atual" corrigido para quem está vencendo.
  const isWatched = (lot: VinylLot) => watchedIds.has(lot.idPeca);
  const bidStatusFor = (lot: VinylLot) => bidStatusById.get(lot.idPeca) ?? null;
  const currentPriceFor = (lot: VinylLot) => {
    const status = bidStatusFor(lot);
    const myBid = myBidById.get(lot.idPeca);
    return status && bidIsWinning(status) && myBid ? myBid : lot.price;
  };
  const onToggleWatch = (lot: VinylLot) =>
    toggle.mutate({
      idPeca: lot.idPeca,
      idLeilao: lot.idLeilao,
      base: lot.base,
      watch: !isWatched(lot),
    });

  const days = useMemo(() => lots.data?.days ?? [], [lots.data]);
  // Dia salvo que saiu da janela vira "Todos" (senão a lista ficaria vazia sem aba ativa).
  const activeDay = days.includes(dayFilter) ? dayFilter : "";
  const allLots = useMemo(() => lots.data?.lots ?? [], [lots.data]);

  const houses = useMemo(
    () =>
      [...new Set(allLots.map((l) => l.house).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [allLots],
  );

  // Casamento probabilístico com a sondagem: obras ainda NÃO adquiridas (as adquiridas saem
  // do radar). Cada lote é confrontado com todas as obras usando artista + disco + ano; só
  // conta como casamento quando a melhor obra passa de 80% (bestWantForLot).
  const wantCands = useMemo<WantCandidate[]>(
    () => (wantlistQuery.data ?? []).filter((w) => !w.acquired).map(wantCandidate),
    [wantlistQuery.data],
  );
  const wantByLot = useMemo(() => {
    const map = new Map<string, WantHit>();
    if (!wantCands.length) return map;
    for (const lot of allLots) {
      const market = marketById.get(lot.id);
      const identity = lotIdentity({
        title: lot.title,
        artist: lot.artist,
        album: albumById.get(lot.id) ?? null,
        marketTitle: market?.releaseTitle ?? null,
        marketYear: market?.year ?? null,
      });
      const best = bestWantForLot(wantCands, identity);
      if (best) map.set(lot.id, { work: best.cand.work, year: best.cand.year, score: best.score });
    }
    return map;
  }, [wantCands, allLots, albumById, marketById]);
  const wantedLot = (lot: VinylLot): WantHit | null => wantByLot.get(lot.id) ?? null;

  // Aplica os filtros (busca/casa/nota/sondagem) SEM o dia — a barra de dias mostra a
  // contagem de cada dia sobre este conjunto.
  const filteredAnyDay = useMemo(() => {
    const q = normalizeForMatch(search);
    const min = scoreMin.trim() ? Number(scoreMin) : null;
    const max = scoreMax.trim() ? Number(scoreMax) : null;
    const scoreActive = min !== null || max !== null;
    return allLots.filter((l) => {
      if (q && !normalizeForMatch(`${l.title} ${albumById.get(l.id) ?? ""}`).includes(q))
        return false;
      if (houseFilter && l.house !== houseFilter) return false;
      if (onlyWant && !wantByLot.has(l.id)) return false;
      if (onlyBid && !bidStatusById.has(l.idPeca)) return false;
      if (rarityFilter && (aiById.get(l.id)?.rarity ?? null) !== rarityFilter) return false;
      if (scoreActive) {
        const s = aiById.get(l.id)?.score ?? null;
        if (s === null) return false;
        if (min !== null && s < min) return false;
        if (max !== null && s > max) return false;
      }
      return true;
    });
  }, [
    allLots,
    search,
    houseFilter,
    onlyWant,
    onlyBid,
    rarityFilter,
    scoreMin,
    scoreMax,
    aiById,
    albumById,
    wantByLot,
    bidStatusById,
  ]);
  const filtered = useMemo(
    () => (activeDay ? filteredAnyDay.filter((l) => l.dayKey === activeDay) : filteredAnyDay),
    [filteredAnyDay, activeDay],
  );

  // Dois Tops: vigiados × demais lotes. Só lotes já avaliados, maior nota primeiro.
  const { topWatched, topRest } = useMemo(() => {
    const ranked = filtered
      .filter((l) => (aiById.get(l.id)?.score ?? null) !== null)
      .sort((a, b) => (aiById.get(b.id)?.score ?? -1) - (aiById.get(a.id)?.score ?? -1));
    return {
      topWatched: ranked.filter((l) => watchedIds.has(l.idPeca)).slice(0, TOP_N),
      topRest: ranked.filter((l) => !watchedIds.has(l.idPeca)).slice(0, TOP_N),
    };
  }, [filtered, aiById, watchedIds]);

  const evaluated = aiById.size;
  const wantCount = (wantlistQuery.data ?? []).filter((w) => !w.acquired).length;
  const wantMatchCount = useMemo(
    () => (wantCount ? filtered.filter((l) => wantByLot.has(l.id)).length : 0),
    [filtered, wantByLot, wantCount],
  );
  const filtersActive = Boolean(
    search ||
    houseFilter ||
    activeDay ||
    scoreMin ||
    scoreMax ||
    rarityFilter ||
    onlyWant ||
    onlyBid,
  );
  const resetFilters = () => {
    setSearch("");
    setHouseFilter("");
    setDayFilter("");
    setScoreMin("");
    setScoreMax("");
    setRarityFilter("");
    setOnlyWant(false);
    setOnlyBid(false);
  };
  const bidCount = bidStatusById.size;

  // Barra de dias no formato da home: passados em âmbar, futuros em azul, hoje neutro.
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  const relDay = (d: string) =>
    Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of filteredAnyDay) counts.set(l.dayKey, (counts.get(l.dayKey) ?? 0) + 1);
    return counts;
  }, [filteredAnyDay]);

  /** Tabela de um Top: nota, título, casa/dia, valor atual, repassar IA e vigiar. */
  const renderTop = (list: VinylLot[], emptyMsg: string) =>
    list.length === 0 ? (
      <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        {emptyMsg}
      </p>
    ) : (
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-secondary text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Nota</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Casa / dia</th>
              <th className="px-3 py-2 text-right font-medium">Atual</th>
              <th className="px-3 py-2 text-right font-medium">IA</th>
              <th className="px-3 py-2 text-right font-medium">Vigiar</th>
            </tr>
          </thead>
          <tbody>
            {list.map((lot, i) => {
              const ai = aiFor(lot)!;
              const status = bidStatusFor(lot);
              const watched = isWatched(lot);
              return (
                <tr
                  key={lot.id}
                  className={`border-t border-border/60 align-top ${rowStatusTone(status, watched)}`}
                >
                  <td className="px-3 py-2">
                    <ScoreBadge
                      ai={ai}
                      market={marketFor(lot)}
                      price={lot.price}
                      rank={i + 1}
                      lot={{
                        id: lot.id,
                        title: lot.title,
                        price: lot.price,
                        house: lot.house,
                        image: lot.image,
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <LotTitle
                      lot={lot}
                      want={wantedLot(lot)}
                      album={albumFor(lot)}
                      marketYear={marketFor(lot)?.year ?? null}
                    />
                    <LotSummary
                      ai={ai}
                      market={marketFor(lot)}
                      price={lot.price}
                      onEditTags={(tags) => saveTagsMut.mutate({ id: lot.id, tags })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {lot.house}
                    <br />
                    {formatDayLabel(lot.dayKey, days)} · {lot.time}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="font-semibold text-primary">
                      {currentPriceFor(lot) || "sem valor"}
                    </span>
                    {status ? (
                      <div
                        className={`mt-0.5 text-[11px] font-medium ${
                          bidIsWinning(status)
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {status}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ReevaluateIconButton
                      lot={{
                        id: lot.id,
                        title: lot.title,
                        price: currentPriceFor(lot),
                        house: lot.house,
                        image: lot.image,
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <WatchButton
                      watched={watched}
                      busy={pending === lot.idPeca}
                      onToggle={() => onToggleWatch(lot)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <HideableBar hidden={barsHidden} className="top-0 z-30">
        <header className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild className="max-sm:hidden">
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
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Top {TOP_N} dos vigiados e Top {TOP_N} do restante, ranqueados por nota da IA
                (raridade + oportunidade). ⭐ = combina com seus interesses; 🎯 = casa com a
                sondagem.{" "}
                {evaluated ? `${evaluated} lote(s) avaliado(s).` : "Ainda sem avaliações."}
              </p>
            </div>
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
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
      </HideableBar>

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
            volte após a próxima rodada — ou use os botões “Analisar” por dia/casa na página
            principal para avaliar agora, sob demanda.
          </p>
        ) : (
          <div className="space-y-6">
            {/* ------- Filtros (barra de pesquisa) ------- */}
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
                    Raridade
                  </label>
                  <select
                    value={rarityFilter}
                    onChange={(e) => setRarityFilter(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Todas</option>
                    {RARITY_LEGEND.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
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
                {/* Filtros liga/desliga no mesmo formato dos botões da página principal. */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOnlyBid((v) => !v)}
                    disabled={bidCount === 0}
                    aria-pressed={onlyBid}
                    className={filterChipClass(onlyBid)}
                  >
                    <Gavel className="h-3.5 w-3.5" />
                    Com lance
                    {bidCount ? (
                      <span className="ml-0.5 text-muted-foreground">{bidCount}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyWant((v) => !v)}
                    disabled={wantCount === 0}
                    aria-pressed={onlyWant}
                    className={filterChipClass(onlyWant)}
                  >
                    <Target className="h-3.5 w-3.5" />
                    Só sondagem
                    {wantCount ? (
                      <span className="ml-0.5 text-muted-foreground">{wantCount}</span>
                    ) : null}
                  </button>
                </div>
                {filtersActive ? (
                  <Button variant="ghost" size="sm" onClick={resetFilters}>
                    <X className="mr-1 h-4 w-4" />
                    Limpar
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {filtered.length} lote(s) no filtro.
                  {wantCount
                    ? ` ${wantMatchCount} casam com a sondagem (${wantCount} obra(s) na lista).`
                    : ""}
                </p>
                <RarityLegend />
              </div>
            </section>

            {/* ------- Barra de dias (mesmo formato da página principal) ------- */}
            <Tabs
              value={activeDay || "all"}
              onValueChange={(v) => setDayFilter(v === "all" ? "" : v)}
            >
              <TabsList className="flex h-auto flex-nowrap justify-start gap-1 overflow-x-auto bg-secondary sm:flex-wrap sm:overflow-visible">
                <TabsTrigger value="all" className="shrink-0">
                  Todos
                  <span className="ml-2 text-xs text-muted-foreground">
                    {filteredAnyDay.length}
                  </span>
                </TabsTrigger>
                {days.map((day) => {
                  const rel = relDay(day);
                  return (
                    <TabsTrigger
                      key={day}
                      value={day}
                      className={
                        rel < 0
                          ? "shrink-0 bg-amber-500/10 text-amber-700 data-[state=active]:bg-amber-500/25 data-[state=active]:text-amber-800 dark:text-amber-300 dark:data-[state=active]:text-amber-200"
                          : rel > 0
                            ? "shrink-0 bg-sky-500/10 text-sky-700 data-[state=active]:bg-sky-500/25 data-[state=active]:text-sky-800 dark:text-sky-300 dark:data-[state=active]:text-sky-200"
                            : "shrink-0"
                      }
                    >
                      {dayLabel(day, rel)}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dayCounts.get(day) ?? 0}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            {/* ------- Top 30 — vigiados ------- */}
            <TopSection
              title={`Top ${Math.min(TOP_N, topWatched.length)} — vigiados`}
              open={watchedOpen}
              onToggle={() => setWatchedOpen((v) => !v)}
              filtered={filtersActive}
            >
              {renderTop(topWatched, "Nenhum vigiado avaliado no filtro atual.")}
            </TopSection>

            {/* ------- Top 30 — restante ------- */}
            <TopSection
              title={`Top ${Math.min(TOP_N, topRest.length)} — restante`}
              open={restOpen}
              onToggle={() => setRestOpen((v) => !v)}
              filtered={filtersActive}
            >
              {renderTop(topRest, "Nenhum lote avaliado no filtro atual.")}
            </TopSection>
          </div>
        )}
      </div>
    </main>
  );
}

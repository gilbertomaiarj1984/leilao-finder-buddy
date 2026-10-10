import { useMemo, useRef, useState } from "react";
import { ListMusic, Loader2, RefreshCw } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useLotTracklistRefresh,
  type TracklistRefresh,
} from "@/components/vinyl/tracklist-refresh";
import { useLotAiQuery } from "@/lib/queries";
import { useIsMobile } from "@/lib/use-is-mobile";
import { groupTracksBySide, type Track, type TrackFame } from "@/lib/tracklist";

const FAME_DOT: Record<TrackFame, string> = {
  alta: "bg-green-500",
  media: "bg-yellow-400",
  baixa: "bg-red-500",
};
// Faixa ainda sem fama (a IA não classificou): bolinha neutra.
const UNRATED_DOT = "bg-muted-foreground/30";

const FAME_LABEL: Record<TrackFame, string> = {
  alta: "Maiores sucessos",
  media: "Conhecidas",
  baixa: "Pouco conhecidas / lado B",
};

/**
 * Ícone de TRACKLIST do álbum (faixas do Discogs + fama da IA, `lot_ai.tracklist`). Ao parar o mouse em cima
 * abre a lista por lado, com bolinha verde (mais famosas), amarela (menos) ou vermelha
 * (desconhecidas e/ou lado B). Toque/clique também abre (mobile). Sem tracklist, o ícone
 * fica apagado e explica que ela vem com a análise da IA.
 */
export function TracklistHover({
  tracklist,
  title,
  onRequest,
  loading = false,
  lotId,
  refresh: refreshProp,
}: {
  tracklist?: Track[] | null;
  title?: string;
  /** Lote cuja tracklist pode ser atualizada manualmente (botão "atualizar" na lista). */
  lotId?: string | null;
  /** Refresh customizado (ex.: item da Coleção); tem prioridade sobre `lotId`. */
  refresh?: TracklistRefresh;
  /** Sem tracklist, torna o botão clicável: pede a tracklist (só ela) e deixa o chamador gravar. */
  onRequest?: () => void;
  loading?: boolean;
}) {
  const isMobile = useIsMobile();
  const lotRefresh = useLotTracklistRefresh(refreshProp ? null : lotId);
  const refresh = refreshProp ?? lotRefresh;
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const has = Boolean(tracklist?.length);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (has) setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  // Sem tracklist, o clique busca: `onRequest` (Coleção) ou, num lote, o refresh (faixas do
  // Discogs + fama pela IA).
  const request = onRequest ?? refresh?.onClick;
  const canRequest = !has && Boolean(request);
  const busy = loading || Boolean(refresh?.pending);
  const tip = has
    ? "Tracklist do álbum (verde = mais famosas, vermelho = pouco conhecidas/lado B)"
    : canRequest
      ? busy
        ? "Buscando a tracklist…"
        : "Tracklist ainda não existe — clique para buscar (faixas do Discogs + fama pela IA)"
      : "Tracklist ainda não disponível — vem com a análise da IA";

  return (
    <Popover open={open} onOpenChange={(o) => setOpen(o && has)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={show}
          onMouseLeave={hide}
          onClick={canRequest ? request : undefined}
          disabled={canRequest && busy}
          className={`flex items-center rounded-full px-1.5 py-1 text-white shadow ${
            has ? "bg-sky-600" : canRequest ? "bg-zinc-500 hover:bg-sky-600" : "bg-zinc-500/50"
          }`}
          title={open ? undefined : tip}
          aria-label={tip}
        >
          <ListMusic className={`h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`} />
        </button>
      </PopoverTrigger>
      {has ? (
        <PopoverContent
          // Celular: ao lado esquerdo não cabe (vazava da tela); embaixo o Radix desloca p/ dentro.
          side={isMobile ? "bottom" : "left"}
          align={isMobile ? "end" : "start"}
          collisionPadding={12}
          className="max-h-[min(70vh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3 text-xs"
          onMouseEnter={show}
          onMouseLeave={hide}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <TracklistContent tracklist={tracklist ?? []} title={title} refresh={refresh} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

/** Corpo da tracklist (lados + bolinhas de fama + legenda): popover do desktop e cartão aberto do celular. */
export function TracklistContent({
  tracklist,
  title,
  refresh,
}: {
  tracklist: Track[];
  title?: string;
  /** Botão "atualizar": re-puxa as faixas do Discogs e depois força a fama pela IA. */
  refresh?: TracklistRefresh;
}) {
  return (
    <>
      {title || refresh ? (
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          {refresh ? (
            <button
              type="button"
              onClick={refresh.onClick}
              disabled={refresh.pending}
              title="Atualizar: puxa as faixas do Discogs de novo e depois a fama pela IA"
              aria-label="Atualizar faixas e fama"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {refresh.pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              atualizar
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        {groupTracksBySide(tracklist).map((g, gi) => (
          <div key={`${g.side ?? "-"}-${gi}`}>
            {g.side ? (
              <p className="mb-1 font-semibold text-muted-foreground">Lado {g.side}</p>
            ) : null}
            <ul className="space-y-1">
              {g.tracks.map((t, i) => (
                <li
                  key={`${t.title}-${i}`}
                  className={`flex items-start gap-2 ${t.sub ? "ml-4 text-muted-foreground" : ""}`}
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${t.fame ? FAME_DOT[t.fame] : UNRATED_DOT}`}
                    title={t.fame ? FAME_LABEL[t.fame] : "Fama ainda não avaliada pela IA"}
                  />
                  <span className="leading-snug">
                    {t.sub ? "↳ " : ""}
                    {t.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
        {(Object.keys(FAME_DOT) as TrackFame[]).map((f) => (
          <span key={f} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${FAME_DOT[f]}`} />
            {FAME_LABEL[f]}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * Tracklist de um item que veio de um LOTE (Compras/Coleção): reaproveita a tracklist já
 * gravada na avaliação da IA do lote (`lot_ai.tracklist`), achada pelo `lotId`. Sem lote ou sem
 * avaliação (ex.: lote já podado do banco), o ícone fica apagado.
 */
export function LotTracklistHover({
  lotId,
  title,
  own,
  onRequest,
  loading,
  refresh,
}: {
  lotId?: string | null;
  title?: string;
  /** Refresh da tracklist própria (Coleção); sem ela, atualiza a do lote (`lot_ai`). */
  refresh?: TracklistRefresh;
  /** Tracklist própria do item (ex.: buscada na Coleção); tem prioridade sobre a do lote. */
  own?: Track[] | null;
  onRequest?: () => void;
  loading?: boolean;
}) {
  const aiQuery = useLotAiQuery();
  const fromLot = useMemo(
    () => (lotId ? (aiQuery.data?.find((r) => r.id === lotId)?.tracklist ?? null) : null),
    [aiQuery.data, lotId],
  );
  return (
    <TracklistHover
      tracklist={own?.length ? own : fromLot}
      title={title}
      lotId={own?.length ? null : lotId}
      refresh={refresh}
      onRequest={onRequest}
      loading={loading}
    />
  );
}

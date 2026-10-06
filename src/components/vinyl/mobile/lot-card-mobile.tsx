import { ArrowRightLeft, Binoculars, Disc3, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatAiAlbum } from "@/components/vinyl/ai-score-utils";
import { LOOKOUT_CONFIDENT_MIN } from "@/lib/lookout-match";
import { decodeHtmlEntities } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN } from "@/lib/wantlist-match";
import { cn } from "@/lib/utils";
import { scoreTone } from "@/components/vinyl/ai-score-utils";

import type { LotCardProps } from "../lot-card";
import { LotDetailSheet } from "./lot-detail-sheet";
import { lotCardState, TONE_BORDER } from "./lot-card-state";

/**
 * Cartão compacto do lote no celular (substitui `LotCard` abaixo de `sm`): miniatura, nº do
 * lote, álbum da IA + título, valores, selos de estado e a nota; o botão do olho vigia/desvigia
 * sem abrir. Tocar abre o cartão completo (`LotDetailSheet`) com tudo que o desktop mostra em
 * hover/popover. Mesmas props do `LotCard` do desktop.
 */
export function LotCardMobile(props: LotCardProps) {
  const { lot, busy, onToggle, showDate, bidStatus, sold, ai, market, album, condition, owned } =
    props;
  const { possibleTrash, lookout, origin, dateBar } = props;
  const [open, setOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setImgFailed(true);
  }, [lot.image]);

  const title = decodeHtmlEntities(lot.title);
  const aiLabel = album ? formatAiAlbum(decodeHtmlEntities(album), market?.year) : "";
  const lookoutActive = Boolean(lookout && (lookout.on || lookout.hit));
  const st = lotCardState({
    watched: lot.watched,
    bidStatus,
    myBid: lot.myBid,
    price: lot.price,
    dayKey: lot.dayKey,
    time: lot.time,
    sold,
    lookoutActive,
  });
  const ownedConfident = owned != null && owned.score >= OWNED_CONFIDENT_MIN;
  const hit = lookout?.hit ?? null;
  const hitSure = hit ? hit.confirmed || hit.score >= LOOKOUT_CONFIDENT_MIN : false;
  const barTone = st.hasBid
    ? st.winning
      ? "bg-green-500 text-white"
      : "bg-red-500 text-white"
    : "bg-yellow-400 text-yellow-950";

  return (
    <>
      {dateBar && !origin ? (
        <div
          className={cn(
            "px-3 py-1 text-center text-xs font-bold tracking-wide",
            st.hasBid
              ? st.winning
                ? "bg-green-500 text-white"
                : "bg-red-500 text-white"
              : lot.watched
                ? "bg-yellow-400 text-yellow-950"
                : "bg-secondary text-foreground",
          )}
        >
          {dateBar}
        </div>
      ) : null}
      {origin ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px] font-medium",
            barTone,
          )}
        >
          <span className="font-bold">{origin.house}</span>
          {origin.houseWinning || origin.houseCovered ? (
            <span className="inline-flex gap-0.5 rounded bg-white/90 px-1 leading-4">
              {origin.houseWinning ? <span className="text-green-600">★</span> : null}
              {origin.houseCovered ? <span className="text-red-600">★</span> : null}
            </span>
          ) : null}
          <span>Pregão {origin.idLeilao}</span>
          {origin.days ? <span>{origin.days}</span> : null}
          {origin.multiDay ? (
            <span className="rounded bg-black/15 px-1.5 text-[10px] font-bold uppercase">
              multi-dia
            </span>
          ) : null}
          {origin.onMove ? (
            <button
              type="button"
              onClick={origin.onMove}
              aria-label="Mover este lote para outro artista"
              className="ml-auto grid h-8 w-8 place-items-center rounded bg-black/15"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <article
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "relative flex cursor-pointer gap-2.5 overflow-hidden border border-l-4 border-border bg-card p-2.5 pl-2",
          origin || dateBar ? "rounded-b-md" : "rounded-md",
          TONE_BORDER[st.tone],
        )}
      >
        {st.soldLabel ? (
          <div className="pointer-events-none absolute top-3 -right-8 z-10 w-32 rotate-[32deg] bg-red-600 py-0.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-white shadow">
            Vendido{st.soldLabel !== "Vendido" ? ` ${st.soldLabel}` : ""}
          </div>
        ) : null}
        <div className="relative h-16 w-16 shrink-0">
          <div className="h-16 w-16 overflow-hidden rounded-md bg-secondary">
            {lot.image && !imgFailed ? (
              <img
                ref={imgRef}
                src={lot.image}
                alt=""
                loading="lazy"
                className="h-full w-full object-contain"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div className="grid h-full place-items-center text-[9px] text-muted-foreground">
                sem imagem
              </div>
            )}
          </div>
          {lot.lote ? (
            <span className="absolute -top-1 -left-1 max-w-[4.5rem] truncate rounded-full bg-foreground px-1.5 text-[10px] font-extrabold leading-4 text-background">
              Lote {lot.lote}
            </span>
          ) : null}
          <span
            className={cn(
              "absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full border-2 border-card text-white",
              owned ? "bg-purple-600" : "bg-zinc-500/80",
            )}
            aria-hidden
          >
            <Disc3 className="h-3 w-3" />
            {owned && !ownedConfident ? (
              <span className="absolute -top-1.5 -right-1 rounded bg-white px-0.5 text-[9px] font-extrabold leading-3 text-purple-700">
                ?
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {aiLabel ? (
            <>
              <p className="text-sm leading-snug font-bold break-words text-foreground">
                {aiLabel}
              </p>
              <p className="line-clamp-2 text-xs leading-snug break-words text-muted-foreground">
                {title}
              </p>
            </>
          ) : (
            <p className="line-clamp-3 text-sm leading-snug font-semibold break-words text-foreground">
              {title}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-bold text-primary tabular-nums">
              Atual {st.currentPrice || "sem valor"}
            </span>
            {lot.nextBid ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                Próximo {lot.nextBid}
              </span>
            ) : null}
            {lot.myBid ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                Meu lance {lot.myBid}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            {st.hasBid ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-semibold",
                  st.winning
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : "bg-red-500/15 text-red-700 dark:text-red-400",
                )}
              >
                {bidStatus}
              </span>
            ) : null}
            {hit ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-fuchsia-500/15 px-1.5 py-0.5 font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                <Binoculars className="h-3 w-3" aria-hidden />
                De olho{hitSure ? "" : "?"} · {Math.round(hit.score * 100)}%
              </span>
            ) : lookout?.on ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-fuchsia-500/15 px-1.5 py-0.5 font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                <Binoculars className="h-3 w-3" aria-hidden />
                De olho
              </span>
            ) : null}
            {possibleTrash ? (
              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 font-semibold text-orange-700 dark:text-orange-400">
                ⚠ possível lixo
              </span>
            ) : null}
            {condition?.media ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                Disco {condition.media}
              </span>
            ) : null}
            {condition?.sleeve ? (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                Capa {condition.sleeve}
              </span>
            ) : null}
            <span className="px-0.5 text-muted-foreground">
              {[showDate ? lot.dayKey : "", lot.time, lot.uf].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {ai && ai.score !== null ? (
            <span
              className={cn(
                "inline-flex h-7 min-w-9 items-center justify-center rounded-lg px-1.5 text-sm font-extrabold tabular-nums shadow",
                scoreTone(ai.score),
              )}
            >
              {ai.score}
            </span>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            disabled={busy}
            aria-pressed={lot.watched}
            aria-label={lot.watched ? "Parar de vigiar" : "Vigiar"}
            className={cn(
              "grid h-10 w-10 place-items-center rounded-xl border",
              lot.watched
                ? "border-yellow-500 bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : lot.watched ? (
              <Eye className="h-5 w-5" />
            ) : (
              <EyeOff className="h-5 w-5" />
            )}
          </button>
        </div>
      </article>
      {open ? (
        <LotDetailSheet {...props} open={open} onOpenChange={setOpen} soldLabel={st.soldLabel} />
      ) : null}
    </>
  );
}

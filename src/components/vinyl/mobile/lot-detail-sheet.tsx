import {
  ArrowLeft,
  ArrowRightLeft,
  Binoculars,
  Check,
  Disc3,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { ScoreDetails } from "@/components/vinyl/ai-score";
import { formatAiAlbum, scoreTone } from "@/components/vinyl/ai-score-utils";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import { TracklistContent } from "@/components/vinyl/tracklist-hover";
import { LOOKOUT_CONFIDENT_MIN, priceVsCeiling } from "@/lib/lookout-match";
import { decodeHtmlEntities, lotOpenUrl, parsePrice } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN } from "@/lib/wantlist-match";
import { cn } from "@/lib/utils";

import type { LotCardProps } from "../lot-card";
import { BottomSheet } from "./bottom-sheet";
import { lotCardState } from "./lot-card-state";

type TabId = "resumo" | "nota" | "faixas" | "colecao";

function Box({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      {title ? (
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

/** Tags editáveis com controles sempre visíveis (no desktop o × e o "+ tag" só aparecem no hover). */
function MobileTags({ tags, onEdit }: { tags: string[]; onEdit?: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const commit = () => {
    const v = value.replace(/\s+/g, " ").trim();
    if (onEdit && v && !tags.some((t) => t.toLowerCase() === v.toLowerCase())) onEdit([...tags, v]);
    setValue("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex min-h-8 items-center gap-1 rounded-full bg-secondary pl-3 text-xs font-medium"
        >
          {t}
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(tags.filter((x) => x !== t))}
              aria-label={`Remover tag ${t}`}
              className="grid h-8 w-8 place-items-center text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="pr-3" />
          )}
        </span>
      ))}
      {onEdit ? (
        adding ? (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                setValue("");
                setAdding(false);
              }
            }}
            onBlur={commit}
            placeholder="nova tag"
            className="h-8 w-28 rounded-full border border-input bg-background px-3 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-xs text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> tag
          </button>
        )
      ) : null}
      {!tags.length && !onEdit ? (
        <span className="text-xs text-muted-foreground">Sem tags.</span>
      ) : null}
    </div>
  );
}

/**
 * Cartão aberto do lote no celular: tela cheia com 4 abas (Resumo, Nota IA, Faixas, Coleção) e
 * rodapé fixo de ações. É a versão de toque do que o desktop mostra em hover/popover — usa os
 * mesmos componentes (`ScoreDetails` com o bloco de mercado do Discogs, `TracklistContent`,
 * `ConditionBadges`) e as mesmas ações do `LotCard`.
 */
export function LotDetailSheet(
  props: LotCardProps & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    soldLabel?: string;
  },
) {
  const {
    open,
    onOpenChange,
    soldLabel,
    lot,
    busy,
    onToggle,
    bidStatus,
    ai,
    market,
    album,
    condition,
    demand,
    owned,
    onOpenOwned,
    onEditTags,
    possibleTrash,
    onExclude,
    onDismissTrash,
    lookout,
    onToggleLookout,
    onResolveLookout,
    origin,
  } = props;
  const [tab, setTab] = useState<TabId>("resumo");
  const title = decodeHtmlEntities(lot.title);
  const aiLabel = album ? formatAiAlbum(decodeHtmlEntities(album), market?.year) : "";
  const st = lotCardState({
    watched: lot.watched,
    bidStatus,
    myBid: lot.myBid,
    price: lot.price,
    dayKey: lot.dayKey,
    time: lot.time,
    sold: props.sold,
    lookoutActive: Boolean(lookout && (lookout.on || lookout.hit)),
  });
  const tracks = ai?.tracklist ?? null;
  const hit = lookout?.hit ?? null;
  const hitSure = hit ? hit.confirmed || hit.score >= LOOKOUT_CONFIDENT_MIN : false;
  const vs = hit
    ? priceVsCeiling(parsePrice(st.currentPrice ?? ""), lookout?.maxPrice ?? null)
    : null;
  const ownedConfident = owned != null && owned.score >= OWNED_CONFIDENT_MIN;
  const close = () => onOpenChange(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const tabs: { id: TabId; label: string; off?: boolean }[] = [
    { id: "resumo", label: "Resumo" },
    { id: "nota", label: "Nota IA", off: !ai },
    { id: "faixas", label: "Faixas", off: !tracks?.length },
    { id: "colecao", label: "Coleção" },
  ];

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Lote ${lot.lote ?? ""} — ${lot.house}`}
      full
    >
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-bold">
            {lot.lote ? `Lote ${lot.lote} · ` : ""}
            {lot.house}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[lot.dayKey, lot.time, lot.uf].filter(Boolean).join(" · ")}
          </p>
        </div>
        <a
          href={lotOpenUrl(lot.url, lot.title, lot.lote)}
          target="_blank"
          rel="noreferrer"
          aria-label="Abrir lote no leiloeiro"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background"
        >
          <ExternalLink className="h-5 w-5" />
        </a>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="relative grid min-h-44 place-items-center overflow-hidden rounded-2xl border border-border bg-secondary p-2">
          {st.soldLabel || soldLabel ? (
            <div className="pointer-events-none absolute top-6 -right-9 z-10 w-40 rotate-[32deg] bg-red-600 py-1 text-center text-[11px] font-extrabold uppercase tracking-wider text-white shadow">
              Vendido
              {(st.soldLabel ?? soldLabel) !== "Vendido" ? ` ${st.soldLabel ?? soldLabel}` : ""}
            </div>
          ) : null}
          <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
            {lot.lote ? (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-extrabold text-background">
                Lote {lot.lote}
              </span>
            ) : null}
            <span
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-white",
                owned ? "bg-purple-600" : "bg-zinc-500/80",
              )}
              aria-label={owned ? "Relacionado à Coleção" : "Sem relação com a Coleção"}
            >
              <Disc3 className="h-4 w-4" />
            </span>
          </div>
          {ai && ai.score !== null ? (
            <span
              className={cn(
                "absolute top-2 right-2 rounded-lg px-2 py-1 text-base font-extrabold shadow",
                scoreTone(ai.score),
              )}
            >
              {ai.score}
            </span>
          ) : null}
          {lot.image ? (
            <img src={lot.image} alt="" className="max-h-56 w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">sem imagem</span>
          )}
        </div>

        <div
          role="tablist"
          className="sticky top-0 z-10 flex gap-1 rounded-xl border border-border bg-card p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "min-h-10 flex-1 rounded-lg text-xs font-semibold text-muted-foreground",
                t.off && "opacity-50",
                tab === t.id && "bg-primary/10 text-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "resumo" ? (
          <>
            <Box>
              <p className="text-base leading-snug font-bold">{aiLabel || title}</p>
              {aiLabel ? (
                <p className="max-h-24 overflow-y-auto text-sm leading-snug break-words text-muted-foreground">
                  {title}
                </p>
              ) : null}
            </Box>
            <Box title="Valores">
              <dl className="space-y-1.5">
                <Row label="Atual">
                  <span className="text-primary">{st.currentPrice || "sem valor"}</span>
                </Row>
                {lot.nextBid ? <Row label="Próximo lance mínimo">{lot.nextBid}</Row> : null}
                {lot.myBid ? <Row label="Meu lance">{lot.myBid}</Row> : null}
                {st.hasBid ? (
                  <Row label="Situação">
                    <span
                      className={
                        st.winning
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      {bidStatus}
                    </span>
                  </Row>
                ) : null}
                {st.soldLabel && st.soldLabel !== "Vendido" ? (
                  <Row label="Vendido por">{st.soldLabel}</Row>
                ) : null}
                {lot.dayKey ? <Row label="Data">{lot.dayKey}</Row> : null}
                {lot.time ? <Row label="Hora">{lot.time}</Row> : null}
                {lot.uf ? <Row label="UF">{lot.uf}</Row> : null}
                {demand && (demand.views != null || demand.bids != null) ? (
                  <Row label="Demanda">
                    {demand.views != null ? `👁 ${demand.views}` : ""}
                    {demand.views != null && demand.bids != null ? " · " : ""}
                    {demand.bids != null ? `🔨 ${demand.bids}` : ""}
                  </Row>
                ) : null}
              </dl>
            </Box>
            {condition && (condition.media || condition.sleeve || condition.insert !== null) ? (
              <Box title="Conservação">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <ConditionBadges condition={condition} />
                </div>
              </Box>
            ) : null}
            <Box title="Tags">
              <MobileTags tags={ai?.tags ?? []} onEdit={ai ? onEditTags : undefined} />
              {!ai ? (
                <p className="text-xs text-muted-foreground">
                  Tags editáveis só em lotes avaliados pela IA.
                </p>
              ) : null}
            </Box>
            {hit || possibleTrash ? (
              <Box title="Sinais">
                {hit ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded bg-fuchsia-500/15 px-2 py-1 font-semibold text-fuchsia-700 dark:text-fuchsia-300">
                      <Binoculars className="h-3.5 w-3.5" aria-hidden />
                      {hit.label} · {Math.round(hit.score * 100)}%
                      {hit.confirmed ? " (confirmado)" : ""}
                      {vs === "under"
                        ? " · abaixo do teto"
                        : vs === "over"
                          ? " · acima do teto"
                          : ""}
                    </span>
                    {onResolveLookout && !hit.confirmed && !hitSure ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onResolveLookout("confirm")}
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 font-medium"
                        >
                          <Check className="h-4 w-4" /> É este
                        </button>
                        <button
                          type="button"
                          onClick={() => onResolveLookout("dismiss")}
                          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 font-medium"
                        >
                          <X className="h-4 w-4" /> Não é
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {possibleTrash ? (
                  <div className="space-y-1.5 text-xs">
                    <p className="font-semibold text-orange-700 dark:text-orange-400">
                      ⚠ possível lixo
                    </p>
                    <p className="text-muted-foreground">
                      Parecido com um lote excluído: "{possibleTrash.excludedTitle}" (termos:{" "}
                      {possibleTrash.matchedTerms.join(", ")}).
                    </p>
                    {onDismissTrash ? (
                      <button
                        type="button"
                        onClick={onDismissTrash}
                        className="inline-flex h-9 items-center rounded-lg border border-border px-3 font-medium"
                      >
                        Isto NÃO é lixo
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </Box>
            ) : null}
            <Box title="Origem">
              <dl className="space-y-1.5">
                <Row label="Casa">{lot.house}</Row>
                {origin ? <Row label="Pregão">{origin.idLeilao}</Row> : null}
                {origin?.days ? <Row label="Dias">{origin.days}</Row> : null}
                {origin?.multiDay ? <Row label="Catálogo">multi-dia</Row> : null}
              </dl>
              {origin?.onMove ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    origin.onMove?.();
                  }}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium"
                >
                  <ArrowRightLeft className="h-4 w-4" /> Mover para outro artista
                </button>
              ) : null}
            </Box>
          </>
        ) : null}

        {tab === "nota" ? (
          ai ? (
            <Box>
              <div className="text-sm [&_.text-xs]:text-sm">
                <ScoreDetails
                  ai={ai}
                  market={market}
                  price={lot.price}
                  lot={
                    lot.id
                      ? {
                          id: lot.id,
                          title: lot.title,
                          price: lot.price,
                          house: lot.house,
                          image: lot.image,
                        }
                      : undefined
                  }
                />
              </div>
            </Box>
          ) : (
            <Box>
              <p className="text-sm text-muted-foreground">
                Este lote ainda não foi avaliado pela IA.
              </p>
            </Box>
          )
        ) : null}

        {tab === "faixas" ? (
          tracks?.length ? (
            <Box>
              <div className="text-sm">
                <TracklistContent tracklist={tracks} title={aiLabel || undefined} />
              </div>
            </Box>
          ) : (
            <Box>
              <p className="text-sm text-muted-foreground">
                Tracklist ainda não disponível. Vem com a análise da IA.
              </p>
            </Box>
          )
        ) : null}

        {tab === "colecao" ? (
          <>
            <Box title="Relação com a Coleção">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-white",
                    owned ? "bg-purple-600" : "bg-zinc-500/80",
                  )}
                >
                  <Disc3 className="h-4 w-4" />
                </span>
                {owned
                  ? ownedConfident
                    ? `Já tenho na Coleção${owned.label ? `: ${owned.label}` : ""}`
                    : `Provável: já tenho na Coleção${owned.label ? `: ${owned.label}` : ""}`
                  : "Sem relação com a Coleção"}
              </p>
              {onOpenOwned ? (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onOpenOwned();
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
                >
                  Ver, confirmar ou trocar a relação
                </button>
              ) : null}
            </Box>
            <Box title="De olho">
              <p className="text-sm">
                {lookout?.on
                  ? "Você marcou este lote como compra muito em vista."
                  : "Marque para destacar este disco quando reaparecer em leilão."}
              </p>
              {lookout?.maxPrice ? (
                <p className="text-xs text-muted-foreground">
                  Teto do disco: R$ {lookout.maxPrice}
                </p>
              ) : null}
              {onToggleLookout ? (
                <button
                  type="button"
                  onClick={onToggleLookout}
                  aria-pressed={Boolean(lookout?.on)}
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-semibold",
                    lookout?.on
                      ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300"
                      : "border-border",
                  )}
                >
                  <Binoculars className="h-4 w-4" />
                  {lookout?.on ? "De olho (toque para desmarcar)" : "Ficar de olho"}
                </button>
              ) : null}
            </Box>
          </>
        ) : null}
      </div>

      <div className="border-t border-border bg-card px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {confirmDel ? (
          <div className="space-y-2">
            <p className="text-sm">
              Excluir este lote para sempre? Ele some e ajuda a sinalizar lotes parecidos.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="h-11 flex-1 rounded-lg border border-border text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDel(false);
                  close();
                  onExclude?.();
                }}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-destructive text-sm font-semibold text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Excluir…
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              className={cn(
                "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-bold",
                lot.watched
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background",
              )}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : lot.watched ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
              {lot.watched ? "Vigiando" : "Vigiar"}
            </button>
            {onToggleLookout ? (
              <button
                type="button"
                onClick={onToggleLookout}
                aria-pressed={Boolean(lookout?.on)}
                aria-label={lookout?.on ? "Parar de ficar de olho" : "Ficar de olho"}
                className={cn(
                  "grid h-12 w-12 place-items-center rounded-xl border",
                  lookout?.on
                    ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-600"
                    : "border-border",
                )}
              >
                <Binoculars className="h-5 w-5" />
              </button>
            ) : null}
            <a
              href={lotOpenUrl(lot.url, lot.title, lot.lote)}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir lote no leiloeiro"
              className="grid h-12 w-12 place-items-center rounded-xl border border-border"
            >
              <ExternalLink className="h-5 w-5" />
            </a>
            {onExclude ? (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                aria-label="Excluir lote (nunca mais aparece)"
                className="grid h-12 w-12 place-items-center rounded-xl border border-border text-muted-foreground"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

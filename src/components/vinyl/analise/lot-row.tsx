import { Disc3, ExternalLink, Eye, EyeOff, Gavel, Loader2, Target } from "lucide-react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import {
  LotTags,
  RarityLabel,
  ReevaluateIconButton,
  ScoreBadge,
} from "@/components/vinyl/ai-score";
import {
  dealLabel,
  dealTone,
  discogsUrl,
  fmtMoney,
  formatAiAlbum,
  rowStatusTone,
} from "@/components/vinyl/ai-score-utils";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import { HouseLight } from "@/components/vinyl/house-light";
import { HouseUf } from "@/components/vinyl/house-uf";
import { demandRatio, gradeAtLeast } from "@/lib/analise-rank";
import type { LotEconomics } from "@/lib/lot-score";
import type { LotInsight } from "@/lib/use-lot-insights";
import { bidIsWinning, formatDayLabel, type VinylLot } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN } from "@/lib/wantlist-match";

type AnaliseRowProps = {
  lot: VinylLot;
  insight: LotInsight;
  /** Conta do lance com o valor ATUAL (já corrigido quando o lance é meu e está ganhando). */
  eco: LotEconomics;
  /** Valor atual exibido (texto do lote ou meu lance vencendo). */
  currentPrice: string;
  rank: number;
  days: string[];
  watched: boolean;
  bidStatus: string | null;
  busy: boolean;
  variant: "list" | "cards";
  onToggleWatch: (lot: VinylLot) => void;
  onEditTags: (id: string, tags: string[]) => void;
};

const pill = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium";

/** Capa do lote (miniatura) ou um disco genérico quando o lote não tem imagem. */
function Cover({ image }: { image: string | null }) {
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary sm:h-[88px] sm:w-[88px]">
      {image ? (
        <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <Disc3 className="h-8 w-8 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

/**
 * Uma linha (ou card) da Análise: capa, nota, título, as marcas que mudam a decisão (estado do
 * disco, "já tenho", semáforo da casa, procura, vigia/lance) e a conta do lance (custo total,
 * teto, potencial). Tudo já vem resolvido pela tela — o componente só desenha.
 */
function AnaliseLotRowImpl({
  lot,
  insight,
  eco,
  currentPrice,
  rank,
  days,
  watched,
  bidStatus,
  busy,
  variant,
  onToggleWatch,
  onEditTags,
}: AnaliseRowProps) {
  const { ai, album, market, condition, demand, owned, lookout, houseLevel } = insight;
  const cards = variant === "cards";
  const aiLabel = album ? formatAiAlbum(album, market?.year ?? null) : "";
  const lookoutTitle = lookout
    ? `De olho: ${lookout.label} · ${lookout.confirmed ? "confirmado" : `${Math.round(lookout.score * 100)}%${lookout.yearPending ? " (a validar)" : ""}`}`
    : undefined;
  const heat = market?.want != null ? demandRatio(market.want, market.have) : 0;
  const weakDisc = condition.media !== null && !gradeAtLeast(condition.media, "VG");
  const href = market?.matched ? discogsUrl(market.releaseId) : null;
  const range =
    market?.priceLowBr != null
      ? market.priceHighBr != null && market.priceHighBr > market.priceLowBr
        ? `${fmtMoney(market.priceLowBr, "BRL")}–${fmtMoney(market.priceHighBr, "BRL")}`
        : fmtMoney(market.priceLowBr, "BRL")
      : null;
  const winning = bidStatus ? bidIsWinning(bidStatus) : false;

  return (
    <article
      className={`overflow-hidden rounded-lg border border-border bg-card ${rowStatusTone(bidStatus, watched)}`}
    >
      <div
        className={`grid gap-x-3 gap-y-2 p-3 ${
          cards
            ? "grid-cols-[64px_minmax(0,1fr)]"
            : "grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[88px_minmax(0,1fr)_auto]"
        }`}
      >
        <div className="flex flex-col items-start gap-1.5">
          <Cover image={lot.image} />
          {ai ? (
            <ScoreBadge
              ai={ai}
              market={market}
              price={currentPrice}
              rank={rank}
              lot={{
                id: lot.id,
                title: lot.title,
                price: currentPrice,
                house: lot.house,
                image: lot.image,
              }}
            />
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="min-w-0">
            <a
              href={lot.url}
              target="_blank"
              rel="noreferrer"
              className="line-clamp-2 font-semibold text-foreground hover:text-primary hover:underline"
              title={lot.title}
            >
              {lookout ? (
                <Target
                  className="mr-1 inline h-3.5 w-3.5 text-primary"
                  aria-label={lookoutTitle}
                />
              ) : null}
              {aiLabel || lot.title}
            </a>
            {aiLabel ? (
              <p className="line-clamp-1 text-xs text-muted-foreground" title={lot.title}>
                {lot.title}
              </p>
            ) : null}
          </div>

          {/* Estado do meu acompanhamento: vigia e lance ficam sempre explícitos. */}
          {watched || bidStatus ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {bidStatus ? (
                <span
                  className={`${pill} ${
                    winning
                      ? "bg-green-500/15 text-green-700 dark:text-green-400"
                      : "bg-red-500/15 text-red-700 dark:text-red-400"
                  }`}
                  title="Situação do seu lance neste lote"
                >
                  <Gavel className="h-3 w-3" /> {bidStatus}
                </span>
              ) : null}
              {watched ? (
                <span
                  className={`${pill} bg-yellow-500/15 text-yellow-700 dark:text-yellow-400`}
                  title="Você está vigiando este lote"
                >
                  <Eye className="h-3 w-3" /> Vigiando
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {eco.deal !== "indefinido" ? (
              <span
                className={`${pill} bg-secondary ${dealTone(eco.deal)}`}
                title="Lance + frete ÷ preço sugerido do Discogs para o estado do disco"
              >
                {dealLabel(eco.deal)}
                {eco.ratio !== null ? ` · ${Math.round(eco.ratio * 100)}% do mercado` : ""}
              </span>
            ) : ai?.deal && ai.deal !== "indefinido" ? (
              <span className={`${pill} bg-secondary ${dealTone(ai.deal)}`}>
                {dealLabel(ai.deal)}
              </span>
            ) : null}
            {ai?.rarity ? (
              <span className={`${pill} bg-secondary`}>
                <RarityLabel rarity={ai.rarity} />
              </span>
            ) : null}
            <ConditionBadges condition={condition} />
            {weakDisc ? (
              <span className={`${pill} bg-red-500/15 text-red-700 dark:text-red-400`}>
                estado fraco
              </span>
            ) : null}
            {owned ? (
              <span
                className={`${pill} bg-purple-500/15 text-purple-700 dark:text-purple-300`}
                title={`Coleção${owned.label ? `: ${owned.label}` : ""}`}
              >
                💿 já tenho{owned.score >= OWNED_CONFIDENT_MIN ? "" : "?"}
              </span>
            ) : null}
            {lookout ? (
              <span className={`${pill} bg-primary/10 text-primary`} title={lookoutTitle}>
                🎯 De olho
              </span>
            ) : null}
            {ai?.matchesInterests ? (
              <span
                className={`${pill} bg-yellow-500/15 text-yellow-700 dark:text-yellow-400`}
                title="Combina com os seus interesses"
              >
                ⭐ interesse
              </span>
            ) : null}
            {heat >= 1.5 ? (
              <span
                className={`${pill} bg-green-500/15 text-green-700 dark:text-green-400`}
                title={`Discogs: ${market?.want} querem × ${market?.have ?? 0} têm`}
              >
                🔥 procurado {heat.toFixed(1)}×
              </span>
            ) : null}
            {demand?.bids ? (
              <span
                className={`${pill} bg-secondary`}
                title={`${demand.views ?? 0} visitas no catálogo`}
              >
                {demand.bids} lance(s)
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <HouseLight house={lot.house} className="-mx-0.5" />
            <span>{lot.house}</span>
            <HouseUf house={lot.house} uf={lot.uf} />
            {houseLevel === "vermelho" || houseLevel === "laranja" ? (
              <span className={`${pill} bg-red-500/15 text-red-700 dark:text-red-400`}>
                casa mal avaliada
              </span>
            ) : null}
            <span>
              · {formatDayLabel(lot.dayKey, days)} {lot.time}
              {lot.lote ? ` · lote ${lot.lote}` : ""}
            </span>
          </div>

          {ai?.reason ? (
            <p className="max-w-xl text-xs text-muted-foreground">{ai.reason}</p>
          ) : null}
          <LotTags tags={ai?.tags ?? []} onEdit={(tags) => onEditTags(lot.id, tags)} />
        </div>

        {/* A conta do lance */}
        <div
          className={`text-right text-xs tabular-nums ${
            cards ? "col-span-2" : "col-span-2 sm:col-span-1 sm:min-w-[148px]"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2 sm:block">
            <span className="text-[11px] text-muted-foreground sm:block">lance + frete</span>
            <span className="text-lg font-bold text-foreground">
              {eco.total !== null ? fmtMoney(eco.total, "BRL") : currentPrice || "sem valor"}
            </span>
          </div>
          {eco.ref !== null ? (
            <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
              <dt>mercado ({condition.media ?? "G+"})</dt>
              <dd className="font-medium text-foreground">{fmtMoney(eco.ref, "BRL")}</dd>
              <dt title="Maior lance que ainda deixa o lote barato (≤ 70% do mercado, já com o frete)">
                teto barato
              </dt>
              <dd className="font-medium text-green-700 dark:text-green-400">
                {fmtMoney(eco.capCheap, "BRL")}
              </dd>
              <dt title="Mercado − lance − frete">potencial</dt>
              <dd
                className={`font-medium ${
                  (eco.potential ?? 0) >= 0
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
                }`}
              >
                {(eco.potential ?? 0) >= 0 ? "+" : ""}
                {fmtMoney(eco.potential, "BRL")}
              </dd>
            </dl>
          ) : (
            <p className="mt-1 text-muted-foreground">sem preço de mercado</p>
          )}
          {range ? (
            <p
              className="mt-1 text-muted-foreground"
              title="Faixa no Discogs: vendedores do Brasil, já com o frete somado"
            >
              Discogs BR: <span className="font-medium text-foreground">{range}</span>
            </p>
          ) : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              Discogs <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border/60 bg-secondary/30 px-3 py-1.5">
        <ReevaluateIconButton
          lot={{
            id: lot.id,
            title: lot.title,
            price: currentPrice,
            house: lot.house,
            image: lot.image,
          }}
        />
        <Button
          size="sm"
          variant={watched ? "default" : "outline"}
          className="h-8 gap-1.5"
          onClick={() => onToggleWatch(lot)}
          disabled={busy}
          title={watched ? "Vigiando — clique para remover" : "Vigiar este lote"}
          aria-pressed={watched}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : watched ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {watched ? "Desvigiar" : "Vigiar"}
        </Button>
      </footer>
    </article>
  );
}

export const AnaliseLotRow = memo(AnaliseLotRowImpl);

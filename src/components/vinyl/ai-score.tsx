import { Sparkles, Star } from "lucide-react";

import {
  dealLabel,
  dealTone,
  fmtMoney,
  marketDeal,
  rarityLabel,
  scoreTone,
  type LotAi,
  type LotMarket,
} from "./ai-score-utils";

/** Bloco do mercado (Discogs): menor preço à venda, sugerido, demanda e oportunidade. */
function MarketBlock({ market, price }: { market: LotMarket; price?: string }) {
  const deal = price ? marketDeal(price, market) : "indefinido";
  return (
    <div className="mt-1 border-t border-border pt-1.5">
      <div className="flex items-center justify-between font-medium text-foreground">
        <span>Mercado (Discogs)</span>
        {deal !== "indefinido" ? (
          <span className={`text-[11px] ${dealTone(deal)}`}>{dealLabel(deal)} vs. mercado</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        {market.lowestPrice !== null ? (
          <>
            <dt>Menor à venda:</dt>
            <dd className="font-medium text-foreground">
              {fmtMoney(market.lowestPrice, market.currency)}
              {market.numForSale ? ` · ${market.numForSale} à venda` : ""}
            </dd>
          </>
        ) : null}
        {market.suggestedPrice !== null ? (
          <>
            <dt>Sugerido:</dt>
            <dd className="font-medium text-foreground">
              {fmtMoney(market.suggestedPrice, market.currency)}
              {market.suggestedCondition ? ` (${market.suggestedCondition})` : ""}
            </dd>
          </>
        ) : null}
        {market.want !== null || market.have !== null ? (
          <>
            <dt>Procura/oferta:</dt>
            <dd className="font-medium text-foreground">
              {market.want ?? 0} querem · {market.have ?? 0} têm
            </dd>
          </>
        ) : null}
      </dl>
      {market.releaseId ? (
        <a
          href={`https://www.discogs.com/release/${market.releaseId}`}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          ver no Discogs
        </a>
      ) : null}
    </div>
  );
}

/** Conteúdo do overlay/coluna: o que compõe a nota. Reutilizado no card e na Análise. */
export function ScoreDetails({
  ai,
  market,
  price,
}: {
  ai: LotAi;
  market?: LotMarket;
  price?: string;
}) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Nota {ai.score ?? "—"} / 100
      </div>
      {ai.album ? <p className="font-medium text-foreground">{ai.album}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        <dt>Raridade:</dt>
        <dd className="font-medium text-foreground">{rarityLabel(ai.rarity)}</dd>
        <dt>Oportunidade:</dt>
        <dd className={`font-medium ${dealTone(ai.deal)}`}>{dealLabel(ai.deal)}</dd>
        {ai.matchesInterests ? (
          <>
            <dt>Interesse:</dt>
            <dd className="font-medium text-yellow-600 dark:text-yellow-400">Combina com você</dd>
          </>
        ) : null}
      </dl>
      {ai.reason ? <p className="text-muted-foreground">{ai.reason}</p> : null}
      {ai.tags.length ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {ai.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {market?.matched ? <MarketBlock market={market} price={price} /> : null}
    </div>
  );
}

/**
 * Badge de nota no canto do card + overlay ao passar o mouse (ou focar, para
 * teclado/toque). Fica DENTRO do card (que tem overflow-hidden), então o overlay abre
 * para baixo e à esquerda, cabendo na largura do card.
 */
export function ScoreCorner({
  ai,
  market,
  price,
}: {
  ai: LotAi;
  market?: LotMarket;
  price?: string;
}) {
  if (ai.score === null) return null;
  return (
    <div className="group/score absolute right-2 top-2 z-10">
      <button
        type="button"
        aria-label={`Nota ${ai.score} de 100 — ver detalhes`}
        className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold shadow ${scoreTone(ai.score)}`}
      >
        {ai.matchesInterests ? <Star className="h-3 w-3 fill-current" /> : null}
        {ai.score}
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-60 rounded-md border border-border bg-popover p-3 text-left shadow-md group-hover/score:block group-focus-within/score:block">
        <ScoreDetails ai={ai} market={market} price={price} />
      </div>
    </div>
  );
}

/** Chips compactos de nota/raridade/oportunidade/match para linhas de tabela. */
export function ScoreChips({ ai }: { ai: LotAi }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold ${scoreTone(ai.score)}`}
      >
        {ai.matchesInterests ? <Star className="h-3 w-3 fill-current" /> : null}
        {ai.score ?? "—"}
      </span>
      {ai.rarity ? (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-foreground">
          {rarityLabel(ai.rarity)}
        </span>
      ) : null}
      {ai.deal && ai.deal !== "indefinido" ? (
        <span className={`text-[11px] font-medium ${dealTone(ai.deal)}`}>{dealLabel(ai.deal)}</span>
      ) : null}
    </div>
  );
}

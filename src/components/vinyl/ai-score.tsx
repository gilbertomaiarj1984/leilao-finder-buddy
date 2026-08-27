import { ExternalLink, Plus, Sparkles, Star, X } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  dealLabel,
  dealTone,
  discogsUrl,
  fmtMoney,
  marketDeal,
  rarityLabel,
  RARITY_LEGEND,
  scoreTone,
  type LotAi,
  type LotMarket,
} from "./ai-score-utils";

/** Bloco do mercado (Discogs): faixa de preço no Brasil (c/ frete), sugerido e demanda. */
function MarketBlock({ market, price }: { market: LotMarket; price?: string }) {
  const deal = price ? marketDeal(price, market) : "indefinido";
  const range =
    market.priceLowBr !== null
      ? market.priceHighBr !== null && market.priceHighBr > market.priceLowBr
        ? `${fmtMoney(market.priceLowBr, "BRL")} a ${fmtMoney(market.priceHighBr, "BRL")}`
        : fmtMoney(market.priceLowBr, "BRL")
      : null;
  return (
    <div className="mt-1 border-t border-border pt-1.5">
      <div className="flex items-center justify-between font-medium text-foreground">
        <span>Mercado (Discogs)</span>
        {deal !== "indefinido" ? (
          <span className={`text-[11px] ${dealTone(deal)}`}>{dealLabel(deal)} vs. mercado</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        {range !== null ? (
          <>
            <dt>Brasil (c/ frete):</dt>
            <dd className="font-medium text-foreground">
              {range}
              {market.numForSaleBr ? ` · ${market.numForSaleBr} à venda` : ""}
            </dd>
          </>
        ) : null}
        {market.lowestPrice !== null ? (
          <>
            <dt>Menor (global):</dt>
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
          href={discogsUrl(market.releaseId)!}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          ver no Discogs <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

// Cores da raridade (menor → maior valor): comum=vermelho, interessante=amarelo,
// raro=metade amarelo/metade verde, muito_raro=verde.
const RARITY_RED = "text-red-600 dark:text-red-400";
const RARITY_YELLOW = "text-yellow-600 dark:text-yellow-400";
const RARITY_GREEN = "text-green-600 dark:text-green-400";

/**
 * Rótulo da raridade colorido pela escala. Em "raro", a palavra é dividida ao meio:
 * a 1ª metade em amarelo e a 2ª em verde (transição de interessante → muito raro).
 */
export function RarityLabel({ rarity }: { rarity: string | null }) {
  const label = rarityLabel(rarity);
  if (rarity === "comum") return <span className={`font-medium ${RARITY_RED}`}>{label}</span>;
  if (rarity === "interessante")
    return <span className={`font-medium ${RARITY_YELLOW}`}>{label}</span>;
  if (rarity === "muito_raro")
    return <span className={`font-medium ${RARITY_GREEN}`}>{label}</span>;
  if (rarity === "raro") {
    const mid = Math.ceil(label.length / 2);
    return (
      <span className="font-medium">
        <span className={RARITY_YELLOW}>{label.slice(0, mid)}</span>
        <span className={RARITY_GREEN}>{label.slice(mid)}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">{label}</span>;
}

/** Legenda da raridade (menor → maior valor). O usuário não sabia qual extremo é o mais raro. */
export function RarityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">Raridade:</span>
      {RARITY_LEGEND.map((r, i) => (
        <span key={r.key} className="inline-flex items-center gap-1.5">
          <span className="rounded bg-secondary px-1.5 py-0.5">
            <RarityLabel rarity={r.key} />
          </span>
          {i < RARITY_LEGEND.length - 1 ? <span aria-hidden="true">→</span> : null}
        </span>
      ))}
      <span className="ml-0.5">(menor → maior)</span>
    </div>
  );
}

/**
 * Chips das tags da IA. Reutilizado nos cards e nas tabelas da Análise. Quando recebe
 * `onEdit`, fica EDITÁVEL: ao passar o mouse aparece o × em cada tag (remover) e o "+ tag"
 * (adicionar). Sem `onEdit`, é só leitura (como antes).
 */
export function LotTags({ tags, onEdit }: { tags: string[]; onEdit?: (next: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  if (!onEdit) {
    if (!tags.length) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">
            {t}
          </span>
        ))}
      </div>
    );
  }

  const commitAdd = () => {
    const v = value.replace(/\s+/g, " ").trim();
    if (v && !tags.some((t) => t.toLowerCase() === v.toLowerCase())) onEdit([...tags, v]);
    setValue("");
    setAdding(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    } else if (e.key === "Escape") {
      setValue("");
      setAdding(false);
    }
  };

  return (
    <div className="group/tags flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-0.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground"
        >
          {t}
          <button
            type="button"
            onClick={() => onEdit(tags.filter((x) => x !== t))}
            aria-label={`Remover tag ${t}`}
            title={`Remover tag "${t}"`}
            className="opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/tags:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          onBlur={commitAdd}
          placeholder="nova tag"
          className="h-5 w-20 rounded border border-input bg-background px-1 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Adicionar tag"
          title="Adicionar tag"
          className="inline-flex items-center gap-0.5 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:border-primary hover:text-primary focus:opacity-100 group-hover/tags:opacity-100"
        >
          <Plus className="h-3 w-3" /> tag
        </button>
      )}
    </div>
  );
}

/**
 * Painel de detalhes que surge ao passar o mouse/focar o gatilho, aberto À ESQUERDA dele.
 * Renderiza via portal (position: fixed) para NÃO ser cortado por contêineres com overflow
 * (tabela com scroll horizontal, card com overflow-hidden). É interativo — o mouse pode
 * entrar no painel para clicar o link do Discogs. Sem espaço à esquerda (telas estreitas),
 * cai para baixo do gatilho. Só monta no cliente (o estilo começa nulo → sem SSR do portal).
 */
const PANEL_WIDTH = 264;
function HoverDetails({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const open = () => {
    cancelClose();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    let left = r.left - 6 - PANEL_WIDTH;
    let top = r.top;
    if (left < 8) {
      // Sem espaço à esquerda: abre abaixo, alinhado para caber na tela.
      left = Math.max(8, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8));
      top = r.bottom + 6;
    }
    setStyle({ position: "fixed", top, left, width: PANEL_WIDTH, zIndex: 60 });
  };
  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => setStyle(null), 140);
  };
  return (
    <div
      ref={ref}
      className="inline-flex cursor-help"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocusCapture={open}
      onBlurCapture={scheduleClose}
      onClick={open}
    >
      {trigger}
      {style
        ? createPortal(
            <div
              style={style}
              onMouseEnter={open}
              onMouseLeave={scheduleClose}
              className="rounded-md border border-border bg-popover p-3 text-left shadow-md"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * Selo da nota com a explicação (o que compõe a nota) surgindo À ESQUERDA ao passar o
 * mouse/focar. Usado na coluna "Nota" das tabelas da Análise.
 */
export function ScoreBadge({
  ai,
  market,
  price,
  rank,
}: {
  ai: LotAi;
  market?: LotMarket;
  price?: string;
  rank?: number;
}) {
  if (ai.score === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      {rank ? <span className="text-[10px] text-muted-foreground">#{rank}</span> : null}
      <HoverDetails
        trigger={
          <button
            type="button"
            aria-label={`Nota ${ai.score} de 100 — ver detalhes`}
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold shadow ${scoreTone(ai.score)}`}
          >
            {ai.matchesInterests ? <Star className="h-3 w-3 fill-current" /> : null}
            {ai.score}
          </button>
        }
      >
        <ScoreDetails ai={ai} market={market} price={price} />
      </HoverDetails>
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
        <dd>
          <RarityLabel rarity={ai.rarity} />
        </dd>
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
        <div className="pt-0.5">
          <LotTags tags={ai.tags} />
        </div>
      ) : null}
      {market?.matched ? <MarketBlock market={market} price={price} /> : null}
    </div>
  );
}

/**
 * Badge de nota no canto do card. Ao passar o mouse (ou focar), a explicação do que compõe
 * a nota abre À ESQUERDA do selo via portal — não é cortada pelo overflow-hidden do card e
 * o link do Discogs dentro dela fica clicável.
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
    <div className="absolute right-2 top-2 z-10">
      <HoverDetails
        trigger={
          <button
            type="button"
            aria-label={`Nota ${ai.score} de 100 — ver detalhes`}
            className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold shadow ${scoreTone(ai.score)}`}
          >
            {ai.matchesInterests ? <Star className="h-3 w-3 fill-current" /> : null}
            {ai.score}
          </button>
        }
      >
        <ScoreDetails ai={ai} market={market} price={price} />
      </HoverDetails>
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

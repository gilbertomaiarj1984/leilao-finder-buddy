import { ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LotTags, ScoreCorner } from "@/components/vinyl/ai-score";
import type { LotAi, LotMarket } from "@/components/vinyl/ai-score-utils";
import { bidIsWinning } from "@/lib/vinyl-parse";

export type CardLot = {
  title: string;
  url: string;
  image: string | null;
  price: string;
  time: string;
  house: string;
  uf: string;
  dayKey: string;
  watched: boolean;
  lote?: string;
  myBid?: string;
  nextBid?: string; // próximo lance mínimo (quando conhecido — via peca.asp)
};

export function LotCard({
  lot,
  busy,
  onToggle,
  showDate = false,
  bidStatus,
  ai,
  market,
  onEditTags,
}: {
  lot: CardLot;
  busy: boolean;
  onToggle: () => void;
  showDate?: boolean;
  bidStatus?: string | null;
  ai?: LotAi;
  market?: LotMarket;
  onEditTags?: (next: string[]) => void;
}) {
  // Cores (mesma regra do painel): meu lance ganhando = verde; meu lance coberto = vermelho;
  // apenas vigiado = amarelo; caso contrário, borda neutra.
  const hasBid = bidStatus !== undefined && bidStatus !== null && bidStatus !== "";
  const winning = hasBid && bidIsWinning(bidStatus as string);
  // Quando estou VENCENDO, o valor atual É o meu lance (a listagem pública traz o
  // valor defasado, anterior ao meu lance vencedor). Quando estou coberto, o valor
  // atual é o da listagem (o lance que me cobriu).
  const currentPrice = winning && lot.myBid ? lot.myBid : lot.price;
  const cardClass = hasBid
    ? winning
      ? "border-green-500 ring-1 ring-green-500/40"
      : "border-red-500 ring-1 ring-red-500/40"
    : lot.watched
      ? "border-yellow-500 ring-1 ring-yellow-500/40"
      : "border-border";
  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-md border bg-card ${cardClass}`}
    >
      {ai ? <ScoreCorner ai={ai} market={market} price={lot.price} /> : null}
      <a href={lot.url} target="_blank" rel="noreferrer" className="block bg-secondary">
        {lot.image ? (
          <img
            src={lot.image}
            alt={lot.title}
            loading="lazy"
            className="h-44 w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            sem imagem
          </div>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="line-clamp-3 text-sm leading-snug text-foreground">{lot.title}</p>
        {ai?.tags?.length ? <LotTags tags={ai.tags} onEdit={onEditTags} /> : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {lot.lote ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
              Lote {lot.lote}
            </span>
          ) : null}
          <span className="font-semibold text-primary" title="Valor atual">
            Atual {currentPrice || "sem valor"}
          </span>
          {lot.nextBid ? (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
              title="Próximo lance mínimo"
            >
              Próximo {lot.nextBid}
            </span>
          ) : null}
          {/* Meu lance vai para a linha de baixo (quebra o flex-wrap). */}
          {lot.myBid ? <span className="w-full" aria-hidden="true" /> : null}
          {lot.myBid ? (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
              title="Meu lance"
            >
              Meu lance {lot.myBid}
            </span>
          ) : null}
          {hasBid ? (
            <span
              className={
                winning
                  ? "rounded bg-green-500/15 px-1.5 py-0.5 font-medium text-green-600 dark:text-green-400"
                  : "rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-600 dark:text-red-400"
              }
            >
              {bidStatus}
            </span>
          ) : null}
          {showDate && lot.dayKey ? <span>{lot.dayKey}</span> : null}
          {lot.time ? <span>{lot.time}</span> : null}
          {lot.uf ? <span>{lot.uf}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={lot.watched ? "default" : "outline"}
            className="flex-1"
            onClick={onToggle}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : lot.watched ? (
              <EyeOff className="mr-2 h-4 w-4" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            {lot.watched ? "Vigiando" : "Vigiar"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={lot.url} target="_blank" rel="noreferrer" aria-label="Abrir lote no leiloeiro">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}

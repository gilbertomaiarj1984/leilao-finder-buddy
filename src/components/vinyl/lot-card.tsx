import { Disc3, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { LotTags, ScoreCorner } from "@/components/vinyl/ai-score";
import { formatAiAlbum, type LotAi, type LotMarket } from "@/components/vinyl/ai-score-utils";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import type { Condition } from "@/lib/grading";
import { bidIsWinning } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN, type OwnedHit } from "@/lib/wantlist-match";

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
  album,
  condition,
  demand,
  owned,
  onOpenOwned,
  onEditTags,
}: {
  lot: CardLot;
  busy: boolean;
  onToggle: () => void;
  showDate?: boolean;
  bidStatus?: string | null;
  ai?: LotAi;
  market?: LotMarket;
  // Estado de conservação (Disco/Capa/encarte + Score/Faixa), resolvido pelo pai. Quando
  // indefinido (sem sinal no texto), os badges simplesmente não aparecem.
  condition?: Condition | null;
  // Sinais de demanda do catálogo (visualizações/lances), resolvidos pelo pai. Ajudam a
  // identificar lotes "quentes" antes do leilão. Ausentes → badge não aparece.
  demand?: { views: number | null; bids: number | null } | null;
  // Artista/álbum identificado pela IA (avaliação completa OU identificação simples),
  // já resolvido pelo pai. Priorizado sobre o título quando existir.
  album?: string | null;
  // Relação com a Coleção (disco que o usuário JÁ possui), resolvida pelo pai. O ícone
  // aparece em TODO card: `null` = cinza (sem relação); `score` ≥ 80% = roxo confiante;
  // 60–80% = roxo com "?" (incerto/sugerido). Clicar abre o painel (`onOpenOwned`).
  owned?: OwnedHit | null;
  onOpenOwned?: () => void;
  onEditTags?: (next: string[]) => void;
}) {
  // Algumas imagens hotlinkadas das casas falham (403/404/expirada). Sem isto, o navegador
  // renderiza o `alt` (o título, às vezes bem extenso) por cima do card inteiro no lugar da
  // imagem quebrada — troca para o mesmo placeholder usado quando não há imagem.
  const [imgFailed, setImgFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A imagem é renderizada no HTML do servidor e o navegador começa a carregá-la ANTES da
    // hidratação anexar o `onError` — uma falha rápida (ex.: 404) passa despercebida pelo
    // listener. Checa no mount se ela já falhou (naturalWidth 0 num <img> "completo").
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setImgFailed(true);
  }, [lot.image]);
  // Linha padrão de identificação da IA (Artista — Álbum (Ano)), quando houver.
  const aiLabel = album ? formatAiAlbum(album, market?.year) : "";
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
      {/* Relação com a Coleção: ícone no canto DIREITO, logo ABAIXO da nota da IA. Aparece em
          TODO card — CINZA quando não há relação; ROXO quando confirmada; ROXO + "?" quando
          incerta/sugerida. Clicar abre o painel para ver o disco, desfazer ou criar a relação. */}
      {(() => {
        const confident = owned != null && owned.score >= OWNED_CONFIDENT_MIN;
        const tip = !owned
          ? "Relação com a Coleção — toque para ver/definir"
          : confident
            ? `Já tenho na Coleção${owned.label ? `: ${owned.label}` : ""}`
            : `Provável: já tenho na Coleção${owned.label ? `: ${owned.label}` : ""} — toque para confirmar`;
        const tone = !owned ? "bg-zinc-500/80" : "bg-purple-600";
        return (
          <div className="absolute right-2 top-9 z-10">
            <button
              type="button"
              onClick={onOpenOwned}
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-1 text-white shadow ${tone}`}
              title={tip}
              aria-label={tip}
            >
              <Disc3 className="h-3.5 w-3.5" />
              {owned && !confident ? (
                <span className="text-[10px] font-bold leading-none">?</span>
              ) : null}
            </button>
          </div>
        );
      })()}
      {/* Nº do lote no canto superior ESQUERDO, espelhando a nota da IA (canto direito).
          Visão padrão de todos os cards. */}
      {lot.lote ? (
        <div className="absolute left-2 top-2 z-10">
          <span
            className="rounded-full bg-secondary px-2 py-0.5 text-xs font-bold text-foreground shadow"
            title="Nº do lote"
          >
            Lote {lot.lote}
          </span>
        </div>
      ) : null}
      <a href={lot.url} target="_blank" rel="noreferrer" className="block bg-secondary">
        {lot.image && !imgFailed ? (
          <img
            ref={imgRef}
            src={lot.image}
            alt={lot.title}
            loading="lazy"
            className="h-44 w-full object-contain p-2"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
            sem imagem
          </div>
        )}
      </a>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Artista/álbum da IA (mais acertivo) em destaque; o título original vira
            linha secundária. Sem identificação, mostra só o título como antes. */}
        {aiLabel ? (
          <div>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
              {aiLabel}
            </p>
            {/* Título original: alguns leiloeiros colocam a descrição INTEIRA do lote aqui (o
                site guarda o texto completo no atributo de tooltip do card) — em vez de cortar
                com reticências, damos 2 linhas de altura e deixamos rolar para ler o resto. */}
            <div className="h-8 overflow-y-auto text-xs leading-snug text-muted-foreground">
              {lot.title}
            </div>
          </div>
        ) : (
          <div className="h-10 overflow-y-auto text-sm leading-snug text-foreground">
            {lot.title}
          </div>
        )}
        {ai?.tags?.length ? <LotTags tags={ai.tags} onEdit={onEditTags} /> : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          {/* Demanda (visualizações · lances) do catálogo — sinaliza lote "quente". */}
          {demand && (demand.views != null || demand.bids != null) ? (
            <span
              className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground"
              title="Demanda: visualizações · lances"
            >
              {demand.views != null ? `👁 ${demand.views}` : ""}
              {demand.views != null && demand.bids != null ? " · " : ""}
              {demand.bids != null ? `🔨 ${demand.bids}` : ""}
            </span>
          ) : null}
          {/* Estado de conservação (Disco/Capa/Faixa/encarte) numa linha própria. */}
          {condition && (condition.media || condition.sleeve || condition.insert !== null) ? (
            <>
              <span className="w-full" aria-hidden="true" />
              <ConditionBadges condition={condition} />
            </>
          ) : null}
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

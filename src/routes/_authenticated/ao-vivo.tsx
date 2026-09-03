import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Radio, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PresencialAuction } from "@/lib/leiloesbr-auctions.server";
import { getTodayAuctions } from "@/lib/leiloesbr.functions";

export const Route = createFileRoute("/_authenticated/ao-vivo")({
  head: () => ({ meta: [{ title: "Leilões ao vivo — Garimpo de Vinil" }] }),
  component: AoVivoPage,
});

const STATUS: Record<
  PresencialAuction["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  live: { label: "Ao vivo agora", variant: "default" },
  upcoming: { label: "Em breve", variant: "secondary" },
  ended: { label: "Encerrado", variant: "outline" },
};

/** Ponto pulsante do estado "ao vivo" (mesmo visual da seção "Acontecendo agora"). */
function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
    </span>
  );
}

function AuctionCard({ auction }: { auction: PresencialAuction }) {
  const [showFrame, setShowFrame] = useState(false);
  const status = STATUS[auction.status];
  // Link para acompanhar: pregão presencial da casa; se não existir, o site da casa.
  const watchUrl = auction.presencialUrl ?? auction.entryUrl ?? auction.houseUrl ?? "#";

  return (
    <div className="flex flex-col rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{auction.house}</p>
        <Badge variant={status.variant} className="shrink-0 gap-1.5">
          {auction.status === "live" ? <LiveDot /> : null}
          {status.label}
        </Badge>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Início {auction.time}
        {auction.uf ? ` · ${auction.uf}` : ""} · {auction.lotCount} lote(s) de vinil
      </p>

      {auction.sampleTitles.length ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">
          {auction.sampleTitles.join(" · ")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" asChild>
          <a href={watchUrl} target="_blank" rel="noreferrer">
            <Radio className="mr-2 h-4 w-4" />
            Acompanhar ao vivo
          </a>
        </Button>
        {auction.presencialUrl ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowFrame((v) => !v)}
            title="Tentar abrir o pregão dentro do app (a casa pode bloquear)"
          >
            {showFrame ? <X className="mr-2 h-4 w-4" /> : <ExternalLink className="mr-2 h-4 w-4" />}
            {showFrame ? "Fechar prévia" : "Abrir aqui"}
          </Button>
        ) : null}
      </div>

      {showFrame && auction.presencialUrl ? (
        <div className="mt-3">
          <div className="overflow-hidden rounded-md border border-border">
            <iframe
              src={auction.presencialUrl}
              title={`Pregão ao vivo — ${auction.house}`}
              className="h-[420px] w-full bg-background"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Prévia em branco? A casa bloqueia a incorporação —{" "}
            <a
              href={auction.presencialUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              abrir em nova aba
            </a>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AoVivoPage() {
  const fetchToday = useServerFn(getTodayAuctions);
  const query = useQuery({
    queryKey: ["vinyl-today-auctions"] as const,
    queryFn: () => fetchToday(),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const auctions = query.data ?? [];
  const liveCount = auctions.filter((a) => a.status === "live").length;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6">
          <div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Link>
              </Button>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                <Radio className="h-5 w-5 text-primary" />
                Leilões ao vivo
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pregões de vinil de hoje, por casa. Acompanhe o pregão presencial ao vivo — mesmo os
              que ainda não começaram.
              {liveCount ? ` ${liveCount} acontecendo agora.` : ""}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            title="Atualizar a lista de hoje"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : auctions.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {auctions.map((auction) => (
              <AuctionCard key={auction.idLeilao} auction={auction} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center">
            <Radio className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-foreground">Nenhum leilão de vinil hoje.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Assim que uma casa tiver pregão de vinil na data de hoje, ele aparece aqui.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

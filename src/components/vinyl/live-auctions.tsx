import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Radio } from "lucide-react";

import { getLiveAuctions } from "@/lib/leiloesbr.functions";

/** Leilões que já começaram (somem da listagem pública) e tinham lotes de vinil. */
export function LiveAuctions() {
  const fetchLive = useServerFn(getLiveAuctions);
  const live = useQuery({
    queryKey: ["vinyl-live-auctions"] as const,
    queryFn: () => fetchLive(),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const auctions = live.data ?? [];
  if (!auctions.length) return null;

  return (
    <section className="mb-8 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
          Acontecendo agora
        </h2>
        <span className="text-xs text-muted-foreground">
          {auctions.length} leilão(ões) com vinil já iniciados
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {auctions.map((auction) => (
          <a
            key={auction.idLeilao}
            href={auction.presencialUrl ?? auction.entryUrl ?? auction.houseUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            title="Acompanhar o pregão presencial desta casa"
            className="group flex flex-col justify-center gap-0.5 rounded-md border border-border bg-card px-3 py-2 transition hover:border-primary"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{auction.house}</p>
              <Radio className="h-4 w-4 shrink-0 text-primary" />
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate">
                Início {auction.time}
                {auction.uf ? ` · ${auction.uf}` : ""} · {auction.lotCount} lote(s)
              </span>
              <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

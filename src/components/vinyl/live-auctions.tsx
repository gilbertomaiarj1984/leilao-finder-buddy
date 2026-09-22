import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ExternalLink, Gavel, Radio } from "lucide-react";
import { useState } from "react";

import type { PresencialAuction } from "@/lib/leiloesbr-auctions.server";
import { getLiveAuctions, getPresencialNow } from "@/lib/leiloesbr.functions";

/**
 * Linha "Início hh:mm · UF · N lote(s)" da casa — trocada pelo lote em pregão agora (nº +
 * barra "peça x de y · %", como o `LiveLotNow` de `badges.tsx`/`ao-vivo.tsx`) assim que a
 * consulta carrega, sem trocar de linha nem de altura do card (mesma `queryKey`, deduplicada
 * com o selo das outras telas).
 */
function HouseInfoLine({ auction }: { auction: PresencialAuction }) {
  const fetchNow = useServerFn(getPresencialNow);
  const url = auction.presencialUrl;
  const query = useQuery({
    queryKey: ["presencial-now", url ?? ""] as const,
    queryFn: () => fetchNow({ data: { url: url! } }),
    enabled: Boolean(url),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const now = query.data;
  if (!now) {
    return (
      <span className="truncate">
        Início {auction.time}
        {auction.uf ? ` · ${auction.uf}` : ""} · {auction.lotCount} lote(s)
      </span>
    );
  }

  const title = `Lote em pregão agora${
    now.peca && now.total ? ` — peça nº ${now.peca} de ${now.total}` : ""
  }`;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={title}>
      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
        <Gavel className="h-3 w-3" />
        Lote {now.lote}
      </span>
      {now.pct !== null ? (
        <span className="flex min-w-0 items-center gap-1 truncate tabular-nums">
          <span
            className="relative h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-yellow-500"
              style={{ width: `${now.pct}%` }}
            />
          </span>
          {now.peca}/{now.total} · {now.pct}%
        </span>
      ) : null}
    </span>
  );
}

/** Leilões que já começaram (somem da listagem pública) e tinham lotes de vinil. */
export function LiveAuctions() {
  const [open, setOpen] = useState(false);
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
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
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                <HouseInfoLine auction={auction} />
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

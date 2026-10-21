import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { TracklistHover } from "@/components/vinyl/tracklist-hover";
import { fmtMoney, formatAiAlbum } from "@/lib/lot-score";
import { buildEvidence, type EvidenceTone } from "@/lib/analise-evidence";
import type { LotEconomics } from "@/lib/lot-score";
import { analyticsGroupSearch, type PastSales } from "@/lib/past-sales";
import type { LotInsight } from "@/lib/use-lot-insights";
import { lotOpenUrl, type VinylLot } from "@/lib/vinyl-parse";
import { OWNED_CONFIDENT_MIN } from "@/lib/wantlist-match";

import { PriceRangeBar } from "./price-range-bar";

const DOT: Record<EvidenceTone, string> = {
  good: "bg-green-500",
  warn: "bg-yellow-400",
  bad: "bg-red-500",
  none: "bg-muted-foreground/30",
};

/** Painel "Por que esta nota": evidências, a conta do lance, vendas passadas e faixas. */
export function LotDetail({
  lot,
  insight,
  eco,
  past,
}: {
  lot: VinylLot;
  insight: LotInsight;
  eco: LotEconomics;
  past: PastSales | null;
}) {
  const { ai, market, condition, owned, lookout, houseLevel } = insight;
  const evidence = buildEvidence({
    rarity: ai?.rarity ?? null,
    eco,
    media: condition.media,
    sleeve: condition.sleeve,
    insert: condition.insert,
    past,
    want: market?.want ?? null,
    have: market?.have ?? null,
    house: lot.house,
    houseLevel,
    lookout: Boolean(lookout),
    interest: Boolean(ai?.matchesInterests),
    owned,
    ownedConfidentMin: OWNED_CONFIDENT_MIN,
  });
  const brl = (n: number | null) => fmtMoney(n, "BRL");
  const aiLabel = insight.album ? formatAiAlbum(insight.album, market?.year ?? null) : "";
  return (
    <div className="grid gap-4 border-t border-dashed border-border bg-card p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Por que esta nota
        </h4>
        <ul className="space-y-1">
          {evidence.map((e) => (
            <li key={e.text} className="flex items-baseline gap-2 text-[13px]">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[e.tone]}`} aria-hidden />
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
        {ai?.reason ? (
          <p className="mt-2 text-xs italic text-muted-foreground">“{ai.reason}”</p>
        ) : null}
        {ai?.evalPrice ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Nota dada com o lote a {brl(ai.evalPrice)}.
          </p>
        ) : null}
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          A conta do lance
        </h4>
        {eco.ref !== null ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
            <dt className="text-muted-foreground">Lance atual</dt>
            <dd className="text-right font-medium">{lot.price || "—"}</dd>
            <dt className="text-muted-foreground">+ frete estimado ({lot.uf || "UF ?"})</dt>
            <dd className="text-right font-medium">{brl(market?.freight ?? 0)}</dd>
            <dt className="text-muted-foreground">Custo total</dt>
            <dd className="text-right font-semibold">{brl(eco.total)}</dd>
            <dt className="text-muted-foreground">Mercado ({condition.media ?? "G+"})</dt>
            <dd className="text-right font-medium">{brl(eco.ref)}</dd>
            <dt className="text-muted-foreground">Teto para ainda ser barato</dt>
            <dd className="text-right font-semibold text-green-700 dark:text-green-400">
              {brl(eco.capCheap)}
            </dd>
            <dt className="text-muted-foreground">Teto para ainda ser justo</dt>
            <dd className="text-right font-medium">{brl(eco.capFair)}</dd>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sem preço de referência no Discogs para este disco.
          </p>
        )}
        {past && eco.total !== null ? (
          <div className="mt-2">
            <PriceRangeBar total={eco.total} past={past} />
            <Link
              to="/vinil-analytics"
              search={analyticsGroupSearch(past)}
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              title={`Abre «${past.artist} — ${past.album}» no Analytics`}
            >
              ver no Analytics <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : null}
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Faixas e links
        </h4>
        <div className="flex items-center gap-2 text-[13px]">
          <TracklistHover
            hasTracklist={ai?.hasTracklist}
            title={aiLabel || undefined}
            lotId={lot.id}
          />
          <span className="text-muted-foreground">
            {ai?.hasTracklist ? "tracklist com a fama de cada faixa" : "sem tracklist ainda"}
          </span>
        </div>
        <a
          href={lotOpenUrl(lot.url, lot.title, lot.lote)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Abrir o lote no site da casa <ExternalLink className="h-3 w-3" />
        </a>
      </section>
    </div>
  );
}

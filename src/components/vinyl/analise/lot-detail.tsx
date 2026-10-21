import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { TracklistHover } from "@/components/vinyl/tracklist-hover";
import { fmtMoney, formatAiAlbum } from "@/lib/lot-score";
import { buildEvidence, type EvidenceTone } from "@/lib/analise-evidence";
import type { Garimpo, LotEconomics } from "@/lib/lot-score";
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
  garimpo,
}: {
  lot: VinylLot;
  insight: LotInsight;
  eco: LotEconomics;
  past: PastSales | null;
  garimpo: Garimpo;
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
    trashLike: insight.possibleTrash?.excludedTitle ?? null,
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
        <h4 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Índice de garimpo: {garimpo.index}
          <span className="ml-1 font-normal normal-case tracking-normal">(experimental)</span>
        </h4>
        <ul className="space-y-1">
          {garimpo.parts.map((p) => (
            <li key={p.key} className="grid grid-cols-[1fr_72px_auto] items-center gap-2 text-xs">
              <span className={p.known ? "" : "text-muted-foreground"}>
                {p.label} <span className="text-muted-foreground">· peso {p.weight}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                <span
                  className={`block h-full rounded-full ${p.known ? "bg-primary" : "bg-muted-foreground/40"}`}
                  style={{ width: `${Math.round(p.value * 100)}%` }}
                />
              </span>
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {p.known ? `${Math.round(p.value * 100)}%` : "sem dado"}
              </span>
            </li>
          ))}
        </ul>
        {garimpo.ownedPenalty ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Já está na sua Coleção: o índice vale metade.
          </p>
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
            <dt className="text-muted-foreground">Valor do lote</dt>
            <dd className="text-right font-semibold">{brl(eco.total)}</dd>
            <dt className="text-xs text-muted-foreground">
              frete estimado do leilão ({lot.uf || "UF ?"}), fora da conta
            </dt>
            <dd className="text-right text-xs text-muted-foreground">{brl(eco.freight)}</dd>
            <dt className="text-xs text-muted-foreground">
              comissão do leiloeiro (5%), fora da conta
            </dt>
            <dd className="text-right text-xs text-muted-foreground">{brl(eco.commission)}</dd>
            {eco.refShipping > 0 ? (
              <>
                <dt className="text-muted-foreground">
                  Discogs: disco ({condition.media ?? "G+"})
                </dt>
                <dd className="text-right font-medium">{brl(eco.ref - eco.refShipping)}</dd>
                <dt className="text-muted-foreground">Discogs: + frete do vendedor</dt>
                <dd className="text-right font-medium">{brl(eco.refShipping)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Discogs com frete</dt>
            <dd className="text-right font-semibold">{brl(eco.ref)}</dd>
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

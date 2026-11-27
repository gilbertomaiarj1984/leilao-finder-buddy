import { ExternalLink, Gavel, Radio, Star } from "lucide-react";

import { AuctionStatusInline } from "@/components/vinyl/badges";
import {
  catalogAuctionInfo,
  type HouseAuctionInfo,
  type WatchedCatalog,
  type WatchedHouse,
} from "@/components/vinyl/grouping";
import { HouseLight } from "@/components/vinyl/house-light";
import { HouseUf } from "@/components/vinyl/house-uf";
import { usePresencialNowMap } from "@/components/vinyl/use-presencial-now";
import type { PresencialNow } from "@/lib/presencial-now";
import { bidIsWinning, lotOpenUrl } from "@/lib/vinyl-parse";
import {
  etaMinutes,
  followTone,
  lotDistance,
  splitArtistAlbum,
  timelineLayout,
  type FollowTone,
} from "@/lib/follow";

import type { DashboardData } from "./use-dashboard-data";

type FollowLot = DashboardData["watchedList"][number];

const TONE_TEXT: Record<FollowTone, string> = {
  near: "text-red-500",
  mid: "text-yellow-500",
  far: "text-green-500",
  none: "text-muted-foreground",
};
const TONE_PIN: Record<FollowTone, string> = {
  near: "bg-red-500",
  mid: "bg-yellow-500",
  far: "bg-green-500",
  none: "bg-muted-foreground",
};

// Duas cores que alternam entre as casas (nenhuma das cores de status: verde/vermelho/amarelo).
const HOUSE_TONES = [
  { box: "border-stone-500/60", head: "bg-stone-500/15" },
  { box: "border-sky-500/50", head: "bg-sky-500/15" },
] as const;

function FollowCatalogBlock({
  d,
  house,
  houseUrl,
  catalog,
  index,
  info,
  now,
}: {
  d: DashboardData;
  house: string;
  houseUrl: string;
  catalog: WatchedCatalog<FollowLot>;
  index: number;
  info: HouseAuctionInfo | null;
  now: PresencialNow | null;
}) {
  const tone = HOUSE_TONES[index % HOUSE_TONES.length]!;
  const total = now?.total ?? null;
  const pct = now?.pct ?? null;
  const layout =
    now && total
      ? timelineLayout(
          catalog.lots.map((l) => l.lote),
          { lote: now.lote, peca: now.peca, total },
        )
      : null;

  return (
    <section className={`overflow-hidden rounded-lg border-2 ${tone.box}`}>
      <div className={`space-y-2 px-3 py-2.5 ${tone.head}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-foreground/90 text-xs font-bold text-background">
            {index + 1}
          </span>
          <span className="text-base font-semibold text-foreground">{house}</span>
          <HouseUf house={house} />
          <HouseLight house={house} idLeilao={catalog.idLeilao} />
          <AuctionStatusInline info={info} />
          <div className="ml-auto flex items-center gap-3 text-xs">
            {info?.presencialUrl && info.status !== "ended" ? (
              <a
                className="inline-flex min-h-8 items-center gap-1 font-medium text-primary hover:underline"
                href={info.presencialUrl}
                target="_blank"
                rel="noreferrer"
                title="Abrir o pregão ao vivo desta casa"
              >
                <Radio className="h-3.5 w-3.5" /> pregão ao vivo
              </a>
            ) : null}
            <a
              className="inline-flex min-h-8 items-center text-primary hover:underline"
              href={info?.catalogUrl ?? houseUrl}
              target="_blank"
              rel="noreferrer"
            >
              ver catálogo
            </a>
          </div>
        </div>
        {now && total ? (
          <div className="space-y-1">
            <div className="relative h-2.5 rounded bg-muted/60">
              <div
                className="absolute inset-y-0 left-0 rounded bg-yellow-700/60"
                style={{ width: `${layout?.progressPct ?? pct ?? 0}%` }}
              />
              {layout?.endPct != null ? (
                <span
                  className="absolute -inset-y-0.5 w-px bg-muted-foreground/70"
                  style={{ left: `${layout.endPct}%` }}
                  title="Fim da sequência de hoje — os itens à direita são de outro dia"
                  aria-hidden
                />
              ) : null}
              {layout?.pins.map(({ index, pct: left }) => {
                const lot = catalog.lots[index]!;
                const dist = lotDistance(lot.lote, now!.lote);
                return (
                  <span
                    key={lot.id}
                    title={`Lote ${lot.lote}`}
                    className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${TONE_PIN[followTone(dist)]}`}
                    style={{ left: `${left}%` }}
                  />
                );
              })}
              <span
                className="absolute -inset-y-1 w-0.5 bg-primary"
                style={{ left: `${layout?.progressPct ?? pct ?? 0}%` }}
                aria-hidden
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pregão no lote {now.lote} · peça {now.peca}/{total}
              {pct !== null ? ` (${pct}%)` : ""}
            </p>
          </div>
        ) : null}
      </div>
      <div className="grid gap-1.5 p-2 sm:grid-cols-2">
        {catalog.lots.map((lot) => {
          const dist = now ? lotDistance(lot.lote, now.lote) : null;
          const toneKey = followTone(dist);
          const eta =
            now && info && dist !== null
              ? etaMinutes({
                  dayKey: info.dayKey,
                  time: catalog.time,
                  peca: now.peca,
                  distance: dist,
                })
              : null;
          const bidStatus = d.bidStatusById.get(lot.idPeca);
          const winning = !!bidStatus && bidIsWinning(bidStatus);
          // Artista e álbum em linhas separadas (o título costuma vir "Artista - Álbum").
          const { artist, album } = splitArtistAlbum(lot.artist, d.albumFor(lot) ?? lot.title);
          return (
            <div
              key={lot.id}
              id={`follow-${lot.id}`}
              className={`flex min-w-0 scroll-mt-24 items-center gap-1.5 rounded-md border bg-card p-1.5 ${
                !bidStatus
                  ? "border-yellow-500 ring-1 ring-yellow-500/40"
                  : winning
                    ? "border-green-500 ring-1 ring-green-500/40"
                    : "border-red-500 ring-1 ring-red-500/40"
              }`}
            >
              {lot.image ? (
                <img
                  src={lot.image}
                  alt=""
                  loading="lazy"
                  className="h-11 w-11 shrink-0 rounded bg-secondary object-contain"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded bg-secondary" />
              )}
              <div className="min-w-0 flex-1 text-[10px] leading-[13px]" title={lot.title}>
                <p className="truncate text-[11px] font-semibold text-foreground">
                  {artist || album}
                </p>
                {artist ? <p className="truncate text-foreground/90">{album}</p> : null}
                <p className="truncate text-muted-foreground">
                  <span className="font-semibold text-foreground/80">#{lot.lote}</span> ·{" "}
                  {d.currentPriceFor(lot.id, lot.price) || "sem valor"}
                  {bidStatus ? (
                    <span className={winning ? " text-green-500" : " text-red-500"}>
                      {" "}
                      · {bidStatus}
                    </span>
                  ) : null}
                </p>
              </div>
              <div
                className={`shrink-0 text-right text-[11px] font-bold leading-tight ${TONE_TEXT[toneKey]}`}
              >
                {dist === null ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {info?.status === "ended"
                      ? "encerrado"
                      : info?.time
                        ? `começa ${info.time}`
                        : ""}
                  </span>
                ) : dist <= 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Gavel className="h-3.5 w-3.5" /> agora
                  </span>
                ) : (
                  <>
                    faltam {dist}
                    {eta ? (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        ~{eta} min
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <a
                href={lotOpenUrl(lot.url, lot.title, lot.lote)}
                target="_blank"
                rel="noreferrer"
                title="Abrir o lote no site da casa"
                aria-label="Abrir o lote no site da casa"
                className="grid h-8 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => d.toggleFollow(lot.id)}
                title="Parar de acompanhar"
                aria-label="Parar de acompanhar"
                className="grid h-8 w-7 shrink-0 place-items-center rounded hover:bg-secondary"
              >
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Painel "Acompanhando" no topo da aba Vigiados: os lotes marcados com ★, agrupados por
 * casa/catálogo, com o pregão em andamento (lote atual, barra, trilho com os seus itens) e a
 * distância de cada item até chegar. As casas alternam duas cores para separar os blocos.
 */
export function FollowPanel({
  d,
  houses,
}: {
  d: DashboardData;
  houses: WatchedHouse<FollowLot>[];
}) {
  const blocks = houses.flatMap((h) =>
    h.catalogs.map((catalog) => ({
      house: h.house,
      houseUrl: h.houseUrl,
      catalog,
      info: catalogAuctionInfo(catalog),
    })),
  );
  // Só consulta o lote em pregão das casas que estão ao vivo agora.
  const liveUrls = [
    ...new Set(
      blocks.flatMap((b) =>
        b.info?.status === "live" && b.info.presencialUrl ? [b.info.presencialUrl] : [],
      ),
    ),
  ];
  const nowByUrl = usePresencialNowMap(liveUrls);
  const count = blocks.reduce((n, b) => n + b.catalog.lots.length, 0);
  if (count === 0) return null;
  const nowOf = (b: (typeof blocks)[number]): PresencialNow | null =>
    b.info?.status === "live" && b.info.presencialUrl
      ? (nowByUrl.get(b.info.presencialUrl) ?? null)
      : null;
  // Faixa de "pílulas" (lê num relance no celular): distância de cada item, do mais perto ao mais longe.
  const pills = blocks
    .flatMap((b, i) => {
      const now = nowOf(b);
      return b.catalog.lots.map((lot) => ({
        lot,
        blockIndex: i + 1,
        dist: now ? lotDistance(lot.lote, now.lote) : null,
      }));
    })
    .sort((a, b) => (a.dist === null ? 1 : b.dist === null ? -1 : a.dist - b.dist));
  return (
    <section className="space-y-3 rounded-xl border border-primary/50 bg-card/40 p-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        Acompanhando ({count})
      </h2>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Distância dos itens">
        {pills.map(({ lot, blockIndex, dist }) => {
          const tone = followTone(dist);
          return (
            <button
              key={lot.id}
              type="button"
              onClick={() =>
                document
                  .getElementById(`follow-${lot.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
              className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl border bg-card px-2.5 py-1 ${
                tone === "near" ? "animate-pulse border-red-500" : "border-border"
              }`}
              title={`Lote ${lot.lote} — ${lot.house}`}
            >
              <span className={`text-xl font-extrabold leading-tight ${TONE_TEXT[tone]}`}>
                {dist === null ? "—" : dist <= 0 ? "JÁ" : dist}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {blockIndex} · #{lot.lote}
              </span>
            </button>
          );
        })}
      </div>
      <div className="space-y-4">
        {blocks.map((b, i) => (
          <FollowCatalogBlock
            key={`${b.house}|${b.catalog.idLeilao}`}
            d={d}
            house={b.house}
            houseUrl={b.houseUrl}
            catalog={b.catalog}
            index={i}
            info={b.info}
            now={nowOf(b)}
          />
        ))}
      </div>
    </section>
  );
}

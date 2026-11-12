import { ArrowLeft, ChevronDown, ChevronRight, PackageOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AuctionStore } from "@/components/vinyl/auction-store";
import { AuctionStatusInline, HouseStatBadges } from "@/components/vinyl/badges";
import { computeHouseStats, matchesStatFilter, sortByLote } from "@/components/vinyl/grouping";
import { HouseLight } from "@/components/vinyl/house-light";
import { HouseUf } from "@/components/vinyl/house-uf";
import { setCodec, usePersistedState } from "@/lib/persisted-state";
import { lotOpenUrl, normalizeForMatch, type VinylLot } from "@/lib/vinyl-parse";

import { countUnsoldHouses, type TodayUnsoldHouse, type UnsoldLotItem } from "../use-today-unsold";
import { AuctionHeaderActions } from "./auction-header-actions";
import { DashboardLotCard } from "./dashboard-lot-card";
import type { DashboardData } from "./use-dashboard-data";

/** Card compacto de um lote sem lance — mesmo espírito visual do `LotCard` (imagem + badge do
 * nº do lote + título). Clicar abre o cartão completo do lote (`onOpen`); sem o lote completo
 * (`onOpen` ausente) cai no link do lote na casa. `fresh` destaca o lote recém-achado. */
function UnsoldLotCard({
  lot,
  fresh,
  onOpen,
}: {
  lot: UnsoldLotItem;
  fresh: boolean;
  onOpen?: () => void;
}) {
  const className = `group relative flex flex-col overflow-hidden rounded-md border bg-card text-left transition hover:border-primary ${
    fresh ? "border-emerald-500 ring-2 ring-emerald-500/30" : "border-border"
  }`;
  const body = (
    <>
      {lot.lote ? (
        <span className="absolute left-2 top-2 z-10 max-w-[5rem] truncate rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground shadow">
          Lote {lot.lote}
        </span>
      ) : null}
      <div className="relative h-28 w-full overflow-hidden bg-secondary">
        {lot.image ? (
          <img
            src={lot.image}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
            sem imagem
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {lot.artist ? (
          <p className="truncate text-xs font-medium text-foreground">{lot.artist}</p>
        ) : null}
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{lot.title}</p>
        {lot.price ? (
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{lot.price}</p>
        ) : null}
      </div>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={className}>
      {body}
    </button>
  ) : (
    <a
      href={lotOpenUrl(lot.url, lot.title, lot.lote)}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {body}
    </a>
  );
}

/** Ids de lotes que chegaram DEPOIS da primeira carga — ficam "novos" por alguns segundos. */
function useFreshIds(ids: string[]): Set<string> {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids.join("|");
  useEffect(() => {
    if (!ids.length && known.current === null) return;
    if (known.current === null) {
      known.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !known.current!.has(id));
    if (!added.length) return;
    for (const id of added) known.current.add(id);
    setFresh((cur) => new Set([...cur, ...added]));
    const timer = setTimeout(
      () =>
        setFresh((cur) => {
          const next = new Set(cur);
          for (const id of added) next.delete(id);
          return next;
        }),
      3000,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume `ids`
  }, [key]);
  return fresh;
}

/**
 * Visão "Lotes sem lance" do dia de hoje (ícone ao lado de Hoje na barra de dias). Uma seção por
 * casa com pregão encerrado ou em andamento; nas casas ao vivo os lotes vão entrando conforme
 * forem passando no pregão sem lance (`useTodayUnsold`).
 *
 * As casas começam FECHADAS; o que o usuário abriu e a busca ficam salvos no navegador (por dia),
 * então ao voltar à tela ela está como foi deixada (a rolagem é salva pela home). O cabeçalho da
 * casa/pregão reusa as mesmas peças das outras telas (semáforo, loja, selos de vigia/lance,
 * horário/status, lista, pregão presencial) e clicar num lote abre o cartão completo (`LotCard`).
 */
export function UnsoldView({
  d,
  houses,
  dayKey,
  dayLabel,
  onBack,
}: {
  d: DashboardData;
  houses: TodayUnsoldHouse[];
  dayKey: string;
  dayLabel: string;
  onBack: () => void;
}) {
  const [query, setQuery] = usePersistedState("home-unsold-query", "");
  const [opened, setOpened] = usePersistedState<Set<string>>(
    "home-unsold-open",
    new Set(),
    setCodec,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const fresh = useFreshIds(houses.flatMap((h) => h.lots.map((l) => l.idPeca)));
  const q = normalizeForMatch(query.trim());
  const { watchedIds, bidStatusById, statFilter, toggleStatFilter } = d;

  // Lote completo (linha de `lots`) de cada item sem lance — é ele que alimenta o cartão aberto,
  // os selos de vigia/lance e a "lista" do cabeçalho.
  const fullByKey = useMemo(() => {
    const map = new Map<string, VinylLot>();
    for (const lot of d.lots.data?.lots ?? []) map.set(`${lot.idLeilao}|${lot.idPeca}`, lot);
    return map;
  }, [d.lots.data]);
  const fullOf = (h: TodayUnsoldHouse, lot: UnsoldLotItem) =>
    fullByKey.get(`${h.idLeilao}|${lot.idPeca}`) ?? null;
  const selectedLot = selected ? (fullByKey.get(selected) ?? null) : null;

  const visible = houses
    .filter((h) => h.lots.length > 0 || h.loading || h.status === "live")
    .map((h) => ({
      h,
      lots: h.lots.filter((l) => {
        if (
          statFilter.size > 0 &&
          !matchesStatFilter(l.idPeca, watchedIds, bidStatusById, statFilter)
        ) {
          return false;
        }
        return q
          ? normalizeForMatch(`${l.artist} ${l.title} ${l.lote ?? ""} ${h.house}`).includes(q)
          : true;
      }),
    }))
    .filter(({ lots, h }) => (!q && statFilter.size === 0) || lots.length > 0 || !h.lots.length);
  // Uma entrada por PREGÃO (`useTodayUnsold`); aqui agrupadas por casa, na ordem em que vieram.
  const byHouse = new Map<string, typeof visible>();
  for (const row of visible) {
    const list = byHouse.get(row.h.house) ?? [];
    list.push(row);
    byHouse.set(row.h.house, list);
  }
  const keyOf = (rest: string) => `${dayKey}|${rest}`;
  const toggle = (key: string) =>
    setOpened((cur) => {
      // Só guarda chaves do dia atual (as de dias antigos não servem mais).
      const next = new Set([...cur].filter((k) => k.startsWith(`${dayKey}|`)));
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const totalUnsold = houses.reduce((n, h) => n + h.lots.length, 0);
  const totalKnown = houses.reduce((n, h) => n + (h.total ?? 0), 0);

  return (
    <div className="space-y-4 rounded-lg border border-primary/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao dia
        </button>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <PackageOpen className="h-5 w-5 text-primary" /> Lotes sem lance · {dayLabel}
        </h2>
        <span className="text-xs text-muted-foreground">
          {countUnsoldHouses(houses)} casa(s) · {totalUnsold} lote(s) sem lance
          {totalKnown ? ` de ${totalKnown}` : ""}
        </span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar artista, título, casa, nº do lote…"
        aria-label="Buscar nos lotes sem lance"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
      />
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {q || statFilter.size > 0
            ? "Nenhum lote sem lance corresponde à busca."
            : "Nenhum lote sem lance encontrado ainda. Eles aparecem aqui conforme os pregões avançam."}
        </p>
      ) : null}
      {[...byHouse.entries()].map(([house, rows]) => {
        const first = rows[0]!.h;
        const multi = rows.length > 1;
        const houseKey = keyOf(multi ? `house|${house}` : first.idLeilao);
        const houseOpen = opened.has(houseKey);
        const houseUnsold = rows.reduce((n, r) => n + r.h.lots.length, 0);
        const fullLots = (row: (typeof rows)[number]) =>
          row.lots.flatMap((l) => {
            const full = fullOf(row.h, l);
            return full ? [full] : [];
          });
        // Casa com mais de um pregão no dia: cabeçalho da casa + um bloco "Catálogo N" por pregão
        // (mesmo desenho da listagem do dia e da aba Vigiados).
        const renderBody = (row: (typeof rows)[number]) => {
          const { h, lots } = row;
          return h.loading && !h.lots.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : lots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {h.status === "live"
                ? "Nenhum lote sem lance até agora. Eles aparecem aqui conforme forem achados."
                : "Todos os lotes desta casa tiveram lance."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {sortByLote(lots).map((lot) => {
                const full = fullOf(h, lot);
                return (
                  <UnsoldLotCard
                    key={lot.idPeca}
                    lot={lot}
                    fresh={fresh.has(lot.idPeca)}
                    onOpen={full ? () => setSelected(`${h.idLeilao}|${lot.idPeca}`) : undefined}
                  />
                );
              })}
            </div>
          );
        };
        const countLabel = (h: TodayUnsoldHouse) =>
          h.loading && !h.lots.length
            ? "buscando…"
            : h.total !== null
              ? `${h.lots.length} de ${h.total} sem lance`
              : `${h.lots.length} sem lance`;
        const liveHint = (h: TodayUnsoldHouse) =>
          h.status === "live" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              buscando…
            </span>
          ) : null;
        return (
          <section key={houseKey} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2">
              <button
                type="button"
                aria-expanded={houseOpen}
                onClick={() => toggle(houseKey)}
                className="flex items-center gap-2 text-left"
              >
                {houseOpen ? (
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-xl font-semibold tracking-tight">{house}</span>
              </button>
              <HouseUf house={house} uf={first.uf} className="text-sm" />
              <HouseLight house={house} />
              {multi ? null : <AuctionStore idLeilao={first.idLeilao} house={house} />}
              {multi ? <Badge variant="outline">{rows.length} catálogos</Badge> : null}
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-bold text-primary">
                {multi ? `${houseUnsold} sem lance` : countLabel(first)}
              </span>
              {multi ? null : (
                <>
                  <HouseStatBadges
                    stats={computeHouseStats(fullLots(rows[0]!), watchedIds, bidStatusById)}
                    active={statFilter}
                    onToggle={toggleStatFilter}
                  />
                  <AuctionStatusInline info={first.info} />
                  {liveHint(first)}
                  <AuctionHeaderActions
                    d={d}
                    house={house}
                    houseUrl={first.houseUrl}
                    info={first.info}
                    lots={fullLots(rows[0]!)}
                  />
                </>
              )}
            </div>
            {!houseOpen ? null : multi ? (
              <div className="space-y-6 border-l-2 border-border pl-3 sm:pl-5">
                {rows.map((row) => {
                  const catKey = keyOf(`cat|${row.h.idLeilao}`);
                  const catOpen = opened.has(catKey);
                  return (
                    <div key={row.h.idLeilao} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          aria-expanded={catOpen}
                          onClick={() => toggle(catKey)}
                          className="flex items-center gap-2 text-left"
                        >
                          {catOpen ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-base font-semibold text-foreground">
                            Catálogo {row.h.idLeilao}
                          </span>
                        </button>
                        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-bold text-primary">
                          {countLabel(row.h)}
                        </span>
                        <AuctionStore idLeilao={row.h.idLeilao} house={house} />
                        <HouseStatBadges
                          stats={computeHouseStats(fullLots(row), watchedIds, bidStatusById)}
                          active={statFilter}
                          onToggle={toggleStatFilter}
                        />
                        <AuctionStatusInline info={row.h.info} />
                        {liveHint(row.h)}
                        <AuctionHeaderActions
                          d={d}
                          house={`${house} · catálogo ${row.h.idLeilao}`}
                          houseUrl={row.h.houseUrl}
                          info={row.h.info}
                          lots={fullLots(row)}
                          linkLabel="ver catálogo"
                        />
                      </div>
                      {catOpen ? renderBody(row) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              renderBody(rows[0]!)
            )}
          </section>
        );
      })}
      <Dialog
        open={selectedLot != null}
        onOpenChange={(open) => (open ? undefined : setSelected(null))}
      >
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto p-3">
          <DialogTitle className="sr-only">Lote sem lance</DialogTitle>
          <DialogDescription className="sr-only">
            Cartão completo do lote, com avaliação da IA, mercado, estado e ações.
          </DialogDescription>
          {selectedLot ? <DashboardLotCard d={d} lot={selectedLot} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

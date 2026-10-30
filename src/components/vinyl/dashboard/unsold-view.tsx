import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, PackageOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HouseUf } from "@/components/vinyl/house-uf";
import { lotOpenUrl, normalizeForMatch } from "@/lib/vinyl-parse";

import { countUnsoldHouses, type TodayUnsoldHouse, type UnsoldLotItem } from "../use-today-unsold";

/** Card compacto de um lote sem lance — mesmo espírito visual do `LotCard` (imagem + badge do
 * nº do lote + título), sem os controles de vigiar/lance. `fresh` destaca o lote recém-achado. */
function UnsoldLotCard({ lot, fresh }: { lot: UnsoldLotItem; fresh: boolean }) {
  return (
    <a
      href={lotOpenUrl(lot.url, lot.title, lot.lote)}
      target="_blank"
      rel="noreferrer"
      className={`group relative flex flex-col overflow-hidden rounded-md border bg-card transition hover:border-primary ${
        fresh ? "border-emerald-500 ring-2 ring-emerald-500/30" : "border-border"
      }`}
    >
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
      </div>
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
 */
export function UnsoldView({
  houses,
  dayLabel,
  onBack,
}: {
  houses: TodayUnsoldHouse[];
  dayLabel: string;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const fresh = useFreshIds(houses.flatMap((h) => h.lots.map((l) => l.idPeca)));
  const q = normalizeForMatch(query.trim());

  const visible = houses
    .filter((h) => h.lots.length > 0 || h.loading || h.status === "live")
    .map((h) => ({
      h,
      lots: q
        ? h.lots.filter((l) =>
            normalizeForMatch(`${l.artist} ${l.title} ${l.lote ?? ""} ${h.house}`).includes(q),
          )
        : h.lots,
    }))
    .filter(({ lots, h }) => !q || lots.length > 0 || !h.lots.length);
  // Uma entrada por PREGÃO (`useTodayUnsold`); aqui agrupadas por casa, na ordem em que vieram.
  const byHouse = new Map<string, typeof visible>();
  for (const row of visible) {
    const list = byHouse.get(row.h.house) ?? [];
    list.push(row);
    byHouse.set(row.h.house, list);
  }
  const toggle = (key: string) =>
    setClosed((cur) => {
      const next = new Set(cur);
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
          {q
            ? "Nenhum lote sem lance corresponde à busca."
            : "Nenhum lote sem lance encontrado ainda. Eles aparecem aqui conforme os pregões avançam."}
        </p>
      ) : null}
      {[...byHouse.entries()].map(([house, rows]) => {
        const first = rows[0]!.h;
        const multi = rows.length > 1;
        const houseKey = multi ? `house|${house}` : first.idLeilao;
        const houseOpen = !closed.has(houseKey);
        const houseUnsold = rows.reduce((n, r) => n + r.h.lots.length, 0);
        // Casa com mais de um pregão no dia: cabeçalho da casa + um bloco "Catálogo N" por pregão
        // (mesmo desenho da listagem do dia e da aba Vigiados).
        const renderBody = ({ h, lots }: (typeof rows)[number]) => {
          const live = h.status === "live";
          return h.loading && !h.lots.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : lots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {live
                ? "Nenhum lote sem lance até agora. Eles aparecem aqui conforme forem achados."
                : "Todos os lotes desta casa tiveram lance."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {lots.map((lot) => (
                <UnsoldLotCard key={lot.idPeca} lot={lot} fresh={fresh.has(lot.idPeca)} />
              ))}
            </div>
          );
        };
        const countLabel = (h: TodayUnsoldHouse) =>
          h.total !== null
            ? `${h.lots.length} de ${h.total} sem lance`
            : `${h.lots.length} sem lance`;
        const statusLabel = (h: TodayUnsoldHouse) => {
          const live = h.status === "live";
          return (
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                live ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {live ? (
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              ) : null}
              {live ? "Ao vivo · buscando…" : "Encerrado"}
            </span>
          );
        };
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
              {multi ? <Badge variant="outline">{rows.length} catálogos</Badge> : null}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                {multi ? `${houseUnsold} sem lance` : countLabel(first)}
              </span>
              {multi ? null : statusLabel(first)}
              <a
                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                href={multi ? first.houseUrl : (first.catalogUrl ?? first.houseUrl)}
                target="_blank"
                rel="noreferrer"
              >
                site da casa <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {!houseOpen ? null : multi ? (
              <div className="space-y-6 border-l-2 border-border pl-3 sm:pl-5">
                {rows.map((row) => {
                  const catKey = `cat|${row.h.idLeilao}`;
                  const catOpen = !closed.has(catKey);
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
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                          {countLabel(row.h)}
                        </span>
                        {statusLabel(row.h)}
                        <a
                          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          href={row.h.catalogUrl ?? row.h.houseUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ver catálogo <ExternalLink className="h-3 w-3" />
                        </a>
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
    </div>
  );
}

// Linhas, marcadores e controles do Vinil Analytics (artista → álbum → vendas).

import { useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/persisted-state";
import type { DragEvent } from "react";

import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Disc3,
  EyeOff,
  ExternalLink,
  Layers,
  Pencil,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { scoreTone } from "@/components/vinyl/ai-score-utils";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import { useDragAutoScroll } from "@/components/vinyl/use-drag-autoscroll";
import {
  type AlbumAgg,
  type AnalyticsAliases,
  type ArtistAgg,
  type SaleRow,
} from "@/lib/analytics";
import { type Condition } from "@/lib/grading";
import {
  AlbumEditDialog,
  ArtistEditDialog,
  DetailDialog,
  SaleDetailDialog,
} from "./analytics-dialogs";
import {
  AlbumSort,
  ApplySaleOverride,
  ExcludeArtist,
  ExcludeSale,
  ReidentAllAlbums,
  ReidentGroup,
  SALE_DRAG_TYPE,
  SaleDragPayload,
  Suggestions,
  conditionFromSale,
  demandLabel,
  discountTip,
  feeTip,
  money,
  netCost,
} from "./analytics-shared";

// Componente COMPARTILHADO entre a página autenticada (`/vinil-analytics`, com curadoria/IA) e a
// pública somente-leitura (`/vinil-analytics-publico`, link com token diário — ver
// `access.server.ts`/`leiloesbr.functions.ts`). `readOnly=true` esconde TODO controle de
// mutação (editar/fundir artista ou álbum, corrigir/excluir venda, excluir artista,
// reidentificar por IA, seletor de provedor/modelo de IA) — só ordenação/filtro/expansão
// continuam ativos. `handlers`/`ai` são omitidos no modo público (só existem no modo editável).
/** Painel "Ocultos": lista artistas e vendas excluídos do Analytics, com ação de reincluir. Só no
 *  modo editável (é uma mutação — reincluir). */
export function HiddenPanel({
  aliases,
  onRestoreSale,
  onRestoreArtist,
}: {
  aliases: AnalyticsAliases | undefined;
  onRestoreSale: (lotId: string) => void;
  onRestoreArtist: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Artistas: de-dup por RÓTULO (guardamos key final + sourceKeys com o mesmo nome) — mostra um
  // item por artista, guardando uma chave representativa para reincluir.
  const artistItems = useMemo(() => {
    const byLabel = new Map<string, string>();
    for (const [key, label] of Object.entries(aliases?.excludedArtists ?? {})) {
      if (!byLabel.has(label)) byLabel.set(label, key);
    }
    return [...byLabel.entries()].map(([label, key]) => ({ label, key }));
  }, [aliases?.excludedArtists]);
  const saleItems = useMemo(
    () => Object.entries(aliases?.excludedSales ?? {}),
    [aliases?.excludedSales],
  );
  const total = artistItems.length + saleItems.length;
  if (!total) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-md border border-dashed border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:opacity-80"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-foreground">Ocultos do Analytics</span>
        <span className="text-xs text-muted-foreground">
          {artistItems.length} artista(s) · {saleItems.length} venda(s)
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {artistItems.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Artistas
              </span>
              {artistItems.map((it) => (
                <div
                  key={it.key}
                  className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  <span className="flex-1 truncate text-foreground">{it.label}</span>
                  <Button variant="ghost" size="sm" onClick={() => onRestoreArtist(it.key)}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    Reincluir
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {saleItems.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Vendas
              </span>
              {saleItems.map(([lotId, label]) => (
                <div
                  key={lotId}
                  className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  <span className="flex-1 truncate text-foreground" title={lotId}>
                    {label || lotId}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => onRestoreSale(lotId)}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    Reincluir
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded bg-secondary px-2 py-1 text-foreground">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-semibold">{value}</span>
    </span>
  );
}

/** Alternador compacto de ordenação (segmentado). */
export function SortToggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1">
      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-background"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function EmptyState() {
  return (
    <div className="rounded-md border border-border bg-card p-8 text-center">
      <Disc3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Ainda não há vendas no histórico.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        O histórico é preenchido automaticamente após os leilões (varredura do catálogo das casas).
        Conforme os leilões acompanhados terminam, os valores de venda aparecem aqui.
      </p>
    </div>
  );
}

/** Botão "rodar a IA" num escopo (artista/álbum): identifica pela IA só as vendas de `lotIds`. */
function IaButton({
  lotIds,
  onReident,
  title,
}: {
  lotIds: string[];
  onReident: ReidentGroup;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy || !lotIds.length) return;
    setBusy(true);
    void onReident(lotIds).finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || !lotIds.length}
      title={title}
      aria-label={title}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <Sparkles className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
    </button>
  );
}

/** Botão "rodar a IA em todos os álbuns" do artista: dispara `onReident` (a mesma rotina do
 *  botão de UM álbum) uma vez por álbum, em sequência — poupa o usuário de abrir álbum por
 *  álbum e clicar em cada um. */
function IaAllAlbumsButton({
  albums,
  onReident,
  title,
}: {
  albums: AlbumAgg[];
  onReident: ReidentAllAlbums;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (busy || !albums.length) return;
    setBusy(true);
    void onReident(albums).finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || !albums.length}
      title={title}
      aria-label={title}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <Layers className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
    </button>
  );
}

export function ArtistRow({
  artist,
  allArtists,
  suggestions,
  readOnly,
  onApplyArtist,
  onClearArtist,
  onApplyAlbum,
  onApplySaleOverride,
  onReidentGroup,
  onReidentAllAlbums,
  onExcludeArtist,
  onExcludeSale,
}: {
  artist: ArtistAgg;
  allArtists: ArtistAgg[];
  suggestions: Suggestions;
  readOnly: boolean;
  onApplyArtist?: (sourceKeys: string[], name: string) => void;
  onClearArtist?: () => void;
  onApplyAlbum?: (keys: string[], name: string) => void;
  onApplySaleOverride?: ApplySaleOverride;
  onReidentGroup?: ReidentGroup;
  onReidentAllAlbums?: ReidentAllAlbums;
  onExcludeArtist?: ExcludeArtist;
  onExcludeSale?: ExcludeSale;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [albumSort, setAlbumSort] = usePersistedState<AlbumSort>("analytics-album-sort", "count");
  const canEdit = !readOnly;

  const sortedAlbums = useMemo(() => {
    const list = [...artist.albums];
    if (albumSort === "alpha") list.sort((a, b) => a.album.localeCompare(b.album, "pt-BR"));
    else list.sort((a, b) => b.count - a.count || (b.avgPrice ?? 0) - (a.avgPrice ?? 0));
    return list;
  }, [artist.albums, albumSort]);

  // Todos os `lot_id`s do artista (para rodar a IA no artista inteiro).
  const artistLotIds = useMemo(
    () => artist.albums.flatMap((al) => al.sales.map((s) => s.lot_id)),
    [artist.albums],
  );

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 font-semibold text-foreground">{artist.artist}</span>
          <span className="text-xs text-muted-foreground">
            {artist.count} {artist.count === 1 ? "venda" : "vendas"} · {artist.albums.length}{" "}
            {artist.albums.length === 1 ? "álbum" : "álbuns"}
          </span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-semibold text-primary">
            {money(artist.avgPrice)}
          </span>
        </button>
        {canEdit && onReidentGroup ? (
          <IaButton
            lotIds={artistLotIds}
            onReident={onReidentGroup}
            title="Rodar a IA neste artista (identifica as vendas ainda sem álbum)"
          />
        ) : null}
        {canEdit && onReidentAllAlbums ? (
          <IaAllAlbumsButton
            albums={artist.albums}
            onReident={onReidentAllAlbums}
            title="Rodar a IA em cada álbum deste artista, um de cada vez (sem precisar abrir álbum por álbum)"
          />
        ) : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEdit(true)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Editar nome ou juntar com outro artista"
            aria-label="Editar artista"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          <div className="mb-2 flex justify-end">
            <SortToggle
              label="Álbuns"
              options={[
                { value: "count", label: "Nº na base" },
                { value: "alpha", label: "A→Z" },
              ]}
              value={albumSort}
              onChange={(v) => setAlbumSort(v as AlbumSort)}
            />
          </div>
          <div className="flex flex-col gap-2">
            {sortedAlbums.map((al) => (
              <AlbumRow
                key={al.key}
                album={al}
                artistKey={artist.key}
                artistName={artist.artist}
                siblings={artist.albums}
                suggestions={suggestions}
                readOnly={readOnly}
                onApplyAlbum={onApplyAlbum}
                onApplySaleOverride={onApplySaleOverride}
                onReidentGroup={onReidentGroup}
                onExcludeSale={onExcludeSale}
              />
            ))}
          </div>
        </div>
      ) : null}
      {canEdit && onApplyArtist && onClearArtist && onExcludeArtist ? (
        <ArtistEditDialog
          artist={artist}
          allArtists={allArtists}
          open={edit}
          onClose={() => setEdit(false)}
          onApply={onApplyArtist}
          onClear={onClearArtist}
          onExclude={() => onExcludeArtist(artist)}
        />
      ) : null}
    </section>
  );
}

function AlbumRow({
  album,
  artistKey,
  artistName,
  siblings,
  suggestions,
  readOnly,
  onApplyAlbum,
  onApplySaleOverride,
  onReidentGroup,
  onExcludeSale,
}: {
  album: AlbumAgg;
  artistKey: string;
  artistName: string;
  siblings: AlbumAgg[];
  suggestions: Suggestions;
  readOnly: boolean;
  onApplyAlbum?: (keys: string[], name: string) => void;
  onApplySaleOverride?: ApplySaleOverride;
  onReidentGroup?: ReidentGroup;
  onExcludeSale?: ExcludeSale;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [edit, setEdit] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const canEdit = !readOnly;
  const albumLotIds = useMemo(() => album.sales.map((s) => s.lot_id), [album.sales]);
  // Faixas do agregador vêm melhor→pior (ordem de FAIXAS). O eixo dos cards abaixo é
  // pior→melhor (esquerda = pior), então mostramos os chips no MESMO racional (pior→melhor).
  const faixasAsc = useMemo(() => [...album.faixas].reverse(), [album.faixas]);

  // Recebe o drop de um `SaleMarker` arrastado (ver `SALE_DRAG_TYPE`): move a venda para ESTE
  // álbum via a mesma correção manual por venda que o diálogo já usa (`onApplySaleOverride`) —
  // sem mutação nova, só um atalho de UI. Confere o artista (nunca move entre artistas
  // diferentes) e ignora se a venda já está neste álbum. Desativado em `readOnly`.
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!canEdit || !e.dataTransfer.types.includes(SALE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!canEdit || !e.dataTransfer.types.includes(SALE_DRAG_TYPE)) return;
    setDropHover(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropHover(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    setDropHover(false);
    if (!canEdit || !onApplySaleOverride) return;
    const raw = e.dataTransfer.getData(SALE_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    let payload: SaleDragPayload;
    try {
      payload = JSON.parse(raw) as SaleDragPayload;
    } catch {
      return;
    }
    if (payload.artist !== artistName) return; // nunca move entre artistas diferentes
    if (payload.album === album.album) return; // já está neste álbum
    onApplySaleOverride(payload.lotId, { artist: artistName, album: album.album });
  };

  return (
    <div className="rounded-md border border-border bg-background">
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center gap-2 px-3 py-2 transition-colors ${
          dropHover ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={open ? "Recolher" : "Expandir"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {/* O NOME do álbum abre a curadoria (renomear / juntar com outro álbum) — só editável. */}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEdit(true)}
            className="flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
            title="Editar nome ou juntar com outro álbum"
          >
            {album.album}
          </button>
        ) : (
          <span className="flex-1 truncate text-left text-sm font-medium text-foreground">
            {album.album}
          </span>
        )}
        {canEdit && onReidentGroup ? (
          <IaButton
            lotIds={albumLotIds}
            onReident={onReidentGroup}
            title="Rodar a IA neste álbum (identifica as vendas ainda sem álbum)"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-xs text-muted-foreground">
            {album.count} na base · {money(album.minPrice)}–{money(album.maxPrice)}
          </span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-sm font-semibold text-primary">
            {money(album.avgPrice)}
          </span>
        </button>
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          {/* Médias por Faixa de Classificação (pior → melhor, casando com o eixo abaixo). */}
          {faixasAsc.length ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {faixasAsc.map((f) => (
                <span
                  key={f.label}
                  className="rounded bg-secondary px-1.5 py-0.5 text-xs text-foreground"
                  title={`${f.count} venda(s) na faixa ${f.label}`}
                >
                  {f.label}: <span className="font-semibold">{money(f.avgPrice)}</span>
                  <span className="text-muted-foreground"> ({f.count})</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* Eixo horizontal: pior (esquerda) → melhor (direita). */}
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>◀ pior conservação</span>
            <span>melhor conservação ▶</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {album.sales.map((s) => (
              <SaleMarker
                key={s.lot_id}
                sale={s}
                albumName={album.album}
                artistName={artistName}
                suggestions={suggestions}
                readOnly={readOnly}
                onApplySaleOverride={onApplySaleOverride}
                onExcludeSale={onExcludeSale}
              />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {album.count} {album.count === 1 ? "disco" : "discos"} na nossa base
            </span>
            <Button variant="ghost" size="sm" onClick={() => setDetail(true)}>
              Detalhes
            </Button>
          </div>
        </div>
      ) : null}
      <DetailDialog album={album} open={detail} onClose={() => setDetail(false)} />
      {canEdit && onApplyAlbum ? (
        <AlbumEditDialog
          album={album}
          artistKey={artistKey}
          siblings={siblings}
          open={edit}
          onClose={() => setEdit(false)}
          onApply={onApplyAlbum}
        />
      ) : null}
    </div>
  );
}

/** Mini card horizontal: VALOR em cima, estado no meio, NOTA (score) embaixo. Ao passar o
 *  mouse, mostra um preview compacto (Popover portalizado → não é cortado pelo scroll); ao
 *  CLICAR, abre o detalhe da venda (texto original + correção por venda, quando editável). */
function SaleMarker({
  sale,
  albumName,
  artistName,
  suggestions,
  readOnly,
  onApplySaleOverride,
  onExcludeSale,
}: {
  sale: SaleRow;
  albumName: string;
  artistName: string;
  suggestions: Suggestions;
  readOnly: boolean;
  onApplySaleOverride?: ApplySaleOverride;
  onExcludeSale?: ExcludeSale;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [dragging, setDragging] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScroll = useDragAutoScroll();
  const cond = useMemo(() => conditionFromSale(sale), [sale]);
  const grade =
    sale.media || sale.sleeve
      ? `${sale.media || "?"}/${sale.sleeve || "?"}`
      : sale.faixa || "estado —";
  const canEdit = !readOnly;

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            draggable={canEdit}
            onDragStart={(e) => {
              if (!canEdit) return;
              cancelClose();
              setOpen(false);
              setDragging(true);
              autoScroll.start();
              e.dataTransfer.effectAllowed = "move";
              const payload: SaleDragPayload = {
                lotId: sale.lot_id,
                artist: artistName,
                album: albumName,
              };
              e.dataTransfer.setData(SALE_DRAG_TYPE, JSON.stringify(payload));
            }}
            onDragEnd={() => setDragging(false)}
            onMouseEnter={() => {
              cancelClose();
              setOpen(true);
            }}
            onMouseLeave={scheduleClose}
            onClick={() => setDetail(true)}
            title={
              canEdit
                ? "Arraste para outro álbum deste artista para mover · clique para abrir detalhe/corrigir"
                : "Clique para abrir o detalhe"
            }
            className={`flex w-24 shrink-0 flex-col items-center gap-1 rounded border border-border bg-card p-2 text-center hover:border-primary/60 ${
              canEdit ? "cursor-grab active:cursor-grabbing" : ""
            } ${dragging ? "opacity-40" : ""}`}
          >
            {/* VALOR (antes era a nota que ficava aqui em cima) */}
            <span className="w-full truncate text-xs font-semibold text-foreground">
              {money(sale.sold_price)}
            </span>
            <span className="w-full truncate text-[10px] text-muted-foreground" title={grade}>
              {grade}
            </span>
            {/* NOTA/score (invertida com o valor) */}
            <span
              className={`w-full truncate rounded px-1 py-0.5 text-[11px] font-semibold ${scoreTone(sale.score)}`}
              title={`Disco ${sale.media || "—"} · Capa ${sale.sleeve || "—"}${
                sale.score !== null ? ` · Score ${sale.score}` : ""
              }`}
            >
              {sale.score !== null ? sale.score : "—"}
            </span>
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          side="top"
          className="w-64 p-3"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SalePreview sale={sale} albumName={albumName} condition={cond} />
        </PopoverContent>
      </Popover>
      <SaleDetailDialog
        sale={sale}
        albumName={albumName}
        artistName={artistName}
        condition={cond}
        suggestions={suggestions}
        readOnly={readOnly}
        open={detail}
        onClose={() => setDetail(false)}
        onApply={onApplySaleOverride}
        onExclude={onExcludeSale ? (label) => onExcludeSale(sale, label) : undefined}
      />
    </>
  );
}

/** Preview compacto do lote (hover). Mostra artista, álbum, TEXTO ORIGINAL e mais campos. */
function SalePreview({
  sale,
  albumName,
  condition,
}: {
  sale: SaleRow;
  albumName: string;
  condition: Condition;
}) {
  const img = sale.image || null;
  const orig = (sale.orig_text || sale.title || "").trim();
  return (
    <div className="flex flex-col gap-2">
      {img ? (
        <div className="h-32 w-full overflow-hidden rounded bg-secondary">
          <img src={img} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
        </div>
      ) : null}
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{albumName}</p>
      {/* Texto original do lote (descritivo do catálogo, ou o título quando não há) — com rolagem
          quando é longo, para os casos não identificados. */}
      {orig ? (
        <div className="max-h-20 overflow-y-auto rounded bg-secondary/50 p-1.5 text-xs leading-snug text-muted-foreground">
          {orig}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ConditionBadges condition={condition} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-primary" title="Valor de venda">
          {money(sale.sold_price)}
        </span>
        {sale.initial_price != null ? (
          <span className="text-muted-foreground" title={discountTip(sale)}>
            inicial {money(sale.initial_price)}
          </span>
        ) : null}
        {netCost(sale) != null ? (
          <span className="text-muted-foreground" title={feeTip(sale)}>
            c/ taxa {money(netCost(sale))}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {sale.sold_date ?? "—"} · {demandLabel(sale)}
        </span>
        {sale.source_url ? (
          <a
            href={sale.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Lote <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <p className="text-[10px] italic text-muted-foreground">
        Clique no card para abrir / corrigir
      </p>
    </div>
  );
}

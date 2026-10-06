import {
  Binoculars,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LOOKOUT_CONFIDENT_MIN,
  lookoutLabel,
  priceVsCeiling,
  type LookoutItem,
  type LookoutStatus,
} from "@/lib/lookout-match";
import type { LookoutPastSale, LookoutUpcoming } from "@/lib/lookout-matches.server";
import { lotOpenUrl } from "@/lib/vinyl-parse";

/** Patch enviado ao servidor ao editar um item (teto/nota/identidade/status). */
export type LookoutPatch = {
  artist?: string;
  album?: string;
  year?: number | null;
  maxPrice?: number | null;
  note?: string;
  status?: LookoutStatus;
};

function brl(n: number | null | undefined): string {
  return n == null ? "—" : `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/** "2026-10-12" → "12/10". */
function shortDay(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return m && d ? `${d}/${m}` : dayKey;
}

/** "70", "70,5", "R$ 1.200,00" → número (>0) ou null. */
function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[^\d,.]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Um disco "de olho" na página `/olho`: identidade editável, teto de preço, nota, os lotes POR VIR
 * que casam (com valor × teto, Discogs, ✓/✕) e o histórico de aparições (vendas arquivadas).
 */
export function LookoutItemCard({
  item,
  upcoming,
  history,
  watchedIds,
  watchLoading,
  busyWatch,
  onUpdate,
  onDelete,
  onWatch,
  onResolve,
  onIdentify,
  identifying,
}: {
  item: LookoutItem;
  upcoming: LookoutUpcoming[];
  history: LookoutPastSale[];
  /** `idPeca` dos lotes vigiados na conta (mesmo critério da home e da Análise). */
  watchedIds: ReadonlySet<string>;
  /** Lista de vigiados ainda carregando: o botão espera, para não mostrar "Vigiar" errado. */
  watchLoading: boolean;
  busyWatch: string | null;
  onUpdate: (patch: LookoutPatch) => void;
  onDelete: () => void;
  onWatch: (m: LookoutUpcoming) => void;
  onResolve: (m: LookoutUpcoming, decision: "confirm" | "dismiss") => void;
  /** Identifica artista/álbum/ano pela IA (texto + imagem) — botão sob o lápis. */
  onIdentify: () => void;
  identifying: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [artist, setArtist] = useState(item.artist);
  const [album, setAlbum] = useState(item.album);
  const [year, setYear] = useState(item.year ? String(item.year) : "");
  const [ceiling, setCeiling] = useState(item.maxPrice ? String(item.maxPrice) : "");
  const [note, setNote] = useState(item.note);
  const archived = item.status !== "active";
  const incomplete = !item.artist.trim() || !item.album.trim();

  const saveIdentity = () => {
    const y = Number(year);
    onUpdate({
      artist,
      album,
      year: Number.isFinite(y) && y >= 1900 && y <= 2100 ? Math.trunc(y) : null,
    });
    setEditing(false);
  };

  const sold = history.map((h) => h.soldPrice).filter((v): v is number => v != null && v > 0);
  const soldMin = sold.length ? Math.min(...sold) : null;
  const soldMax = sold.length ? Math.max(...sold) : null;
  const soldAvg = sold.length ? sold.reduce((a, b) => a + b, 0) / sold.length : null;

  return (
    <section
      className={`rounded-md border bg-card ${archived ? "border-border opacity-70" : "border-fuchsia-500/60"}`}
    >
      <div className="flex flex-wrap gap-3 p-3 sm:flex-nowrap sm:p-4">
        {item.image ? (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            className="h-24 w-24 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-secondary">
            <Binoculars className="h-6 w-6 text-muted-foreground/50" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_5rem]">
              <Input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artista"
                aria-label="Artista"
              />
              <Input
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Álbum"
                aria-label="Álbum"
              />
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Ano"
                inputMode="numeric"
                aria-label="Ano"
              />
              <div className="flex gap-2 sm:col-span-3">
                <Button size="sm" onClick={saveIdentity}>
                  <Check className="mr-1 h-4 w-4" />
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {lookoutLabel(item) || item.title || "Disco sem identificação"}
                </h2>
                <p className="truncate text-xs text-muted-foreground" title={item.title}>
                  Marcado em {item.house || "—"}
                  {item.dayKey ? ` · ${shortDay(item.dayKey)}` : ""} — {item.title}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-center">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    // Recarrega os campos do item (a IA pode ter mudado artista/álbum/ano).
                    setArtist(item.artist);
                    setAlbum(item.album);
                    setYear(item.year ? String(item.year) : "");
                    setEditing(true);
                  }}
                  aria-label="Editar artista/álbum/ano"
                  title="Editar artista/álbum/ano (o casamento usa estes campos)"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onIdentify}
                  disabled={identifying}
                  aria-label="Identificar com IA (texto + imagem)"
                  title="Identificar artista/álbum/ano com IA, pelo texto do lote + a imagem (gasta créditos de IA)"
                >
                  {identifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {incomplete && !editing ? (
            <p className="rounded bg-orange-500/15 px-2 py-1 text-xs text-orange-700 dark:text-orange-300">
              Artista/álbum não identificados — use a IA (✨) ou edite (lápis) para o casamento
              funcionar.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Teto R$
              <Input
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                onBlur={() => {
                  const next = parseMoney(ceiling);
                  if (next !== item.maxPrice) onUpdate({ maxPrice: next });
                }}
                placeholder="opcional"
                inputMode="decimal"
                className="h-8 w-24"
                aria-label="Teto de preço (R$)"
              />
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note.trim() !== item.note) onUpdate({ note });
              }}
              placeholder="Nota (ex.: só se estiver VG+)"
              className="h-8 min-w-40 flex-1"
              aria-label="Nota"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {item.status === "active" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate({ status: "acquired" })}
                  title="Já comprei — para de procurar"
                >
                  <Check className="mr-1 h-4 w-4" />
                  Adquirido
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdate({ status: "dismissed" })}
                  title="Desisti — para de destacar e de avisar"
                >
                  Desistir
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => onUpdate({ status: "active" })}>
                Reativar
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              aria-label="Remover"
              title="Remover da lista"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>

      {!archived ? (
        <div className="border-t border-border px-3 py-3 sm:px-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Por vir{" "}
            <span className="font-normal text-muted-foreground">
              ({upcoming.length} lote{upcoming.length === 1 ? "" : "s"})
            </span>
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum lote futuro casa com este disco por enquanto. Você será avisado quando
              aparecer.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((m) => {
                const sure = m.confirmed || m.score >= LOOKOUT_CONFIDENT_MIN;
                const vs = priceVsCeiling(m.priceNum, item.maxPrice);
                const watching = watchedIds.has(m.idPeca);
                return (
                  <li
                    key={m.lotId}
                    className="flex flex-wrap items-center gap-3 rounded border border-border bg-background p-2"
                  >
                    {m.image ? (
                      <img
                        src={m.image}
                        alt=""
                        loading="lazy"
                        className="h-14 w-14 shrink-0 rounded object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="line-clamp-2 text-sm text-foreground" title={m.title}>
                        {m.isNew ? (
                          <span className="mr-1 rounded bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            novo
                          </span>
                        ) : null}
                        {m.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                        <span>
                          {m.house} · {shortDay(m.dayKey)}
                          {m.time ? ` ${m.time}` : ""}
                          {m.uf ? ` · ${m.uf}` : ""}
                        </span>
                        <span className="font-semibold text-primary">Atual {m.price || "—"}</span>
                        {vs === "under" ? (
                          <span className="text-green-600 dark:text-green-400">abaixo do teto</span>
                        ) : vs === "over" ? (
                          <span className="text-red-600 dark:text-red-400">acima do teto</span>
                        ) : null}
                        {m.marketLowBr != null ? (
                          <span title="Faixa no mercado BR (Discogs, com frete)">
                            Discogs BR {brl(m.marketLowBr)}
                            {m.marketHighBr != null ? `–${brl(m.marketHighBr)}` : ""}
                          </span>
                        ) : null}
                        {m.aiScore != null ? <span>IA {m.aiScore}</span> : null}
                      </p>
                    </div>
                    <span
                      className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-xs font-medium text-fuchsia-700 dark:text-fuchsia-300"
                      title={m.confirmed ? "Confirmado por você" : "Confiança do casamento"}
                    >
                      {sure ? "" : "? "}
                      {Math.round(m.score * 100)}%
                    </span>
                    <div className="flex items-center gap-1">
                      {!sure ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onResolve(m, "confirm")}
                          aria-label="É este disco"
                          title="É este disco"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onResolve(m, "dismiss")}
                        aria-label="Não é este disco"
                        title="Não é este disco"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={watching ? "default" : "outline"}
                        onClick={() => onWatch(m)}
                        disabled={watchLoading || busyWatch === m.lotId}
                      >
                        <Eye className="mr-1 h-4 w-4" />
                        {watching ? "Vigiando" : "Vigiar"}
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={lotOpenUrl(m.url, m.title, m.lote)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir lote no leiloeiro"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Aparições anteriores ({history.length})
            {soldMin != null
              ? ` · vendeu de ${brl(soldMin)} a ${brl(soldMax)} · média ${brl(soldAvg)}`
              : ""}
          </button>
          {showHistory ? (
            history.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Nenhuma venda anterior arquivada deste disco.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {history.map((h) => (
                  <li key={h.lotId} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold text-foreground">{brl(h.soldPrice)}</span>
                    <span>{h.soldDate ? shortDay(h.soldDate) : "—"}</span>
                    <span>{h.house}</span>
                    {h.media || h.sleeve ? (
                      <span title="Grau do disco / da capa">
                        {h.media ? `Disco ${h.media}` : ""}
                        {h.media && h.sleeve ? " · " : ""}
                        {h.sleeve ? `Capa ${h.sleeve}` : ""}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate" title={h.title}>
                      {h.title}
                    </span>
                    {h.url ? (
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                      >
                        ver
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

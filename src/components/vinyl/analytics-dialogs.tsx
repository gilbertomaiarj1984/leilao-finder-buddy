// Diálogos do Vinil Analytics (detalhe da venda, edição de artista/álbum, detalhe do grupo).

import { useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/persisted-state";

import { Check, EyeOff, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConditionBadges } from "@/components/vinyl/condition-badges";
import { type AlbumAgg, type ArtistAgg, type SaleRow } from "@/lib/analytics";
import { type Condition } from "@/lib/grading";
import { normalizeForMatch } from "@/lib/vinyl-parse";
import {
  ApplySaleOverride,
  Suggestions,
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
/** Detalhe da venda (clique no mini card): texto ORIGINAL completo + todos os campos + link. No
 *  modo editável, também a correção POR VENDA (define artista/álbum só desta venda) para separar
 *  os não identificados — omitida inteiramente em `readOnly`. */
export function SaleDetailDialog({
  sale,
  albumName,
  artistName,
  condition,
  suggestions,
  readOnly,
  open,
  onClose,
  onApply,
  onExclude,
}: {
  sale: SaleRow;
  albumName: string;
  artistName: string;
  condition: Condition;
  suggestions: Suggestions;
  readOnly: boolean;
  open: boolean;
  onClose: () => void;
  onApply?: ApplySaleOverride;
  onExclude?: (label: string) => void;
}) {
  const [artist, setArtist] = useState(artistName);
  const [album, setAlbum] = useState(albumName);
  const listId = `sale-${sale.lot_id}`;
  const canEdit = !readOnly && !!onApply;

  // Álbuns sugeridos: SÓ os do artista digitado/selecionado (artista é a chave principal; o
  // álbum só existe dentro do universo dele) — o artista atual, se ainda sem álbuns conhecidos,
  // cai de volta na lista COMPLETA em vez de ficar vazio.
  const albumSuggestions = useMemo(() => {
    const byArtist = suggestions.albumsByArtist.get(normalizeForMatch(artist));
    return byArtist?.length ? byArtist : suggestions.albums;
  }, [suggestions, artist]);

  // Reinicia os campos ao (re)abrir para esta venda, com os valores atuais do grupo.
  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== sale.lot_id) {
    openedFor.current = sale.lot_id;
    setArtist(artistName);
    setAlbum(albumName);
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const orig = (sale.orig_text || "").trim();
  const save = () => {
    onApply?.(sale.lot_id, { artist, album });
    onClose();
  };
  const reset = () => {
    onApply?.(sale.lot_id, null);
    onClose();
  };
  const exclude = () => {
    // Rótulo amigável para a lista de "Ocultos" (artista — álbum, ou o título como fallback).
    const label = [artistName, albumName].filter(Boolean).join(" — ") || sale.title;
    onExclude?.(label);
    onClose();
  };

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value || "—"}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">Detalhe da venda</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {sale.image ? (
            <div className="h-40 w-full overflow-hidden rounded bg-secondary">
              <img
                src={sale.image}
                alt=""
                loading="lazy"
                className="h-full w-full object-contain p-1"
              />
            </div>
          ) : null}
          {/* Texto ORIGINAL completo do lote — o que o card do catálogo trazia. */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Texto original do lote</p>
            <div className="max-h-40 overflow-y-auto rounded border border-border bg-secondary/40 p-2 text-sm leading-snug text-foreground">
              {orig || sale.title || "—"}
              {!orig && sale.title ? (
                <span className="mt-1 block text-[10px] italic text-muted-foreground">
                  (descritivo completo não guardado nesta venda — texto acima é o título; abra o
                  lote para ver tudo)
                </span>
              ) : null}
            </div>
          </div>

          {/* Todos os campos da venda. */}
          <div className="text-xs">
            <Field label="Artista (atual)" value={artistName} />
            <Field label="Álbum (atual)" value={albumName} />
            <Field label="Título armazenado" value={sale.title} />
            <Field
              label="Estado"
              value={`Disco ${sale.media || "—"} · Capa ${sale.sleeve || "—"}`}
            />
            <Field
              label="Score / Faixa"
              value={`${sale.score ?? "—"}${sale.faixa ? ` · ${sale.faixa}` : ""}`}
            />
            <Field label="Valor" value={money(sale.sold_price)} />
            <Field
              label="Inicial / c/ taxa"
              value={`${sale.initial_price != null ? money(sale.initial_price) : "—"} / ${
                netCost(sale) != null ? money(netCost(sale)) : "—"
              }`}
            />
            <Field label="Demanda" value={demandLabel(sale)} />
            <Field
              label="Casa / UF"
              value={`${sale.house || "—"}${sale.uf ? ` · ${sale.uf}` : ""}`}
            />
            <Field label="Data" value={sale.sold_date ?? "—"} />
            <Field label="Lote (id)" value={sale.lot_id} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ConditionBadges condition={condition} />
            {sale.source_url ? (
              <a
                href={sale.source_url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
              >
                Abrir lote no leiloeiro <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          {/* Correção POR VENDA: separa este disco do balaio, atribuindo artista/álbum SÓ dele. */}
          {canEdit ? (
            <div className="flex flex-col gap-2 rounded border border-border p-3">
              <span className="text-sm font-medium text-foreground">Corrigir esta venda</span>
              <span className="text-xs text-muted-foreground">
                Define o artista e o álbum SÓ deste disco — útil para tirar os não identificados do
                balaio. Pode escolher um nome existente ou digitar um novo.
              </span>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Artista</span>
                <Input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  list={`${listId}-artists`}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Álbum</span>
                <Input
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  list={`${listId}-albums`}
                />
              </label>
              <datalist id={`${listId}-artists`}>
                {suggestions.artists.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <datalist id={`${listId}-albums`}>
                {albumSuggestions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  title="Remover a correção manual desta venda"
                >
                  Voltar ao automático
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exclude}
                  title="Ocultar esta venda do Analytics (não apaga do banco; dá para reincluir em 'Ocultos')"
                  className="text-destructive hover:text-destructive"
                >
                  <EyeOff className="mr-1 h-3.5 w-3.5" />
                  Excluir do Analytics
                </Button>
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {canEdit ? "Cancelar" : "Fechar"}
              </Button>
              {canEdit ? (
                <Button size="sm" onClick={save}>
                  Salvar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editar/renomear/fundir ARTISTA. Alvo = nome digitado; origem = este artista + selecionados. */
export function ArtistEditDialog({
  artist,
  allArtists,
  open,
  onClose,
  onApply,
  onClear,
  onExclude,
}: {
  artist: ArtistAgg;
  allArtists: ArtistAgg[];
  open: boolean;
  onClose: () => void;
  onApply: (sourceKeys: string[], name: string) => void;
  onClear: () => void;
  onExclude: () => void;
}) {
  const [name, setName] = useState(artist.artist);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reinicia o estado ao (re)abrir para este artista.
  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== artist.key) {
    openedFor.current = artist.key;
    setName(artist.artist);
    setFilter("");
    setSelected(new Set());
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const filterNorm = normalizeForMatch(filter);
  const candidates = useMemo(
    () =>
      allArtists
        .filter((a) => a.key !== artist.key)
        .filter((a) => !filterNorm || normalizeForMatch(a.artist).includes(filterNorm))
        .slice(0, 60),
    [allArtists, artist.key, filterNorm],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    const target = name.trim() || artist.artist;
    // Chaves de origem: as deste artista + as de cada artista selecionado (fusão).
    const merged = allArtists.filter((a) => selected.has(a.key));
    const sourceKeys = [...new Set([...artist.sourceKeys, ...merged.flatMap((a) => a.sourceKeys)])];
    onApply(sourceKeys, target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar artista</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Nome do artista</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Juntar com outro artista (os álbuns são agrupados; álbuns coincidentes se somam)
            </span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar artista para juntar…"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum artista encontrado.</p>
              ) : (
                candidates.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggle(a.key)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                        on ? "bg-secondary" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex-1 truncate text-foreground">{a.artist}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.albums.length} álbuns · {a.count} vendas
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Isso vira um aprendizado do sistema: variações desses nomes passam a cair sempre neste
              grupo, agora e no futuro.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                title="Voltar ao agrupamento automático"
              >
                Desfazer curadoria
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onExclude();
                  onClose();
                }}
                title="Ocultar este artista do Analytics (não apaga do banco; dá para reincluir em 'Ocultos')"
                className="text-destructive hover:text-destructive"
              >
                <EyeOff className="mr-1 h-3.5 w-3.5" />
                Excluir artista
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Editar/renomear/fundir ÁLBUM no escopo do artista. Mantém o nome DESTE álbum (salvo se
 *  renomeado); os selecionados se juntam a ele. */
export function AlbumEditDialog({
  album,
  artistKey,
  siblings,
  open,
  onClose,
  onApply,
}: {
  album: AlbumAgg;
  artistKey: string;
  siblings: AlbumAgg[];
  open: boolean;
  onClose: () => void;
  onApply: (keys: string[], name: string) => void;
}) {
  const [name, setName] = useState(album.album);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const openedFor = useRef<string | null>(null);
  if (open && openedFor.current !== album.key) {
    openedFor.current = album.key;
    setName(album.album);
    setFilter("");
    setSelected(new Set());
  }
  if (!open && openedFor.current !== null) openedFor.current = null;

  const filterNorm = normalizeForMatch(filter);
  const candidates = useMemo(
    () =>
      siblings
        .filter((a) => a.key !== album.key)
        .filter((a) => !filterNorm || normalizeForMatch(a.album).includes(filterNorm)),
    [siblings, album.key, filterNorm],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = () => {
    const target = name.trim() || album.album;
    const merged = siblings.filter((a) => selected.has(a.key));
    // Chaves de origem, no escopo do artista: `${artistKey}|${albumSourceKey}`.
    const rawKeys = [...new Set([...album.sourceKeys, ...merged.flatMap((a) => a.sourceKeys)])];
    const keys = rawKeys.map((k) => `${artistKey}|${k}`);
    onApply(keys, target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar álbum</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Nome do álbum</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Juntar com outro álbum deste artista (viram o mesmo, mantendo este nome)
            </span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar álbum para juntar…"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Nenhum outro álbum deste artista.
                </p>
              ) : (
                candidates.map((a) => {
                  const on = selected.has(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggle(a.key)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/60 ${
                        on ? "bg-secondary" : ""
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex-1 truncate text-foreground">{a.album}</span>
                      <span className="text-xs text-muted-foreground">{a.count} na base</span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Isso vira um aprendizado do sistema: os discos desses álbuns passam a contar como este
              álbum, agora e no futuro.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Colunas ordenáveis da tabela de Detalhes.
type SortCol =
  "data" | "disco" | "capa" | "score" | "faixa" | "inicial" | "valor" | "custo" | "demanda";

const GRADE_INDEX: Record<string, number> = {
  M: 0,
  NM: 1,
  EX: 2,
  "VG+": 3,
  VG: 4,
  "VG-": 5,
  "G+": 6,
  G: 7,
  "G-": 8,
  "F/P": 9,
};

/** Valor comparável de uma venda para cada coluna (null = sempre no fim). */
function sortValue(s: SaleRow, col: SortCol): number | string | null {
  switch (col) {
    case "data":
      return s.sold_date ?? null;
    case "disco":
      return s.media ? (GRADE_INDEX[s.media] ?? null) : null;
    case "capa":
      return s.sleeve ? (GRADE_INDEX[s.sleeve] ?? null) : null;
    case "score":
    case "faixa":
      return s.score;
    case "inicial":
      return s.initial_price ?? null;
    case "valor":
      return s.sold_price;
    case "custo":
      return netCost(s);
    case "demanda":
      return s.views ?? s.bids ?? null;
    default:
      return null;
  }
}

export function DetailDialog({
  album,
  open,
  onClose,
}: {
  album: AlbumAgg;
  open: boolean;
  onClose: () => void;
}) {
  // Padrão: score ascendente (pior → melhor), como o eixo dos mini cards.
  const [sort, setSort] = usePersistedState<{ col: SortCol; dir: 1 | -1 }>(
    "analytics-detail-sort",
    {
      col: "score",
      dir: 1,
    },
  );
  const sorted = useMemo(() => {
    const list = [...album.sales];
    const { col, dir } = sort;
    list.sort((a, b) => {
      const va = sortValue(a, col);
      const vb = sortValue(b, col);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulos sempre ao fim
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
    return list;
  }, [album.sales, sort]);

  const onSort = (col: SortCol) =>
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }));

  const arrow = (col: SortCol) => (sort.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ col, label, extra }: { col: SortCol; label: string; extra?: string }) => (
    <th className="py-1 pr-3" title={extra}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center hover:text-foreground ${
          sort.col === col ? "font-semibold text-foreground" : ""
        }`}
      >
        {label}
        {arrow(col)}
      </button>
    </th>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{album.album}</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <Th col="data" label="Data" />
                <Th col="disco" label="Disco" />
                <Th col="capa" label="Capa" />
                <Th col="score" label="Score" />
                <Th col="faixa" label="Faixa" />
                <Th col="inicial" label="Inicial" />
                <Th col="valor" label="Valor" />
                <Th
                  col="custo"
                  label="Custo c/ taxa"
                  extra="Custo real = valor + taxa do leiloeiro"
                />
                <Th col="demanda" label="Demanda" extra="Visualizações · lances" />
                <th className="py-1">Lote</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.lot_id} className="border-t border-border">
                  <td className="py-1 pr-3 text-muted-foreground">{s.sold_date ?? "—"}</td>
                  <td className="py-1 pr-3">{s.media || "—"}</td>
                  <td className="py-1 pr-3">{s.sleeve || "—"}</td>
                  <td className="py-1 pr-3">{s.score ?? "—"}</td>
                  <td className="py-1 pr-3">{s.faixa || "—"}</td>
                  <td className="py-1 pr-3 text-muted-foreground" title={discountTip(s)}>
                    {s.initial_price != null ? money(s.initial_price) : "—"}
                  </td>
                  <td className="py-1 pr-3 font-semibold text-foreground">{money(s.sold_price)}</td>
                  <td className="py-1 pr-3 text-muted-foreground" title={feeTip(s)}>
                    {netCost(s) != null ? money(netCost(s)) : "—"}
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{demandLabel(s)}</td>
                  <td className="py-1">
                    {s.source_url ? (
                      <a
                        href={s.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-primary hover:underline"
                        aria-label="Abrir lote no leiloeiro"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

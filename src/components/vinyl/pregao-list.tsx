import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Package, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PurchaseCard } from "@/components/vinyl/purchase-card";
import { usePersistedState } from "@/lib/persisted-state";
import {
  approveShipment,
  editShipment,
  receiveShipment,
  setPregaoNote,
  setPregaoStatus,
} from "@/lib/purchases.functions";
import {
  AUCTION_STATUSES,
  GUARD_ALERT_DAYS,
  AUCTIONEER_FEE_RATE,
  REFERENCE_FREIGHT,
  STATUS_LABEL,
  canBundle,
  groupByHouse,
  groupByPregao,
  guardDays,
  previewShipment,
  summarizeByStatus,
  totalsByHouse,
  type AuctionStatus,
  type PregaoGroup,
  type ShippingData,
} from "@/lib/purchase-shipping";
import type { Purchase } from "@/lib/purchases.server";

const STATUS_STYLE: Record<AuctionStatus, string> = {
  aberto: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  frete: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  pago: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  guarda: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  transito: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  recebido: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

type Filter = "todos" | AuctionStatus;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function brDate(iso: string | null): string {
  if (!iso) return "sem data";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const todayBr = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function PregaoView({
  purchases,
  shipping,
  ownedLabelFor,
  onOpenOwned,
  onSend,
  onChanged,
}: {
  purchases: Purchase[];
  shipping: ShippingData;
  ownedLabelFor: (p: Purchase) => string | null;
  onOpenOwned: (p: Purchase) => void;
  onSend: (p: Purchase) => void;
  /** Recarrega o acompanhamento (status, remessas) depois de qualquer gravação. */
  onChanged: () => void;
}) {
  const [showTotals, setShowTotals] = usePersistedState("compras-totais", false);
  const [filter, setFilter] = usePersistedState<Filter>("compras-pregao-filtro", "todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [bundleOpen, setBundleOpen] = useState(false);

  const groups = useMemo(() => groupByPregao(purchases, shipping), [purchases, shipping]);
  const summary = useMemo(() => summarizeByStatus(groups), [groups]);
  const today = todayBr();

  const setStatus = useServerFn(setPregaoStatus);
  const statusMut = useMutation({
    mutationFn: (v: { idLeilao: string; status: AuctionStatus }) => setStatus({ data: v }),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message || "Não foi possível mudar o status"),
  });
  const recv = useServerFn(receiveShipment);
  const recvMut = useMutation({
    mutationFn: (shipmentId: string) => recv({ data: { shipmentId } }),
    onSuccess: () => {
      onChanged();
      toast.success("Remessa marcada como recebida.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível marcar como recebida"),
  });

  // Pregões que saem de "na guarda" (ou somem) deixam a seleção.
  useEffect(() => {
    setSelected((prev) => {
      const ok = new Set(groups.filter((g) => g.state.status === "guarda").map((g) => g.idLeilao));
      const next = new Set([...prev].filter((id) => ok.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [groups]);

  const chosen = groups.filter((g) => selected.has(g.idLeilao));
  const chosenHouse = chosen[0]?.house ?? null;
  const visible = groups.filter((g) =>
    filter === "todos" ? g.state.status !== "recebido" : g.state.status === filter,
  );
  const others = visible.filter((g) => g.state.status !== "guarda");
  const keepByHouse = groupByHouse(visible.filter((g) => g.state.status === "guarda"));
  const houseTotals = useMemo(() => totalsByHouse(visible), [visible]);
  const keepHouses = new Set(groups.filter((g) => g.state.status === "guarda").map((g) => g.house))
    .size;

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const renderCard = (g: PregaoGroup<Purchase>) => (
    <PregaoCard
      key={g.idLeilao}
      group={g}
      today={today}
      expanded={open.has(g.idLeilao)}
      selected={selected.has(g.idLeilao)}
      pickBlocked={selected.size > 0 && chosenHouse !== g.house}
      onToggleOpen={() => setOpen((s) => toggle(s, g.idLeilao))}
      onTogglePick={() => setSelected((s) => toggle(s, g.idLeilao))}
      onStatus={(status) => statusMut.mutate({ idLeilao: g.idLeilao, status })}
      onReceive={() =>
        g.shipment
          ? recvMut.mutate(g.shipment.id)
          : statusMut.mutate({ idLeilao: g.idLeilao, status: "recebido" })
      }
      onChanged={onChanged}
      ownedLabelFor={ownedLabelFor}
      onOpenOwned={onOpenOwned}
      onSend={onSend}
    />
  );

  return (
    <div className="space-y-4 pb-24">
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTotals((v) => !v)}
          aria-expanded={showTotals}
        >
          {showTotals ? "Ocultar totais" : "Mostrar totais"}
        </Button>
      </div>

      {showTotals ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Totais">
          <Total
            label="A pagar"
            value={brl(summary.aberto.total + summary.frete.total)}
            sub={`${summary.aberto.auctions} novo(s) · ${summary.frete.auctions} aguardando frete`}
          />
          <Total
            label="Pago · a enviar"
            value={brl(summary.pago.total)}
            sub={`${summary.pago.auctions} pregão(ões)`}
          />
          <Total
            label="Na guarda"
            value={brl(summary.guarda.total)}
            sub={`${summary.guarda.auctions} em ${keepHouses} casa(s)`}
          />
          <Total
            label="Em trânsito"
            value={brl(summary.transito.total)}
            sub={`${summary.transito.auctions} pregão(ões)`}
          />
          <Total label="Recebidos" value={String(summary.recebido.discs)} sub="discos já comigo" />
          <HouseTotalsTable data={houseTotals} />
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
        <FilterChip
          label="Ativos"
          count={groups.length - summary.recebido.auctions}
          active={filter === "todos"}
          onClick={() => setFilter("todos")}
        />
        {AUCTION_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_LABEL[s]}
            count={summary[s].auctions}
            active={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum pregão neste status.
        </div>
      ) : (
        <div className="space-y-3">
          {others.map(renderCard)}
          {keepByHouse.map((h) => {
            const ids = h.groups.map((g) => g.idLeilao);
            const allPicked = ids.every((id) => selected.has(id));
            return (
              <section
                key={h.house}
                className="space-y-3 rounded-md border border-violet-300 p-3 dark:border-violet-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Na guarda · {h.house || "casa não identificada"}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {h.groups.length} pregão(ões) ·{" "}
                      {h.groups.reduce((n, g) => n + g.purchases.length, 0)} discos ·{" "}
                      {brl(h.groups.reduce((n, g) => n + g.total, 0))}
                    </span>
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(allPicked ? new Set() : new Set(ids))}
                  >
                    {allPicked ? "Limpar seleção" : "Selecionar todos da casa"}
                  </Button>
                </div>
                {h.groups.map(renderCard)}
              </section>
            );
          })}
        </div>
      )}

      {chosen.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-violet-500 bg-card px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>
                {chosen.length} pregão(ões) de {chosenHouse}
              </strong>{" "}
              · {chosen.reduce((s, g) => s + g.purchases.length, 0)} discos ·{" "}
              {brl(chosen.reduce((s, g) => s + g.total, 0))}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
              <Button size="sm" onClick={() => setBundleOpen(true)} disabled={!canBundle(chosen)}>
                <Package className="mr-2 h-4 w-4" />
                Montar remessa
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ShipmentDialog
        open={bundleOpen}
        groups={chosen}
        onClose={() => setBundleOpen(false)}
        onDone={() => {
          setBundleOpen(false);
          setSelected(new Set());
          setFilter("transito");
          onChanged();
        }}
      />
    </div>
  );
}

function HouseTotalsTable({ data }: { data: ReturnType<typeof totalsByHouse> }) {
  const rate = `${Math.round(AUCTIONEER_FEE_RATE * 100)}%`;
  return (
    <div className="col-span-full overflow-x-auto rounded-md border border-border bg-card px-3 py-2">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Por casa (lista atual) · taxa do leiloeiro {rate}
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1 pr-2">Casa</th>
            <th className="py-1 pr-2 text-right">Pregões</th>
            <th className="py-1 pr-2 text-right">Discos</th>
            <th className="py-1 pr-2 text-right">Arrematado</th>
            <th className="py-1 pr-2 text-right">Taxa {rate}</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {data.houses.map((r) => (
            <tr key={r.house} className="border-t border-border">
              <td className="py-1 pr-2">{r.house || "(casa não identificada)"}</td>
              <td className="py-1 pr-2 text-right">{r.auctions}</td>
              <td className="py-1 pr-2 text-right">{r.discs}</td>
              <td className="py-1 pr-2 text-right">{brl(r.subtotal)}</td>
              <td className="py-1 pr-2 text-right">{brl(r.fee)}</td>
              <td className="py-1 text-right font-medium">{brl(r.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-1 pr-2">Total geral</td>
            <td className="py-1 pr-2 text-right">{data.grand.auctions}</td>
            <td className="py-1 pr-2 text-right">{data.grand.discs}</td>
            <td className="py-1 pr-2 text-right">{brl(data.grand.subtotal)}</td>
            <td className="py-1 pr-2 text-right">{brl(data.grand.fee)}</td>
            <td className="py-1 text-right">{brl(data.grand.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Total({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-foreground bg-foreground px-3 py-1 text-xs font-medium text-background"
          : "rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:border-primary"
      }
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function PregaoCard({
  group: g,
  today,
  expanded,
  selected,
  pickBlocked,
  onToggleOpen,
  onTogglePick,
  onStatus,
  onReceive,
  onChanged,
  ownedLabelFor,
  onOpenOwned,
  onSend,
}: {
  group: PregaoGroup<Purchase>;
  today: string;
  expanded: boolean;
  selected: boolean;
  pickBlocked: boolean;
  onToggleOpen: () => void;
  onTogglePick: () => void;
  onStatus: (s: AuctionStatus) => void;
  onReceive: () => void;
  onChanged: () => void;
  ownedLabelFor: (p: Purchase) => string | null;
  onOpenOwned: (p: Purchase) => void;
  onSend: (p: Purchase) => void;
}) {
  const status = g.state.status;
  const days = guardDays(g, today);
  const [note, setNote] = useState(g.state.note);
  useEffect(() => setNote(g.state.note), [g.state.note]);
  const saveNote = useServerFn(setPregaoNote);
  const noteMut = useMutation({
    mutationFn: (n: string) => saveNote({ data: { idLeilao: g.idLeilao, note: n } }),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar a observação"),
  });
  const saveShipment = useServerFn(editShipment);
  const [tracking, setTracking] = useState(g.shipment?.tracking ?? "");
  useEffect(() => setTracking(g.shipment?.tracking ?? ""), [g.shipment?.tracking]);
  const trackMut = useMutation({
    mutationFn: (t: string) => saveShipment({ data: { id: g.shipment!.id, tracking: t } }),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message || "Não foi possível salvar o rastreio"),
  });

  return (
    <article
      className={`rounded-md border bg-card ${selected ? "border-violet-500 ring-2 ring-violet-500/20" : "border-border"}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-3">
        {status === "guarda" ? (
          <input
            type="checkbox"
            className="h-4 w-4 accent-violet-600"
            checked={selected}
            disabled={pickBlocked && !selected}
            onChange={onTogglePick}
            aria-label={`Juntar o pregão ${g.idLeilao} numa remessa`}
            title={
              pickBlocked && !selected
                ? "Só dá para juntar pregões da mesma casa"
                : "Juntar numa remessa"
            }
          />
        ) : (
          <span className="w-4" aria-hidden />
        )}
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="font-semibold">
            Pregão {g.idLeilao} · {g.house || "casa não identificada"}
            {g.uf ? ` (${g.uf})` : ""}
          </h3>
          <p className="text-xs text-muted-foreground">
            {brDate(g.date)} · {g.purchases.length} disco(s)
            {g.state.paidAt ? ` · pago em ${brDate(g.state.paidAt)}` : ""}
          </p>
        </div>
        <p className="text-right font-mono text-sm tabular-nums">
          {brl(g.total)}
          <span className="block font-sans text-[11px] text-muted-foreground">total</span>
        </p>
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value as AuctionStatus)}
          aria-label={`Status do pregão ${g.idLeilao}`}
          className={`rounded-full border-0 px-3 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}
        >
          {AUCTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Ocultar discos" : "Ver discos"}
        </button>
      </div>

      {days !== null && days >= GUARD_ALERT_DAYS ? (
        <p className="border-t border-border bg-amber-100 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Na guarda há {days} dias. Confira com {g.house} o prazo máximo de guarda.
        </p>
      ) : null}

      {expanded ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Observação
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => note !== g.state.note && noteMut.mutate(note)}
                placeholder="Ex.: PIX enviado, aguardando confirmação"
                className="h-8 w-72 max-w-full"
                maxLength={500}
              />
            </label>
            {g.shipment ? (
              <>
                <label className="flex items-center gap-2">
                  <Truck className="h-3.5 w-3.5" />
                  Rastreio
                  <Input
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    onBlur={() => tracking !== g.shipment!.tracking && trackMut.mutate(tracking)}
                    placeholder="BR000000000XX"
                    className="h-8 w-44 font-mono"
                    maxLength={80}
                  />
                </label>
                <span>Frete da remessa {brl(g.shipment.freight)}</span>
              </>
            ) : null}
            {status === "transito" ? (
              <Button size="sm" onClick={onReceive}>
                {g.shipment ? "Marcar remessa como recebida" : "Marcar recebido"}
              </Button>
            ) : null}
            {status === "recebido" && g.state.receivedAt ? (
              <span>
                Recebido em {brDate(g.state.receivedAt)} · use "Enviar para a coleção" em cada disco
              </span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.purchases.map((p) => (
              <PurchaseCard
                key={p.id}
                purchase={p}
                ownedLabel={ownedLabelFor(p)}
                onOpenOwned={() => onOpenOwned(p)}
                onSend={() => onSend(p)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ShipmentDialog({
  open,
  groups,
  onClose,
  onDone,
}: {
  open: boolean;
  groups: PregaoGroup<Purchase>[];
  onClose: () => void;
  onDone: () => void;
}) {
  const preview = useMemo(() => previewShipment(groups), [groups]);
  const [freight, setFreight] = useState("");
  const [tracking, setTracking] = useState("");
  useEffect(() => {
    if (open) {
      setFreight("");
      setTracking("");
    }
  }, [open]);

  const approve = useServerFn(approveShipment);
  const mut = useMutation({
    mutationFn: () =>
      approve({
        data: {
          idLeiloes: groups.map((g) => g.idLeilao),
          freight: Number(freight.replace(",", ".")) || 0,
          tracking,
        },
      }),
    onSuccess: () => {
      toast.success(`Remessa aprovada: ${groups.length} pregão(ões) em trânsito.`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível aprovar a remessa"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview da remessa · {preview.house}</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Pregão</th>
                <th className="py-1 pr-2">Data</th>
                <th className="py-1 pr-2 text-right">Discos</th>
                <th className="py-1 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.idLeilao} className="border-t border-border">
                  <td className="py-1.5 pr-2">{g.idLeilao}</td>
                  <td className="py-1.5 pr-2">{brDate(g.date)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{g.purchases.length}</td>
                  <td className="py-1.5 text-right tabular-nums">{brl(g.total)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5" colSpan={2}>
                  Total
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{preview.discs}</td>
                <td className="py-1.5 text-right tabular-nums">{brl(preview.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer">Conteúdo da caixa ({preview.discs} discos)</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {groups
              .flatMap((g) => g.purchases)
              .map((p) => (
                <li key={p.id}>{p.title}</li>
              ))}
          </ul>
        </details>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Frete combinado (R$)
            <Input
              inputMode="decimal"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              placeholder="0,00"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Código de rastreio (pode ficar para depois)
            <Input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="BR000000000XX"
              className="font-mono"
              maxLength={80}
            />
          </label>
        </div>
        {preview.savedShipments > 0 ? (
          <p className="rounded-md bg-violet-100 px-3 py-2 text-sm text-violet-800 dark:bg-violet-950 dark:text-violet-300">
            Enviando {preview.auctions} pregões juntos você evita {preview.savedShipments} envio(s)
            separado(s). Economia estimada de frete: <strong>{brl(preview.estimatedSaving)}</strong>{" "}
            (referência de {brl(REFERENCE_FREIGHT)} por envio).
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || groups.length === 0}>
            {mut.isPending ? "Aprovando…" : "Aprovar remessa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

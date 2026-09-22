import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronUp,
  List,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { GradeSelect } from "@/components/vinyl/grade-select";
import { HideableBar } from "@/components/vinyl/hideable-bar";
import { MobileTopToggle } from "@/components/vinyl/mobile-top-toggle";
import { groupWatchedByHouse } from "@/components/vinyl/grouping";
import { OwnedPanel } from "@/components/vinyl/owned-panel";
import { PurchaseCard } from "@/components/vinyl/purchase-card";
import { AI_PROVIDER_SHORT, formatFailoverTrail, type AiProvider } from "@/lib/ai-provider";
import {
  addCollectionItem,
  getCollection,
  identifyPurchaseDraft,
} from "@/lib/collection.functions";
import type { CollectionItem } from "@/lib/collection.server";
import {
  applyCollectionDecision,
  getCollectionFeedback,
  getCollectionLinks,
} from "@/lib/leiloesbr.functions";
import type { Purchase } from "@/lib/purchases.server";
import { getPurchases, scanPurchases, scanPurchasesFull } from "@/lib/purchases.functions";
import { extractArtist, titleCase } from "@/lib/vinyl-parse";
import {
  lotIdentity,
  ownedSignatureFromLot,
  resolveOwned,
  type CollectionLinks,
  type OwnedFeedback,
  type OwnedHit,
  type OwnedResolution,
} from "@/lib/wantlist-match";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Compras — Garimpo de Vinil" }] }),
  component: ComprasPage,
});

type ViewMode = "flat" | "day" | "house";

// --- "Enviar para a coleção": edita e cria um disco novo a partir de uma compra ---
type SendDraft = {
  purchase: Purchase;
  artist: string;
  album: string;
  year: string;
  conditionMedia: string;
  conditionSleeve: string;
  notes: string;
  description: string;
  tags: string;
};

/** Palpite inicial (editável) a partir do título da compra — mesma heurística usada na home. */
function draftFromPurchase(p: Purchase): SendDraft {
  const guess = extractArtist(p.title);
  return {
    purchase: p,
    artist: guess ? titleCase(guess) : "",
    album: "",
    year: "",
    conditionMedia: "",
    conditionSleeve: "",
    notes: "",
    description: "",
    tags: "",
  };
}

/** Acrescenta as tags da IA (sem duplicar, sem caixa) às tags já digitadas (texto "a, b, c"). */
function mergeTagsText(current: string, incoming: string[]): string {
  const out = current
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const t of incoming) {
    const v = t.trim();
    if (v && !seen.has(v.toLowerCase())) {
      out.push(v);
      seen.add(v.toLowerCase());
    }
  }
  return out.join(", ");
}

function dayHeaderLabel(day: string): string {
  if (!day) return "Sem data";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  return `${weekday.replace(".", "")} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function groupByDay(purchases: Purchase[]): { day: string; purchases: Purchase[] }[] {
  const map = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const key = p.wonDate ?? "";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([day, list]) => ({ day, purchases: list }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

// `groupWatchedByHouse` exige `houseUrl` (usado noutras telas p/ "site da casa"); aqui não
// exibimos esse link (Purchase não tem a URL da casa, só do lote), então só satisfazemos o tipo.
function groupPurchasesByHouse(purchases: Purchase[]) {
  return groupWatchedByHouse(purchases.map((p) => ({ ...p, houseUrl: p.url })));
}

function ComprasPage() {
  const [barsHidden, setBarsHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const queryClient = useQueryClient();
  const fetchPurchases = useServerFn(getPurchases);
  const scan = useServerFn(scanPurchases);
  const scanFull = useServerFn(scanPurchasesFull);

  const query = useQuery<Purchase[]>({
    queryKey: ["purchases"] as const,
    queryFn: () => fetchPurchases() as Promise<Purchase[]>,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const purchases = useMemo(() => query.data ?? [], [query.data]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["purchases"] });

  // Coleção + relação manual ("já tenho") — mesma infraestrutura da home (`collection_links`/
  // `collection_feedback`), reaproveitada aqui pelo `lotId` da compra (peça exata arrematada).
  const fetchCollection = useServerFn(getCollection);
  const fetchCollectionLinks = useServerFn(getCollectionLinks);
  const fetchCollectionFeedback = useServerFn(getCollectionFeedback);
  const runApplyDecision = useServerFn(applyCollectionDecision);
  const sendToCollection = useServerFn(addCollectionItem);

  const collectionQuery = useQuery<CollectionItem[]>({
    queryKey: ["collection"] as const,
    queryFn: () => fetchCollection() as Promise<CollectionItem[]>,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const collectionLinksQuery = useQuery({
    queryKey: ["collection-links"] as const,
    queryFn: () => fetchCollectionLinks(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const collectionFeedbackQuery = useQuery({
    queryKey: ["collection-feedback"] as const,
    queryFn: () => fetchCollectionFeedback(),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const collById = useMemo(
    () => new Map((collectionQuery.data ?? []).map((i) => [i.id, i])),
    [collectionQuery.data],
  );
  // `lot_id` das peças EXATAS já enviadas à coleção → id do item (casamento 100% preciso).
  const ownedByLotId = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of collectionQuery.data ?? []) if (it.lotId) map.set(it.lotId, it.id);
    return map;
  }, [collectionQuery.data]);
  const collLabel = (id: string) => {
    const it = collById.get(id);
    return it ? [it.artist, it.album].filter(Boolean).join(" — ") || it.title : "";
  };

  const links: CollectionLinks = collectionLinksQuery.data ?? {};
  const feedback: OwnedFeedback[] = collectionFeedbackQuery.data ?? [];
  const ownedResolutionFor = (p: Purchase): OwnedResolution => {
    try {
      const exactId = ownedByLotId.get(p.lotId);
      const autoHit: OwnedHit | null = exactId
        ? { id: exactId, label: collLabel(exactId), score: 1 }
        : null;
      return resolveOwned(p.lotId, links, autoHit, feedback, lotIdentity({ title: p.title }));
    } catch {
      return { kind: "none" };
    }
  };
  const ownedLabelFor = (p: Purchase): string | null => {
    const res = ownedResolutionFor(p);
    switch (res.kind) {
      case "linked":
        return collLabel(res.itemId) || "(sem nome)";
      case "auto":
        return res.hit.label || "(sem nome)";
      default:
        return null; // suggested/rejected/none → não conta como "já enviado"
    }
  };

  const [ownedPanelPurchase, setOwnedPanelPurchase] = useState<Purchase | null>(null);
  const sigForPurchase = (p: Purchase) => ownedSignatureFromLot({ title: p.title });
  const applyDecision = (p: Purchase, value: string | false | null, itemId: string | null) => {
    const sig = sigForPurchase(p);
    const prevLinks = collectionLinksQuery.data ?? {};
    const prevFeedback = collectionFeedbackQuery.data ?? [];
    queryClient.setQueryData<CollectionLinks>(["collection-links"], (old) => {
      const next = { ...(old ?? {}) };
      if (value === null) delete next[p.lotId];
      else next[p.lotId] = value;
      return next;
    });
    queryClient.setQueryData<OwnedFeedback[]>(["collection-feedback"], (old) => {
      const kept = (old ?? []).filter((e) => e.lotId !== p.lotId);
      if (value === null || !itemId) return kept;
      return [
        ...kept,
        {
          lotId: p.lotId,
          itemId,
          verdict: value === false ? "neg" : "pos",
          artist: sig.artist,
          album: sig.album,
          year: sig.year,
        },
      ];
    });
    void runApplyDecision({ data: { lotId: p.lotId, value, itemId, sig } })
      .catch((error: unknown) => {
        queryClient.setQueryData(["collection-links"], prevLinks);
        queryClient.setQueryData(["collection-feedback"], prevFeedback);
        toast.error((error as Error)?.message || "Não foi possível salvar a relação");
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["collection-links"] });
        void queryClient.invalidateQueries({ queryKey: ["collection-feedback"] });
      });
  };

  const [sendDraft, setSendDraft] = useState<SendDraft | null>(null);
  const sendMut = useMutation({
    mutationFn: (d: SendDraft) =>
      sendToCollection({
        data: {
          lotId: d.purchase.lotId,
          artist: d.artist,
          album: d.album,
          title: d.purchase.title,
          year: d.year.trim() ? Number(d.year) || null : null,
          image: d.purchase.image,
          house: d.purchase.house,
          uf: d.purchase.uf,
          wonPrice: d.purchase.wonPrice,
          wonDate: d.purchase.wonDate,
          conditionMedia: d.conditionMedia,
          conditionSleeve: d.conditionSleeve,
          notes: d.notes,
          description: d.description,
          tags: d.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collection"] });
      setSendDraft(null);
      toast.success("Disco enviado para a coleção.");
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível enviar para a coleção"),
  });

  // "Identificar pela IA" no diálogo de envio: preenche artista/álbum/ano/descritivo/tags a
  // partir só do título da compra (mesmo prompt/modelo do reprocessar da Coleção), sem persistir
  // nada — o usuário confere e ajusta antes de "Enviar".
  const identifyDraftFn = useServerFn(identifyPurchaseDraft);
  const [identifyingDraft, setIdentifyingDraft] = useState(false);
  async function runIdentifyDraft() {
    if (!sendDraft) return;
    setIdentifyingDraft(true);
    try {
      const res = (await identifyDraftFn({
        data: {
          title: sendDraft.purchase.title,
          artist: sendDraft.artist,
          album: sendDraft.album,
          year: sendDraft.year.trim() ? Number(sendDraft.year) || null : null,
        },
      })) as {
        artist: string;
        album: string;
        year: number | null;
        description: string;
        tags: string[];
        served: AiProvider | null;
        switched: boolean;
        error: string | null;
        attemptErrors?: Partial<Record<AiProvider, string>>;
      };
      setSendDraft((d) =>
        d
          ? {
              ...d,
              artist: res.artist || d.artist,
              album: res.album || d.album,
              year: res.year != null ? String(res.year) : d.year,
              description: res.description || d.description,
              tags: res.tags.length ? mergeTagsText(d.tags, res.tags) : d.tags,
            }
          : d,
      );
      if (res.switched && res.served) {
        const trail = formatFailoverTrail(res.attemptErrors ?? {});
        toast.warning(
          trail
            ? `${trail} — usei ${AI_PROVIDER_SHORT[res.served]}`
            : `Provedor de IA indisponível — usei ${AI_PROVIDER_SHORT[res.served]}`,
        );
      }
      if (!res.artist && !res.album && !res.description) {
        toast.error(
          res.error
            ? `A IA não retornou identificação (${res.error}) — verifique a chave/limite`
            : "A IA não encontrou nada para este título.",
        );
      } else {
        toast.success("Dados preenchidos pela IA — confira antes de enviar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao identificar pela IA");
    } finally {
      setIdentifyingDraft(false);
    }
  }

  const onScanSuccess = (res: { added: number; scanned: number; auctionsChecked?: number }) => {
    void invalidate();
    toast.success(
      res.added > 0
        ? `${res.added} compra(s) adicionada(s).`
        : "Nada novo. Se você tem compras recentes e nada aparece, tente a varredura completa.",
    );
  };
  const onScanError = (e: Error) => toast.error(e.message || "Falha ao varrer as compras");

  const scanMut = useMutation({
    mutationFn: () => scan(),
    onSuccess: onScanSuccess,
    onError: onScanError,
  });

  const scanFullMut = useMutation({
    mutationFn: () => scanFull(),
    onSuccess: onScanSuccess,
    onError: onScanError,
  });

  const byDay = useMemo(() => groupByDay(purchases), [purchases]);
  const byHouse = useMemo(() => groupPurchasesByHouse(purchases), [purchases]);
  const byHouseWithDays = useMemo(
    () => byHouse.map((h) => ({ ...h, byDay: groupByDay(h.lots) })),
    [byHouse],
  );

  return (
    <main className="min-h-screen bg-background">
      <MobileTopToggle collapsed={barsHidden} onToggle={() => setBarsHidden((c) => !c)} />
      <HideableBar hidden={barsHidden} className="top-0 z-30">
        <div className="border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-5">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Link>
                </Button>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                  <ShoppingBag className="h-5 w-5 text-primary" />
                  Compras
                </h1>
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
                Vinis arrematados ("Minhas compras"), mais recentes primeiro.
              </p>
            </div>
            <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0">
              <Button
                size="sm"
                onClick={() => scanMut.mutate()}
                disabled={scanMut.isPending}
                title="Varrer leilões vencidos (Meus lances) e atualizar as compras"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${scanMut.isPending ? "animate-spin" : ""}`} />
                {scanMut.isPending ? "Atualizando…" : "Atualizar"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => scanFullMut.mutate()}
                disabled={scanFullMut.isPending}
                title="Varredura completa de 'Minhas compras' (todas as páginas) — use se uma compra não aparecer"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${scanFullMut.isPending ? "animate-spin" : ""}`}
                />
                {scanFullMut.isPending ? "Varrendo…" : "Varredura completa"}
              </Button>
            </div>
          </div>

          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1.5 px-4 pb-2 sm:gap-2 sm:pb-3">
            <ViewToggle
              icon={List}
              label="Mais recentes"
              active={viewMode === "flat"}
              onClick={() => setViewMode("flat")}
            />
            <ViewToggle
              icon={Calendar}
              label="Por dia"
              active={viewMode === "day"}
              onClick={() => setViewMode("day")}
            />
            <ViewToggle
              icon={Store}
              label="Por casa"
              active={viewMode === "house"}
              onClick={() => setViewMode("house")}
            />
            <span className="text-xs text-muted-foreground">{purchases.length} compra(s)</span>
          </div>
        </div>
      </HideableBar>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : purchases.length === 0 ? (
          <EmptyState onScan={() => scanMut.mutate()} scanning={scanMut.isPending} />
        ) : viewMode === "flat" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {purchases.map((p) => (
              <PurchaseCard
                key={p.id}
                purchase={p}
                ownedLabel={ownedLabelFor(p)}
                onOpenOwned={() => setOwnedPanelPurchase(p)}
                onSend={() => setSendDraft(draftFromPurchase(p))}
              />
            ))}
          </div>
        ) : viewMode === "day" ? (
          <div className="space-y-8">
            {byDay.map((group, index) => (
              <DaySection
                key={group.day || "sem-data"}
                day={group.day}
                purchases={group.purchases}
                defaultOpen={index === 0}
                nestByHouse
                ownedLabelFor={ownedLabelFor}
                onOpenOwned={setOwnedPanelPurchase}
                onSend={(p) => setSendDraft(draftFromPurchase(p))}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {byHouseWithDays.map((group) => (
              <section key={group.house}>
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {group.house || "(casa não identificada)"}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({group.lots.length})
                  </span>
                </h2>
                <div className="space-y-4">
                  {group.byDay.map((dayGroup, index) => (
                    <DaySection
                      key={dayGroup.day || "sem-data"}
                      day={dayGroup.day}
                      purchases={dayGroup.purchases}
                      defaultOpen={index === 0}
                      nestByHouse={false}
                      ownedLabelFor={ownedLabelFor}
                      onOpenOwned={setOwnedPanelPurchase}
                      onSend={(p) => setSendDraft(draftFromPurchase(p))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {ownedPanelPurchase
        ? (() => {
            const p = ownedPanelPurchase;
            const res = ownedResolutionFor(p);
            const relatedId =
              res.kind === "linked" || res.kind === "suggested"
                ? res.itemId
                : res.kind === "auto"
                  ? res.hit.id
                  : null;
            const relatedItem = relatedId ? (collById.get(relatedId) ?? null) : null;
            return (
              <OwnedPanel
                open
                onClose={() => setOwnedPanelPurchase(null)}
                lotTitle={p.title}
                resolution={res}
                relatedItem={relatedItem}
                collection={collectionQuery.data ?? []}
                busy={collectionLinksQuery.isFetching || collectionFeedbackQuery.isFetching}
                onConfirm={() => {
                  if (relatedId) applyDecision(p, relatedId, relatedId);
                  setOwnedPanelPurchase(null);
                }}
                onReject={() => {
                  applyDecision(p, false, relatedId);
                  setOwnedPanelPurchase(null);
                }}
                onReactivate={() => {
                  applyDecision(p, null, null);
                  setOwnedPanelPurchase(null);
                }}
                onLink={(itemId) => {
                  applyDecision(p, itemId, itemId);
                  setOwnedPanelPurchase(null);
                }}
              />
            );
          })()
        : null}

      <SendToCollectionDialog
        draft={sendDraft}
        sending={sendMut.isPending}
        identifying={identifyingDraft}
        onChange={setSendDraft}
        onClose={() => setSendDraft(null)}
        onSend={() => sendDraft && sendMut.mutate(sendDraft)}
        onIdentify={() => void runIdentifyDraft()}
      />
    </main>
  );
}

function DaySection({
  day,
  purchases,
  defaultOpen,
  nestByHouse,
  ownedLabelFor,
  onOpenOwned,
  onSend,
}: {
  day: string;
  purchases: Purchase[];
  defaultOpen: boolean;
  nestByHouse: boolean; // true na visão "por dia" (sub-agrupa por casa); false dentro de "por casa"
  ownedLabelFor: (p: Purchase) => string | null;
  onOpenOwned: (p: Purchase) => void;
  onSend: (p: Purchase) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const houseGroups = useMemo(
    () => (nestByHouse ? groupPurchasesByHouse(purchases) : null),
    [nestByHouse, purchases],
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-foreground"
      >
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {dayHeaderLabel(day)}
        <span className="text-xs font-normal text-muted-foreground">({purchases.length})</span>
      </button>

      {open ? (
        <div className="mt-3">
          {houseGroups ? (
            <div className="space-y-4">
              {houseGroups.map((hg) => (
                <div key={hg.house || "sem-casa"}>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                    {hg.house || "(casa não identificada)"}
                    <span className="ml-1.5">({hg.lots.length})</span>
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {hg.lots.map((p) => (
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
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {purchases.map((p) => (
                <PurchaseCard
                  key={p.id}
                  purchase={p}
                  ownedLabel={ownedLabelFor(p)}
                  onOpenOwned={() => onOpenOwned(p)}
                  onSend={() => onSend(p)}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ViewToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof List;
  label: string;
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
          ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
          : "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
      }
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-16 text-center">
      <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium text-foreground">Nenhuma compra encontrada.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Clique em "Atualizar" para varrer os leilões que você venceu.
      </p>
      <Button size="sm" className="mt-4" onClick={onScan} disabled={scanning}>
        <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
        {scanning ? "Atualizando…" : "Atualizar"}
      </Button>
    </div>
  );
}

function SendField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SendToCollectionDialog({
  draft,
  sending,
  identifying,
  onChange,
  onClose,
  onSend,
  onIdentify,
}: {
  draft: SendDraft | null;
  sending: boolean;
  identifying: boolean;
  onChange: (d: SendDraft) => void;
  onClose: () => void;
  onSend: () => void;
  onIdentify: () => void;
}) {
  const set = (patch: Partial<SendDraft>) => draft && onChange({ ...draft, ...patch });
  const busy = sending || identifying;

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar para a coleção</DialogTitle>
        </DialogHeader>
        {draft ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <div className="flex items-center justify-between gap-2 sm:col-span-2">
              <p className="text-sm text-muted-foreground">
                {draft.purchase.title || "(sem título)"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onIdentify}
                disabled={busy}
                title="Identificar artista/álbum/ano e gerar um descritivo pela IA (só texto, a partir do título)"
              >
                <Sparkles className={`mr-2 h-4 w-4 ${identifying ? "animate-pulse" : ""}`} />
                {identifying ? "Identificando…" : "Identificar pela IA"}
              </Button>
            </div>
            <SendField label="Artista">
              <Input value={draft.artist} onChange={(e) => set({ artist: e.target.value })} />
            </SendField>
            <SendField label="Álbum">
              <Input value={draft.album} onChange={(e) => set({ album: e.target.value })} />
            </SendField>
            <SendField label="Ano">
              <Input
                value={draft.year}
                inputMode="numeric"
                onChange={(e) => set({ year: e.target.value })}
              />
            </SendField>
            <SendField label="Estado da mídia">
              <GradeSelect
                value={draft.conditionMedia}
                onChange={(v) => set({ conditionMedia: v })}
                ariaLabel="Estado da mídia"
              />
            </SendField>
            <SendField label="Estado da capa">
              <GradeSelect
                value={draft.conditionSleeve}
                onChange={(v) => set({ conditionSleeve: v })}
                ariaLabel="Estado da capa"
              />
            </SendField>
            <div className="sm:col-span-2">
              <SendField label="Tags (separadas por vírgula)">
                <Input
                  value={draft.tags}
                  placeholder="MPB, prioridade, raro"
                  onChange={(e) => set({ tags: e.target.value })}
                />
              </SendField>
            </div>
            <div className="sm:col-span-2">
              <SendField label="Descritivo do disco (preenchido pela IA — editável)">
                <textarea
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={3}
                  placeholder="Descrição do disco (artista, estilo, época, relevância)…"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </SendField>
            </div>
            <div className="sm:col-span-2">
              <SendField label="Notas">
                <textarea
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </SendField>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {sending ? "Enviando…" : "Enviar"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

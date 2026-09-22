import { Disc3, ExternalLink, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Purchase } from "@/lib/purchases.server";

/** dd/mm/aaaa a partir de "yyyy-mm-dd" (ou "" se ausente/inválida). */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

export function PurchaseCard({
  purchase,
  ownedLabel,
  onOpenOwned,
  onSend,
}: {
  purchase: Purchase;
  /** Rótulo do disco da Coleção relacionado a esta compra, ou `null` se nenhuma relação. */
  ownedLabel: string | null;
  /** Abre o painel de relação com a Coleção (ver/confirmar/vincular/"não tenho"). */
  onOpenOwned: () => void;
  /** Abre o diálogo "Enviar para a coleção" (edita e cria um novo disco a partir desta compra). */
  onSend: () => void;
}) {
  const dateLabel = formatDate(purchase.wonDate);
  const alt = purchase.title || "lote arrematado";

  return (
    <article className="relative flex flex-col overflow-hidden rounded-md border border-border bg-card">
      {purchase.url ? (
        <a href={purchase.url} target="_blank" rel="noreferrer" className="block bg-secondary">
          <CardImage image={purchase.image} alt={alt} />
        </a>
      ) : (
        <div className="block bg-secondary">
          <CardImage image={purchase.image} alt={alt} />
        </div>
      )}

      <button
        type="button"
        onClick={onOpenOwned}
        title={
          ownedLabel
            ? `Já na Coleção: ${ownedLabel} — toque para ajustar a relação`
            : "Relacionar com um disco da Coleção"
        }
        className={
          ownedLabel
            ? "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
            : "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow"
        }
      >
        <Disc3 className="h-4 w-4" />
      </button>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {purchase.title || "(sem título)"}
        </p>
        <p className="text-xs text-muted-foreground">
          {[purchase.house, purchase.uf].filter(Boolean).join(" — ")}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {purchase.wonPrice ? (
            <span className="font-semibold text-primary" title="Valor pago">
              {purchase.wonPrice}
            </span>
          ) : null}
          {dateLabel ? <span>{dateLabel}</span> : null}
          {purchase.lote ? <span>Lote {purchase.lote}</span> : null}
        </div>

        {purchase.url ? (
          <a
            href={purchase.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Ver no leiloeiro <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}

        {ownedLabel ? (
          <p className="text-xs text-muted-foreground">
            Na Coleção: <span className="text-foreground">{ownedLabel}</span>
          </p>
        ) : (
          <Button size="sm" variant="outline" onClick={onSend}>
            <Send className="mr-2 h-3.5 w-3.5" />
            Enviar para a coleção
          </Button>
        )}
      </div>
    </article>
  );
}

function CardImage({ image, alt }: { image: string | null; alt: string }) {
  return image ? (
    <img src={image} alt={alt} loading="lazy" className="h-44 w-full object-contain p-2" />
  ) : (
    <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">
      sem imagem
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Store } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { HouseLight } from "@/components/vinyl/house-light";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { lotHouse } from "@/lib/house-rating";
import { queryKeys, useHouseRatingsQuery } from "@/lib/queries";
import { setPregaoStore } from "@/lib/purchases.functions";
import { cn } from "@/lib/utils";

/** Loja informada para o pregão ("" = nenhuma): vem do mesmo mapa usado em Compras. */
function useAuctionStore(idLeilao: string | undefined): string {
  const { data } = useHouseRatingsQuery();
  return ((idLeilao && data?.stores?.[idLeilao]) || "").trim();
}

/**
 * Loja do pregão, no cabeçalho do catálogo (Dia, Vigiados, Lances). Casas que hospedam várias lojas
 * (ex.: Alberto Lopes) mostram o nome do leiloeiro como casa; aqui você informa a loja de verdade
 * uma vez por pregão e o semáforo, a mala de guarda e o selo "sem guarda" passam a ser da loja.
 * Sem loja informada mostra só o ícone discreto para informar.
 */
export function AuctionStore({
  idLeilao,
  house,
  className,
}: {
  idLeilao: string;
  house: string;
  className?: string;
}) {
  const store = useAuctionStore(idLeilao);
  const { data } = useHouseRatingsQuery();
  const queryClient = useQueryClient();
  const save = useServerFn(setPregaoStore);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(store);
  useEffect(() => setValue(store), [store]);
  const listId = useId();
  const known = [...new Set(Object.values(data?.stores ?? {}))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const mutation = useMutation({
    mutationFn: (next: string) => save({ data: { idLeilao, store: next } }),
    onSuccess: (_r, next) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.houseRatings });
      void queryClient.invalidateQueries({ queryKey: ["purchase-shipping"] });
      void queryClient.invalidateQueries({ queryKey: ["purchases"] });
      setOpen(false);
      toast.success(next.trim() ? "Loja salva." : "Loja removida.");
    },
    onError: (e: Error) => {
      setValue(store);
      toast.error(e.message || "Não foi possível salvar a loja");
    },
  });

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {store ? (
        <>
          <HouseLight house={lotHouse(data?.stores, idLeilao, house)} />
          <span
            className="text-xs font-medium text-foreground"
            title={`Loja do pregão ${idLeilao} (casa no LeilõesBR: ${house})`}
          >
            {store}
          </span>
        </>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            title={store ? "Trocar a loja deste pregão" : "Informar a loja deste pregão"}
            aria-label={store ? "Trocar a loja deste pregão" : "Informar a loja deste pregão"}
            className={cn(
              "inline-flex shrink-0 items-center rounded-full p-1 hover:bg-secondary",
              store ? "text-primary" : "text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <Store className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)] space-y-2 p-3">
          <p className="text-xs font-semibold text-foreground">Loja do pregão {idLeilao}</p>
          <p className="text-xs text-muted-foreground">
            Use quando a casa ({house}) leiloa para outra loja. Deixe vazio se a casa é a própria
            loja.
          </p>
          <Input
            value={value}
            list={listId}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") mutation.mutate(value);
            }}
            placeholder={house}
            maxLength={80}
            className="h-8"
          />
          <datalist id={listId}>
            {known.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            {store ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("")}
              >
                Remover
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending || value.trim() === store}
              onClick={() => mutation.mutate(value)}
            >
              Salvar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/** Nome da casa numa barra de lote: a loja do pregão (se informada) e, miúdo, "via" a casa do LeilõesBR. */
export function HouseNameWithStore({ house, idLeilao }: { house: string; idLeilao?: string }) {
  const store = useAuctionStore(idLeilao);
  if (!store) return <span className="font-bold">{house}</span>;
  return (
    <>
      <span className="font-bold">{store}</span>
      <span className="text-xs font-semibold">via {house}</span>
    </>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Store } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { HouseLight } from "@/components/vinyl/house-light";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeKey, type StoreSaveResult } from "@/lib/auction-contact";
import { lotHouse } from "@/lib/house-rating";
import { queryKeys, useHouseRatingsQuery } from "@/lib/queries";
import { readPregaoContacts, resolveStoreLink, setPregaoStore } from "@/lib/purchases.functions";
import { cn } from "@/lib/utils";

/** Loja informada para o pregão ("" = nenhuma): vem do mesmo mapa usado em Compras. */
function useAuctionStore(idLeilao: string | undefined): string {
  const { data } = useHouseRatingsQuery();
  return ((idLeilao && data?.stores?.[idLeilao]) || "").trim();
}

/** Aviso depois de salvar a loja: o que foi lido da página do pregão. */
function captureMessage(result: StoreSaveResult | undefined): string {
  const c = result?.capture;
  if (!c) return "Loja salva.";
  if (c.status === "saved") {
    const keys = [...c.strong, ...c.weak].slice(0, 3).join(", ");
    return `Loja salva. Guardei o contato desta loja (${keys}) para reconhecer os próximos pregões.`;
  }
  if (c.status === "no-contact")
    return `Loja salva. ${c.note} Os próximos pregões desta loja continuam manuais.`;
  return `Loja salva, mas não consegui ler os contatos: ${c.note}`;
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
  const readContacts = useServerFn(readPregaoContacts);
  const resolve = useServerFn(resolveStoreLink);
  const auto = data?.autoStores?.[idLeilao];
  const isAuto = auto !== undefined;
  const suggestion = data?.suggestions?.[idLeilao];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.houseRatings });
    void queryClient.invalidateQueries({ queryKey: ["purchase-shipping"] });
    void queryClient.invalidateQueries({ queryKey: ["purchases"] });
  };
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(store);
  useEffect(() => setValue(store), [store]);
  const listId = useId();
  const known = [...new Set(Object.values(data?.stores ?? {}))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const mutation = useMutation({
    mutationFn: (next: string) => save({ data: { idLeilao, store: next } }),
    onSuccess: (result, next) => {
      refresh();
      setOpen(false);
      if (next.trim()) toast.success(captureMessage(result as StoreSaveResult));
      else toast.success("Loja removida.");
    },
    onError: (e: Error) => {
      setValue(store);
      toast.error(e.message || "Não foi possível salvar a loja");
    },
  });

  const linkMutation = useMutation({
    mutationFn: (action: "accept" | "dismiss" | "undo") => resolve({ data: { idLeilao, action } }),
    onSuccess: (_r, action) => {
      refresh();
      setOpen(false);
      toast.success(
        action === "accept"
          ? "Loja confirmada."
          : action === "dismiss"
            ? "Combinado: não vou mais sugerir esta loja por esse contato."
            : "Vínculo automático desfeito.",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível concluir"),
  });
  const readMutation = useMutation({
    mutationFn: () => readContacts({ data: { idLeilao } }),
    onSuccess: (result) => {
      const c = (result as StoreSaveResult).capture;
      if (!c) toast.error("Não consegui ler a página.");
      else if (c.status === "failed") toast.error(c.note);
      else if (c.status === "no-contact") toast.message(c.note);
      else
        toast.success(
          `Contatos do "Local": ${c.strong.join(", ") || "nenhum"}. Fora do "Local": ${c.weak.join(", ") || "nenhum"}.`,
        );
    },
    onError: (e: Error) => toast.error(e.message || "Não consegui ler a página"),
  });

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {store ? (
        <>
          <HouseLight house={lotHouse(data?.stores, idLeilao, house)} />
          <span
            className="text-xs font-medium text-foreground"
            title={`Loja do pregão ${idLeilao} (casa no LeilõesBR: ${house})`}
          >
            {store}
          </span>
          {isAuto ? (
            <span
              className="rounded-full border border-primary/50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary"
              title={`Ligada sozinha pelo ${auto ? describeKey(auto) : "contato do pregão"}. Abra o ícone da loja para desfazer.`}
            >
              automático
            </span>
          ) : null}
        </>
      ) : null}
      {suggestion && !store ? (
        <span
          className="inline-flex flex-wrap items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
          title="Contato fora do bloco Local: é só uma pista, confirme antes de valer."
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          Parece ser da loja <b>{suggestion.store}</b> ({describeKey(suggestion.via)})
          <button
            type="button"
            disabled={linkMutation.isPending}
            onClick={() => linkMutation.mutate("accept")}
            className="rounded border border-amber-500/60 px-1 font-semibold hover:bg-amber-500/20"
          >
            Confirmar
          </button>
          <button
            type="button"
            disabled={linkMutation.isPending}
            onClick={() => linkMutation.mutate("dismiss")}
            className="rounded border border-border px-1 hover:bg-secondary"
          >
            Não é
          </button>
        </span>
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
          <button
            type="button"
            disabled={readMutation.isPending}
            onClick={() => readMutation.mutate()}
            className="text-left text-xs text-primary hover:underline"
          >
            {readMutation.isPending ? "Lendo a página…" : "Ler os contatos desta página"}
          </button>
          {isAuto ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={linkMutation.isPending}
              onClick={() => linkMutation.mutate("undo")}
            >
              Desfazer vínculo automático
            </Button>
          ) : null}
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

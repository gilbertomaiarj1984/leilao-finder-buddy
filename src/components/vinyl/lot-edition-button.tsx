import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers } from "lucide-react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { detectModernReissue, type LotEdition } from "@/lib/album-edition";
import { setLotEditionFn } from "@/lib/lookout.functions";
import { queryKeys, useLotEditionsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const OPTIONS: { value: LotEdition; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "Não é reedição (desfaz a sugestão do título)" },
  {
    value: "period",
    label: "Reedição de época",
    hint: "Reedição antiga: continua sendo o mesmo disco do original",
  },
  {
    value: "modern",
    label: "Reedição moderna",
    hint: "Relançamento recente: é outro disco (não casa com o original no De olho)",
  },
];

/**
 * Edição do LOTE (original / reedição de época / reedição moderna). Sem marcação manual vale a
 * sugestão das palavras do título ("180g", "remasterizado"…); o clique grava a sobrescrita (vale em
 * todos os aparelhos). A de época só importa para discos homônimos; a moderna impede casar o lote
 * com o original do De olho. Mesmo padrão do `ReevaluateIconButton`: autônomo, só precisa do lote.
 */
export function LotEditionButton({
  lotId,
  title,
  className,
}: {
  lotId: string;
  title: string;
  /** Substitui o visual padrão (botão `ghost` pequeno) — ex.: os botões grandes do celular. */
  className?: string;
}) {
  const qc = useQueryClient();
  const editionsQuery = useLotEditionsQuery();
  const save = useServerFn(setLotEditionFn);
  const override = editionsQuery.data?.[lotId] ?? null;
  const auto = detectModernReissue(title) ? "modern" : null;
  const effective: LotEdition | null = override ?? auto;

  const mutation = useMutation({
    mutationFn: (edition: LotEdition | null) => save({ data: { lotId, edition } }),
    onMutate: async (edition) => {
      await qc.cancelQueries({ queryKey: queryKeys.lotEditions });
      const prev = qc.getQueryData<Record<string, LotEdition>>(queryKeys.lotEditions) ?? {};
      const next = { ...prev };
      if (edition) next[lotId] = edition;
      else delete next[lotId];
      qc.setQueryData(queryKeys.lotEditions, next);
      return { prev };
    },
    onError: (e: Error, _edition, ctx) => {
      if (ctx) qc.setQueryData(queryKeys.lotEditions, ctx.prev);
      toast.error(e.message || "Não foi possível salvar a edição");
    },
    onSettled: () => {
      // O casamento do De olho depende da edição: refaz o resumo calculado no servidor.
      void qc.invalidateQueries({ queryKey: queryKeys.lotEditions });
      void qc.invalidateQueries({ queryKey: queryKeys.lookoutOverview });
    },
  });

  const label =
    effective === "modern"
      ? "Reedição moderna"
      : effective === "period"
        ? "Reedição de época"
        : effective === "original"
          ? "Original"
          : "Edição não informada";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={`Edição: ${label}${override ? "" : auto ? " (sugerida pelo título)" : ""}`}
          aria-label="Marcar edição do lote (original ou reedição)"
          className={cn(className ?? buttonVariants({ size: "sm", variant: "ghost" }))}
        >
          <Layers
            className={cn(
              className ? "h-5 w-5" : "h-4 w-4",
              effective === "modern"
                ? "text-amber-600 dark:text-amber-400"
                : effective === "period"
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-muted-foreground",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-medium text-foreground">Edição deste lote</p>
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 text-xs text-foreground"
            title={o.hint}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-fuchsia-600"
              checked={effective === o.value}
              onChange={(e) => mutation.mutate(e.target.checked ? o.value : null)}
            />
            <span>
              {o.label}
              {o.value === "modern" && !override && auto ? (
                <span className="block text-[10px] text-muted-foreground">
                  pré-marcada pelas palavras do título
                </span>
              ) : null}
            </span>
          </label>
        ))}
        {override ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
            onClick={() => mutation.mutate(null)}
          >
            Voltar à sugestão automática
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

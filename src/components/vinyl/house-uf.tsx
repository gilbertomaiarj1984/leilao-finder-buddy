import { houseKey } from "@/lib/house-rating";
import { useHouseUfsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * UF da casa (RJ, SP…) ao lado do nome, em qualquer tela. `uf` explícito (quando o item já
 * traz) vence; senão vem do mapa por casa (`useHouseUfsQuery`, da tabela `lots`). Sem UF, nada.
 */
export function HouseUf({
  house,
  uf,
  className,
}: {
  house: string;
  uf?: string | null;
  className?: string;
}) {
  const { data } = useHouseUfsQuery();
  const value = (uf?.trim() || data?.[houseKey(house)]) ?? "";
  if (!value) return null;
  return (
    <span
      title={`Casa de leilão em ${value}`}
      className={cn("shrink-0 text-xs font-medium text-muted-foreground", className)}
    >
      {value}
    </span>
  );
}

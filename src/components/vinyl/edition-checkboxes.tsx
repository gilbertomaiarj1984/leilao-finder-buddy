import type { Edition } from "@/lib/album-edition";
import { cn } from "@/lib/utils";

/**
 * Caixas de seleção da EDIÇÃO de um disco/lote (ver `lib/album-edition.ts`):
 *  - **Reedição moderna** — outro disco para o colecionador (não casa com o original, não conta
 *    como "já tenho" dele);
 *  - **Reedição de época** — o MESMO disco do original, mesmo com ano diferente (homônimos).
 * Mutuamente exclusivas; desmarcar a ativa volta a "disco normal" (`null`). `autoModern` mostra
 * que a marca moderna foi sugerida pelas palavras do título (o usuário pode desmarcar).
 */
export function EditionCheckboxes({
  value,
  onChange,
  autoModern = false,
  disabled = false,
  className,
}: {
  value: Edition | null;
  onChange: (next: Edition | null) => void;
  autoModern?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const box = (edition: Edition, label: string, hint: string) => (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground"
      title={hint}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-fuchsia-600"
        checked={value === edition}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? edition : null)}
      />
      {label}
      {edition === "modern" && autoModern && value === "modern" ? (
        <span className="text-[10px] text-muted-foreground">(sugerida pelo título)</span>
      ) : null}
    </label>
  );
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {box(
        "modern",
        "Reedição moderna",
        "Relançamento recente: é outro disco (não casa com o original nem conta como já tenho dele)",
      )}
      {box(
        "period",
        "Reedição de época",
        "Reedição antiga do MESMO disco do original (vale para discos homônimos de anos diferentes)",
      )}
    </div>
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GRADE_ORDER } from "@/lib/grading";

// Radix Select não aceita item com value "" → sentinela para "não definido".
const GRADE_NONE = "__none__";

/** Select da escala de conservação (grading) de 10 graus (M…F/P) — mídia e capa. */
export function GradeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value || GRADE_NONE} onValueChange={(v) => onChange(v === GRADE_NONE ? "" : v)}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue placeholder="Não definido" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={GRADE_NONE}>Não definido</SelectItem>
        {GRADE_ORDER.map((g) => (
          <SelectItem key={g} value={g}>
            {g}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

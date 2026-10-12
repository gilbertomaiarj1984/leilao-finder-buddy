import type { RatingLevel } from "@/lib/house-rating";
import { cn } from "@/lib/utils";

const LEVEL_DOT: Record<RatingLevel, string> = {
  verde: "bg-green-500",
  amarelo: "bg-yellow-400",
  laranja: "bg-orange-500",
  vermelho: "bg-red-500",
};

export function LevelDot({ level, className }: { level: RatingLevel | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-3 w-3 shrink-0 rounded-full",
        level ? LEVEL_DOT[level] : "border border-dashed border-muted-foreground/60",
        className,
      )}
    />
  );
}

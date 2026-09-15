import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Botão flutuante (canto superior direito, só no mobile — `sm:hidden`) para
 * abrir/fechar manualmente o topo (header + barras `sticky` aninhadas via
 * `HideableBar`). Fica FORA da área que recolhe (position fixed própria),
 * senão sumiria junto com o topo e o usuário não teria como reabrir.
 */
export function MobileTopToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Mostrar topo" : "Esconder topo"}
      aria-expanded={!collapsed}
      title={collapsed ? "Mostrar topo" : "Esconder topo"}
      className="fixed top-2 right-2 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:border-primary hover:text-primary sm:hidden"
    >
      {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
    </button>
  );
}

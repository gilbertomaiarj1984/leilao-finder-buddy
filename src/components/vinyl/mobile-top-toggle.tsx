import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Botão flutuante (canto superior direito) para abrir/fechar manualmente o topo
 * (header + barras `sticky` aninhadas via `HideableBar`). Fica FORA da área que
 * recolhe (position fixed própria), senão sumiria junto com o topo e o usuário
 * não teria como reabrir.
 *
 * Por padrão só aparece no mobile (`sm:hidden`) — passe `alwaysVisible` para
 * também aparecer no desktop (usado na tela inicial, onde o `HideableBar`
 * correspondente também recolhe no desktop via `collapseOnDesktop`).
 */
export function MobileTopToggle({
  collapsed,
  onToggle,
  alwaysVisible = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  alwaysVisible?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Mostrar topo" : "Esconder topo"}
      aria-expanded={!collapsed}
      title={collapsed ? "Mostrar topo" : "Esconder topo"}
      className={cn(
        "fixed top-2 right-2 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-colors hover:border-primary hover:text-primary",
        !alwaysVisible && "sm:hidden",
      )}
    >
      {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
    </button>
  );
}

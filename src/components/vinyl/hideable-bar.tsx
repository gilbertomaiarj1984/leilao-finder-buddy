import { forwardRef, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Envolve uma barra `sticky` (header/nav/tabs/filtros) e a recolhe com altura
 * animada quando `hidden` (ao invés de só deslocar via transform, o que
 * deixaria um vão em branco, já que o elemento sticky continua reservando
 * seu espaço no fluxo). O truque do grid-template-rows anima para qualquer
 * altura de conteúdo sem precisar medir via JS — e, como resultado, quando
 * o header (medido por `ResizeObserver` em `index.tsx`/`analise.tsx`) some,
 * sua altura reportada cai a 0 e as barras `stickyBelowHeader` colam certinho
 * no topo sozinhas.
 */
export const HideableBar = forwardRef<
  HTMLDivElement,
  {
    hidden: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
  }
>(function HideableBar({ hidden, className, style, children }, ref) {
  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        "sticky grid transition-[grid-template-rows] duration-300 ease-in-out",
        hidden ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
});

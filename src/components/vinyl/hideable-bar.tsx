import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Envolve uma barra `sticky` (header/nav/tabs/filtros) e a recolhe com altura
 * animada quando `hidden` (ao invés de só deslocar via transform, o que
 * deixaria um vão em branco, já que o elemento sticky continua reservando
 * seu espaço no fluxo). O truque do grid-template-rows anima para qualquer
 * altura de conteúdo sem precisar medir via JS.
 *
 * `overflow-anchor: none` evita que o navegador "compense" a mudança de
 * altura ajustando sozinho o scroll (scroll anchoring) — isso brigava com
 * `useHideOnScroll` e causava barras piscando/pulando de posição.
 *
 * Importante para quem mede a altura do header (`ResizeObserver`, para
 * outras barras colarem logo abaixo via `top`): a `ref` do observer deve ir
 * no elemento de CONTEÚDO passado como `children` (o `<header>`/`<div>`
 * visual), NUNCA neste wrapper — a altura deste wrapper é o que está sendo
 * animado (0 ⇄ natural), então observá-lo gera um vaivém de medições a cada
 * frame da transição (o bug de "piscar"). O conteúdo interno mantém sua
 * altura natural estável o tempo todo (só fica visualmente recortado pelo
 * `overflow-hidden` quando a linha do grid encolhe); combine essa altura
 * estável com o próprio `hidden` para decidir o `top` de barras abaixo
 * (`hidden ? 0 : headerHeight`), em vez de depender da medição acompanhar
 * o colapso sozinha.
 */
export function HideableBar({
  hidden,
  className,
  style,
  children,
}: {
  hidden: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={cn(
        "sticky grid [overflow-anchor:none] transition-[grid-template-rows,top] duration-300 ease-in-out",
        hidden ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

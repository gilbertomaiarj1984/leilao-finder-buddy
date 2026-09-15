import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Envolve uma barra `sticky` (header/nav/tabs/filtros) e a recolhe com altura
 * animada quando `hidden` (ao invés de só deslocar via transform, o que
 * deixaria um vão em branco, já que o elemento sticky continua reservando
 * seu espaço no fluxo). O truque do grid-template-rows anima para qualquer
 * altura de conteúdo sem precisar medir via JS.
 *
 * `hidden` só recolhe abaixo do breakpoint `sm` (`sm:grid-rows-[1fr]` sempre
 * vence) — o controle é o botão manual `MobileTopToggle`, que também só
 * aparece no mobile; no desktop o topo fica sempre visível, sem depender de
 * nenhum estado de coluna vir "certo" no resize.
 *
 * Esconder/mostrar é **manual** (clique no botão), não reage a scroll: uma
 * versão anterior tentava auto-esconder ao rolar (`useHideOnScroll`), mas o
 * próprio recálculo de altura de um elemento `sticky` durante a transição
 * gerava ruído de scroll que realimentava a lógica e ficava piscando sem
 * parar — removido em favor deste controle explícito do usuário.
 *
 * Importante para quem mede a altura do header (`ResizeObserver`, para
 * outras barras colarem logo abaixo via `top`): a `ref` do observer deve ir
 * no elemento de CONTEÚDO passado como `children` (o `<header>`/`<div>`
 * visual), NUNCA neste wrapper — a altura deste wrapper é o que está sendo
 * animado (0 ⇄ natural), então observá-lo gera um vaivém de medições a cada
 * frame da transição. O conteúdo interno mantém sua altura natural estável o
 * tempo todo (só fica visualmente recortado pelo `overflow-hidden` quando a
 * linha do grid encolhe); combine essa altura estável com o próprio `hidden`
 * para decidir o `top` de barras abaixo (`hidden ? 0 : headerHeight`), em vez
 * de depender da medição acompanhar o colapso sozinha.
 */
export function HideableBar({
  hidden,
  collapseOnDesktop = false,
  className,
  style,
  children,
}: {
  hidden: boolean;
  /** Por padrão `hidden` só recolhe abaixo do breakpoint `sm` (ver comentário acima). Passe
   * `true` para também recolher no desktop — usado pela barra de topo da tela inicial, cujo
   * botão de esconder/mostrar agora aparece em qualquer tamanho de tela. */
  collapseOnDesktop?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={cn(
        "sticky grid [overflow-anchor:none] transition-[grid-template-rows,top] duration-200 ease-in-out",
        hidden
          ? collapseOnDesktop
            ? "grid-rows-[0fr]"
            : "grid-rows-[0fr] sm:grid-rows-[1fr]"
          : "grid-rows-[1fr]",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

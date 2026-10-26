import { Building2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { cn } from "@/lib/utils";

import { houseNavLabels } from "./house-nav-utils";

/** Linha (em px, a partir do topo da janela) que separa "casa já passada" de "casa atual". */
const SPY_OFFSET = 200;

/**
 * Painel flutuante (só desktop largo, na margem esquerda do conteúdo) com atalhos para as casas
 * da listagem na tela. Lê do DOM as seções marcadas com `data-house-nav="<casa>"` dentro de
 * `rootRef` (grade do dia, vigiados do dia, Vigiados, Lances) e refaz a lista quando a tela muda
 * (troca de aba, filtro, busca…); destaca a casa que está no topo ao rolar.
 */
export function HouseNav({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [labels, setLabels] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const elsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-house-nav]"));
      elsRef.current = els;
      const next = houseNavLabels(els.map((el) => el.dataset.houseNav ?? ""));
      setLabels((prev) =>
        prev.length === next.length && prev.every((label, i) => label === next[i]) ? prev : next,
      );
      let current = -1;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= SPY_OFFSET) current = i;
      });
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  if (labels.length < 2) return null;

  return (
    <nav
      aria-label="Casas na listagem"
      // Colado à esquerda do conteúdo (max-w-6xl = 72rem); só cabe na margem a partir de 2xl.
      className="fixed top-36 bottom-14 left-[calc(50%-36rem-11.5rem)] z-30 hidden w-44 flex-col rounded-lg border border-border bg-card/90 shadow-sm backdrop-blur 2xl:flex"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        Casas
        <span className="ml-auto tabular-nums">{labels.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {labels.map((label, i) => (
          <li key={`${i}|${label}`}>
            <button
              type="button"
              title={label}
              aria-current={i === active ? "location" : undefined}
              onClick={() =>
                elsRef.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={cn(
                "block w-full truncate border-l-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-foreground",
                i === active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

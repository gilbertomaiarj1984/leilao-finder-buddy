import { useEffect, useRef } from "react";

// Faixa (px) junto à borda da janela em que o arrastar rola a página, e velocidade máxima
// (px por quadro) quando o ponteiro encosta na borda.
const EDGE = 90;
const MAX_STEP = 22;

/**
 * Rola a janela sozinha enquanto um arrastar (HTML5 drag-and-drop) está perto do topo/rodapé,
 * para alcançar outros artistas fora da tela. `start()` no `dragstart`; para sozinho no
 * `dragend`/`drop` (ouvidos na janela, pois o elemento de origem pode ser remontado no meio
 * do arrastar) e ao desmontar.
 */
export function useDragAutoScroll() {
  const cleanup = useRef<(() => void) | null>(null);

  const stop = () => {
    cleanup.current?.();
    cleanup.current = null;
  };

  const start = () => {
    stop();
    let y = -1;
    let raf = 0;
    const onOver = (e: DragEvent) => {
      y = e.clientY;
    };
    const tick = () => {
      const h = window.innerHeight;
      if (y >= 0) {
        if (y < EDGE) window.scrollBy(0, -Math.ceil(MAX_STEP * (1 - Math.max(y, 0) / EDGE)));
        else if (y > h - EDGE)
          window.scrollBy(0, Math.ceil(MAX_STEP * (1 - Math.max(h - y, 0) / EDGE)));
      }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    raf = requestAnimationFrame(tick);
    cleanup.current = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };
  };

  useEffect(() => stop, []);
  return { start, stop };
}

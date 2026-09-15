import { useEffect, useRef, useState } from "react";

/**
 * Detecta a direção do scroll da janela para esconder barras fixas ao descer
 * (ganhar espaço de tela no celular) e trazê-las de volta ao subir.
 * `threshold` evita flicker com micro-scrolls (ex.: bounce do iOS); `minFlipMs`
 * trava novas trocas de estado por um tempo mínimo após cada uma, para não
 * alternar rápido demais perto do limiar (barra "piscando").
 */
export function useHideOnScroll(threshold = 8, minFlipMs = 350) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const hiddenRef = useRef(false);
  const lastFlipAt = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const diff = y - lastY.current;
        const now = performance.now();

        if (y <= 0) {
          if (hiddenRef.current) {
            hiddenRef.current = false;
            lastFlipAt.current = now;
            setHidden(false);
          }
          lastY.current = y;
        } else if (Math.abs(diff) > threshold && now - lastFlipAt.current > minFlipMs) {
          const next = diff > 0;
          if (next !== hiddenRef.current) {
            hiddenRef.current = next;
            lastFlipAt.current = now;
            setHidden(next);
          }
          lastY.current = y;
        }
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, minFlipMs]);

  return hidden;
}

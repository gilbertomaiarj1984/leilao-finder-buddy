import { useEffect, useRef, useState } from "react";

/**
 * Detecta a direção do scroll da janela para esconder barras fixas ao descer
 * (ganhar espaço de tela no celular) e trazê-las de volta ao subir.
 * `threshold` evita flicker com micro-scrolls (ex.: bounce do iOS).
 */
export function useHideOnScroll(threshold = 8) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const diff = y - lastY.current;
        if (y <= 0) {
          setHidden(false);
          lastY.current = y;
        } else if (Math.abs(diff) > threshold) {
          setHidden(diff > 0);
          lastY.current = y;
        }
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}

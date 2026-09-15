import { useEffect, useRef, useState } from "react";

/**
 * Detecta a direção do scroll da janela para esconder barras fixas ao descer
 * (ganhar espaço de tela no celular) e trazê-las de volta ao subir.
 * `threshold` evita flicker com micro-scrolls (ex.: bounce do iOS).
 *
 * `cooldownMs` é o pulo do gato: depois de cada troca de estado, a barra fica
 * animando por `TRANSITION_MS` (ver `hideable-bar.tsx`) — um `sticky` mudando
 * de altura durante a transição pode gerar eventos de scroll "fantasma"
 * (recálculo do navegador, scroll anchoring residual mesmo com
 * `overflow-anchor:none`). Se esse ruído fosse CONTADO, ele se acumularia em
 * `lastY` e, assim que o cadeado de tempo destravasse, disparava um novo flip
 * na hora — vira um vaivém sem fim ("piscando"). Por isso, durante o
 * cooldown, todo scroll só REALINHA `lastY` (`lastY.current = y`) sem nunca
 * contar para a decisão de direção — o ruído da própria transição é
 * descartado, não acumulado. Só depois do cooldown a próxima decisão parte de
 * uma base limpa, exigindo movimento novo e real do usuário.
 */
export function useHideOnScroll(threshold = 8, cooldownMs = 400) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const hiddenRef = useRef(false);
  const cooldownUntil = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const now = performance.now();

        if (now < cooldownUntil.current) {
          lastY.current = y;
          ticking = false;
          return;
        }

        const diff = y - lastY.current;

        if (y <= 0) {
          if (hiddenRef.current) {
            hiddenRef.current = false;
            cooldownUntil.current = now + cooldownMs;
            setHidden(false);
          }
          lastY.current = y;
        } else if (Math.abs(diff) > threshold) {
          const next = diff > 0;
          if (next !== hiddenRef.current) {
            hiddenRef.current = next;
            cooldownUntil.current = now + cooldownMs;
            setHidden(next);
          }
          lastY.current = y;
        }
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, cooldownMs]);

  return hidden;
}

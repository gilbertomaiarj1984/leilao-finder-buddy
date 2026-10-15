import { useState, type DragEvent } from "react";

/**
 * Reordenação por arrastar e soltar (HTML5 nativo, o mesmo padrão do resto do app). `item(id, i)`
 * devolve as props do elemento arrastável; `before(i)` diz se a linha de inserção vai antes do item
 * `i` (use `before(lista.length)` para a marca no fim da lista).
 */
export function useListDnd(onMove: (id: string, toIndex: number) => void) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => {
    setDrag(null);
    setOver(null);
  };
  return {
    drag,
    before: (index: number) => drag !== null && over === index,
    item: (id: string, index: number) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        setDrag(id);
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", id);
        } catch {
          /* alguns navegadores recusam; o estado local basta */
        }
      },
      onDragEnd: reset,
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (drag === null) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setOver(e.clientY < r.top + r.height / 2 ? index : index + 1);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (drag !== null && over !== null) onMove(drag, over);
        reset();
      },
    }),
  };
}

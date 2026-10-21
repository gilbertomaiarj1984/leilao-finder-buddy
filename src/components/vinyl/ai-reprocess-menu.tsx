import { useState, type ReactNode } from "react";
import { ImageIcon, Lightbulb, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type AiReprocessMode = "image" | "text";

/**
 * Menu "Atualizar pela IA com base…" — o MESMO da Coleção, usado em todo lugar que roda a IA num
 * disco/lote: 1 · na imagem da capa (desabilitada sem capa), 2 · só no texto (nome/título),
 * 3 · com uma dica livre (prioridade máxima; "Usar também a capa" escolhe entre os dois modos).
 * O `trigger` é o botão que abre; `onPick` recebe o modo e, na opção 3, a dica.
 */
export function AiReprocessPopover({
  trigger,
  hasImage,
  textLabel = "No nome do artista e do álbum",
  onPick,
  onOpenChange,
  align = "end",
}: {
  trigger: ReactNode;
  hasImage: boolean;
  /** Rótulo da opção 2 (na Coleção é o nome do artista/álbum; no lote, o título). */
  textLabel?: string;
  onPick: (mode: AiReprocessMode, hint?: string) => void;
  /** Avisa quando o menu abre/fecha (o card flutuante da Coleção se mantém aberto enquanto isso). */
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpenState] = useState(false);
  const [hint, setHint] = useState("");
  const [hintWithImage, setHintWithImage] = useState(true);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const pick = (mode: AiReprocessMode, h?: string) => {
    setOpen(false);
    onPick(mode, h);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-1.5rem)] space-y-1 p-2"
        // O clique dentro do menu não deve acionar a linha/card que o contém.
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
          Atualizar pela IA com base…
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left"
          disabled={!hasImage}
          title={hasImage ? undefined : "Sem capa disponível"}
          onClick={() => pick("image")}
        >
          <ImageIcon className="h-4 w-4 shrink-0" />
          <span>1 · Na imagem da capa</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 whitespace-normal py-2 text-left"
          onClick={() => pick("text")}
        >
          <Type className="h-4 w-4 shrink-0" />
          <span>2 · {textLabel}</span>
        </Button>
        <div className="space-y-2 border-t border-border px-2 pb-1 pt-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4 shrink-0" />3 · Com uma dica minha
          </p>
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder='Ex.: LP de 1979, selo Philips, tem a faixa "Sampa"…'
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {hasImage ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={hintWithImage}
                onChange={(e) => setHintWithImage(e.target.checked)}
              />
              Usar também a capa
            </label>
          ) : null}
          <Button
            size="sm"
            className="w-full"
            disabled={!hint.trim()}
            onClick={() => pick(hasImage && hintWithImage ? "image" : "text", hint.trim())}
          >
            Identificar com a dica
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

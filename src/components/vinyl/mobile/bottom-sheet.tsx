import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Folha deslizante de baixo (celular). Radix Dialog por baixo (foco, Esc, aria); `full` ocupa a
 * tela toda (cartão aberto do lote). Só é montada na interface mobile.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  full = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={description ? undefined : (undefined as string | undefined)}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            full ? "top-0" : "max-h-[88vh] rounded-t-2xl border-t border-border",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {full ? null : (
            <div
              className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-border"
              aria-hidden
            />
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

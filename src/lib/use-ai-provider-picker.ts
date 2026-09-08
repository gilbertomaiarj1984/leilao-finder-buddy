/**
 * Hook do "escolher provedor antes de processar" (client-safe). Guarda o estado do diálogo e
 * uma promessa: `pickProvider()` abre o diálogo e resolve com o provedor escolhido — ou `null`
 * se o usuário cancelar. `dialogProps` é espalhado no `<AiProviderDialog>`.
 *
 * Uso:
 *   const picker = useAiProviderPicker(defaultProvider);
 *   ... <AiProviderDialog {...picker.dialogProps} /> ...
 *   const provider = await picker.pickProvider();
 *   if (!provider) return; // cancelado
 */
import { useCallback, useRef, useState } from "react";

import type { AiProvider } from "./ai-provider";

export function useAiProviderPicker(defaultProvider: AiProvider) {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((provider: AiProvider | null) => void) | null>(null);

  const settle = useCallback((provider: AiProvider | null) => {
    setOpen(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(provider);
  }, []);

  const pickProvider = useCallback(
    () =>
      new Promise<AiProvider | null>((resolve) => {
        // Se já houver um pedido aberto, cancela o anterior antes de abrir o novo.
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setOpen(true);
      }),
    [],
  );

  return {
    pickProvider,
    dialogProps: {
      open,
      defaultProvider,
      onPick: (provider: AiProvider) => settle(provider),
      onCancel: () => settle(null),
    },
  };
}

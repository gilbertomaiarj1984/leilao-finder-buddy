import { APP_VERSION } from "@/lib/version";

/**
 * Rodapé global exibido em todas as telas (montado no `__root.tsx`).
 * Mostra a versão atual do app (fonte única em `src/lib/version.ts`) para
 * acompanhar em produção qual versão está no ar.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
        <span>Garimpo de Vinil</span>
        <span className="font-mono" title="Versão do aplicativo">
          v{APP_VERSION}
        </span>
      </div>
    </footer>
  );
}

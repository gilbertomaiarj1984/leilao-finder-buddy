import { APP_VERSION } from "@/lib/version";

/**
 * Rodapé global exibido em todas as telas (montado no `__root.tsx`).
 * Mostra a versão atual do app (fonte única em `src/lib/version.ts`) para
 * acompanhar em produção qual versão está no ar.
 *
 * Fica fixo na base da janela (`fixed`), sempre visível independentemente da
 * rolagem, para que a versão em produção esteja sempre à vista. O layout do
 * `__root.tsx` reserva espaço equivalente (`pb-*`) para o conteúdo não ficar
 * escondido atrás dele.
 */
export function Footer() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-2 text-xs text-muted-foreground">
        <span className="shrink-0">Garimpo de Vinil</span>
        {/* Alvo (via portal) para controles específicos da tela atual — ex.: o modo da
        IA/provedor/"Atualizar tudo" na tela inicial (ver `footerExtraHost` em index.tsx). */}
        <div id="footer-extra" className="flex shrink-0 items-center gap-2" />
        <span className="ml-auto shrink-0 font-mono" title="Versão do aplicativo">
          v{APP_VERSION}
        </span>
      </div>
    </footer>
  );
}

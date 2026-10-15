import { AiModeSelect, AiModelSelect } from "@/components/vinyl/ai-provider-controls";

/**
 * Modo e modelo da IA (antes ficavam no rodapé da tela inicial). Cada controle grava na hora, no
 * servidor — não passa pelo botão «Salvar» do painel (que cuida de blocos, condições e frete).
 */
export function ModelTab() {
  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Avaliação automática
        </h2>
        <AiModeSelect />
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            <b>Desligada</b>: o cron não avalia nada. Os botões de análise sob demanda seguem
            funcionando.
          </li>
          <li>
            <b>Tudo</b>: avalia todos os lotes novos (maior gasto de créditos).
          </li>
          <li>
            <b>Vigiados + lances</b>: avalia só o que você acompanha (padrão, mais econômico).
          </li>
        </ul>
      </section>

      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          IA e modelo
        </h2>
        <AiModelSelect />
        <p className="mt-3 text-xs text-muted-foreground">
          Vale para todo o site: avaliação, identificação, estado, Coleção e Vinil Analytics. Os
          preços mostrados são em US$ por 1M de tokens (entrada/saída). Se um provedor ficar sem
          créditos ou indisponível, o app troca para o outro automaticamente. Claude usa Batches
          (assíncrono, mais barato) no cron; Gemini roda síncrono.
        </p>
      </section>
    </div>
  );
}

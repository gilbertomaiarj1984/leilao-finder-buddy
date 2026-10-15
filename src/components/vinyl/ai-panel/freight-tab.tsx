import { Input } from "@/components/ui/input";
import type { PanelConfig } from "@/lib/ai-panel-config";
import { COND_KEYS, type CondKey } from "@/lib/discogs-price";

type Props = { draft: PanelConfig; setDraft: (fn: (d: PanelConfig) => PanelConfig) => void };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function FreightTab({ draft, setDraft }: Props) {
  const price = 40;
  const num = (v: string) => Math.max(0, Math.min(500, Number(v) || 0));
  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Frete do leilão
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          As casas brasileiras sempre cobram frete. Ele é somado ao valor do lote antes de comparar
          com o preço do Discogs, sempre em reais.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Sudeste (SP, RJ, MG, ES) — R$
            <Input
              type="number"
              min={0}
              max={500}
              value={draft.freight.sudeste}
              onChange={(e) =>
                setDraft((d) => ({ ...d, freight: { ...d.freight, sudeste: num(e.target.value) } }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Demais regiões e UF desconhecida — R$
            <Input
              type="number"
              min={0}
              max={500}
              value={draft.freight.outras}
              onChange={(e) =>
                setDraft((d) => ({ ...d, freight: { ...d.freight, outras: num(e.target.value) } }))
              }
            />
          </label>
        </div>
        <p className="mt-3 rounded bg-secondary/50 p-2 font-mono text-xs">
          lote {brl(price)} + frete Sudeste {brl(draft.freight.sudeste)} ={" "}
          {brl(price + draft.freight.sudeste)}
          <br />
          lote {brl(price)} + frete demais regiões {brl(draft.freight.outras)} ={" "}
          {brl(price + draft.freight.outras)}
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sem estado informado
        </h2>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Condição do Discogs usada como referência
          <select
            className="h-9 max-w-40 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={draft.defaultCond}
            onChange={(e) => setDraft((d) => ({ ...d, defaultCond: e.target.value as CondKey }))}
          >
            {COND_KEYS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Vale quando o lote não traz o estado do disco. O padrão é G+ (conservador: evita chamar de
          barato um disco de estado desconhecido).
        </p>
      </section>
    </div>
  );
}

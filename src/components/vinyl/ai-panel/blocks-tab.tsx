import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { buildLotContext, contextForPrompt } from "@/lib/ai-context";
import {
  CONTEXT_BLOCK_IDS,
  CONTEXT_BLOCK_NAMES,
  CONTEXT_FIELDS,
  fieldOn,
  type ContextBlockId,
  type PanelConfig,
} from "@/lib/ai-panel-config";

import { useListDnd } from "./use-list-dnd";

type Props = { draft: PanelConfig; setDraft: (fn: (d: PanelConfig) => PanelConfig) => void };

const BLOCK_SRC: Record<ContextBlockId, string> = {
  estado: "lot_condition (lido da descrição do lote)",
  mercado: "lot_market.suggested_by_condition (preço sugerido do Discogs, em reais)",
  frete: "frete estimado da casa pela UF (Sudeste ou demais regiões)",
  descricao: "lot_condition.description (texto do catálogo da casa, até 600 caracteres)",
};

/**
 * Blocos que ainda NÃO entram no prompt: mostrados como «em breve», com o que falta para ativar.
 * `recommended: false` = existe a ideia, mas hoje não vale o custo/complexidade.
 */
const PLANNED_BLOCKS: {
  id: string;
  name: string;
  src: string;
  missing: string;
  recommended: boolean;
}[] = [
  {
    id: "vendas",
    name: "Vendas passadas do mesmo disco",
    src: "lot_sales",
    missing:
      "Casar o histórico de vendas ao álbum identificado (artista + álbum normalizados, ignorando kits de vários discos) e mandar menor, mediana e maior preço em reais.",
    recommended: true,
  },
  {
    id: "colecionador",
    name: "Perfil do colecionador",
    src: "interesses · sondagem · coleção",
    missing:
      "Mandar só o resultado do casamento de cada lote (está nos interesses, casa com a sondagem, já tenho), nunca as listas inteiras.",
    recommended: true,
  },
  {
    id: "tracklist",
    name: "Tracklist e fama das faixas",
    src: "lot_ai.tracklist",
    missing:
      "Não recomendado: depende do álbum que a própria avaliação grava (circular) e custa de 150 a 400 tokens por lote.",
    recommended: false,
  },
  {
    id: "correcoes",
    name: "Correções do usuário",
    src: "ajustes manuais de identificação",
    missing:
      "Não recomendado agora: quase sempre vazio e mais útil para identificar o disco do que para a nota.",
    recommended: false,
  },
];

// Lotes de exemplo só para o preview do prompt (não são dados reais).
const SAMPLES = [
  {
    label: "Gilberto Gil · Raça Humana",
    title: "GILBERTO GIL - RAÇA HUMANA LP",
    price: 40,
    uf: "SP",
    condition: {
      media: "VG+",
      sleeve: "VG+",
      insert_state: "sim",
      score: 78,
      description:
        "GILBERTO GIL - RAÇA HUMANA - LP 1984 WEA, capa VG+, disco VG+/NM, com encarte. Prensagem original brasileira.",
    },
    market: {
      matched: true,
      year: 1984,
      num_for_sale: 12,
      have: 3200,
      want: 1100,
      suggested_by_condition: { M: 74.07, NM: 66.27, "VG+": 50.68, VG: 35.09, "G+": 22.4 },
    },
  },
  {
    label: "Tim Maia · Racional (sem estado, BA)",
    title: "TIM MAIA RACIONAL VOL 1 LP",
    price: 400,
    uf: "BA",
    condition: null,
    market: {
      matched: true,
      year: 1975,
      num_for_sale: 4,
      have: 1800,
      want: 3900,
      suggested_by_condition: { NM: 780, "VG+": 520, VG: 380, "G+": 250 },
    },
  },
  {
    label: "Roberto Carlos · compacto (sem Discogs)",
    title: "ROBERTO CARLOS COMPACTO 1971",
    price: 15,
    uf: "RJ",
    condition: { media: "VG", sleeve: "G+", insert_state: "", score: 55 },
    market: null,
  },
] as const;

export function BlocksTab({ draft, setDraft }: Props) {
  const [sel, setSel] = useState<ContextBlockId>("mercado");
  const [sample, setSample] = useState(0);

  const move = (id: string, to: number) =>
    setDraft((d) => {
      const blocks = d.blocks.filter((b) => b !== id);
      const i = d.blocks.indexOf(id as ContextBlockId);
      blocks.splice(i > -1 && i < to ? to - 1 : to, 0, id as ContextBlockId);
      return { ...d, blocks };
    });
  const dnd = useListDnd(move);
  const off = CONTEXT_BLOCK_IDS.filter((b) => !draft.blocks.includes(b));
  const swap = (id: ContextBlockId, delta: number) =>
    setDraft((d) => {
      const blocks = [...d.blocks];
      const i = blocks.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= blocks.length) return d;
      [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!];
      return { ...d, blocks };
    });
  const toggleField = (block: ContextBlockId, key: string, on: boolean) =>
    setDraft((d) => {
      const id = `${block}.${key}`;
      const hidden = d.hiddenFields.filter((f) => f !== id);
      return { ...d, hiddenFields: on ? hidden : [...hidden, id] };
    });

  const preview = useMemo(() => {
    const s = SAMPLES[sample]!;
    const ctx = buildLotContext({ condition: s.condition, market: s.market, uf: s.uf }, draft);
    const obj = {
      titulo: s.title,
      preco_reais: s.price,
      contexto: contextForPrompt(ctx, s.price, draft),
    };
    const text = JSON.stringify(obj, null, 2);
    return { text, tokens: Math.ceil(text.length / 3.3) };
  }, [draft, sample]);

  const B = sel;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contexto do lote no prompt — arraste para ordenar
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">
            O título, a casa, o preço e a capa sempre vão. Estes blocos entram abaixo, na ordem da
            lista. Dado que o lote não tem simplesmente não aparece.
          </p>
          <div className="space-y-1.5" onDragOver={(e) => dnd.drag && e.preventDefault()}>
            {draft.blocks.map((id, i) => (
              <div
                key={id}
                {...dnd.item(id, i)}
                className={`flex cursor-grab items-center gap-2 rounded border bg-secondary/40 px-2 py-2 ${
                  sel === id ? "border-primary" : "border-border"
                } ${dnd.before(i) ? "shadow-[0_-3px_0_0_var(--color-primary)]" : ""} ${
                  dnd.drag === id ? "opacity-40" : ""
                }`}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSel(id)}
                >
                  <span className="block text-sm font-semibold">{CONTEXT_BLOCK_NAMES[id]}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {BLOCK_SRC[id]}
                  </span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === 0}
                  onClick={() => swap(id, -1)}
                  aria-label="Subir"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === draft.blocks.length - 1}
                  onClick={() => swap(id, 1)}
                  aria-label="Descer"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    setDraft((d) => ({ ...d, blocks: d.blocks.filter((b) => b !== id) }))
                  }
                  aria-label="Tirar do prompt"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className={`h-1 rounded ${dnd.before(draft.blocks.length) ? "bg-primary" : ""}`} />
            {!draft.blocks.length ? (
              <p className="text-xs text-muted-foreground">
                Nenhum bloco ligado: a IA avalia só com título, casa, preço e capa.
              </p>
            ) : null}
          </div>
          {off.length ? (
            <div className="mt-3 border-t border-dashed border-border pt-2">
              <p className="mb-1 text-[11px] text-muted-foreground">Fora do prompt</p>
              <div className="flex flex-wrap gap-2">
                {off.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft((d) => ({ ...d, blocks: [...d.blocks, id] }));
                      setSel(id);
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {CONTEXT_BLOCK_NAMES[id]}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Em breve — ainda não entram no prompt
          </h2>
          <div className="space-y-1.5">
            {PLANNED_BLOCKS.map((b) => (
              <div
                key={b.id}
                className="rounded border border-dashed border-border bg-secondary/20 px-2 py-2 opacity-90"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{b.name}</span>
                  <span
                    className={`rounded-full border px-1.5 text-[10px] ${
                      b.recommended
                        ? "border-amber-500/60 text-amber-600 dark:text-amber-400"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {b.recommended ? "em breve" : "por ora não"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{b.src}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.missing}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Quando um deles ficar pronto, aparece aqui na lista de blocos para você ligar, ordenar e
            escolher os campos.
          </p>
        </section>

        <section className="rounded-md border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Campos de «{CONTEXT_BLOCK_NAMES[B]}»
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {CONTEXT_FIELDS[B].map((f) => {
              const on = fieldOn(draft, B, f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleField(B, f.key, !on)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    on
                      ? "border-border bg-secondary"
                      : "border-dashed border-border text-muted-foreground"
                  }`}
                  title={on ? "Clique para tirar do prompt" : "Clique para voltar ao prompt"}
                >
                  {on ? "" : "+ "}
                  {f.label}
                  {on ? " ×" : ""}
                </button>
              );
            })}
          </div>
          {B === "mercado" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Preços do Discogs em reais; só valores em BRL entram. A condição de referência é a do
              disco do lote e, sem estado, a padrão (aba «Frete e padrões»).
            </p>
          ) : null}
        </section>
      </div>

      <section className="min-w-0 rounded-md border border-border bg-card p-3 lg:sticky lg:top-20 lg:self-start">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Prévia do que a IA recebe
        </h2>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SAMPLES.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setSample(i)}
              aria-pressed={sample === i}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                sample === i ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded bg-secondary/50 p-2 font-mono text-[11px] leading-relaxed">
          {preview.text}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          ≈ {preview.tokens} tokens por lote só neste trecho. Dados de exemplo. As mudanças valem
          para as próximas avaliações; a base já avaliada só é refeita ao subir a versão do prompt.
        </p>
      </section>
    </div>
  );
}

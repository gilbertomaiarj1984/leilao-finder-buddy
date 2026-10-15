import { useMemo, useState, type DragEvent } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PanelConfig } from "@/lib/ai-panel-config";
import {
  effectiveTextRules,
  matchTextRules,
  TEXT_RULES,
  VOCABULARY_TERMS,
  type UserTextRule,
} from "@/lib/condition-text";
import { gradeToCondKey, type CondKey } from "@/lib/discogs-price";
import {
  GRADE_ORDER,
  normalizeGrade,
  parseConditionFromText,
  scoreCondition,
  type Grade,
} from "@/lib/grading";

type Props = { draft: PanelConfig; setDraft: (fn: (d: PanelConfig) => PanelConfig) => void };

/** Colunas = condições do Discogs; F e P viram uma só (o app trata F/P como um grau). */
const COLS: { key: CondKey; label: string; grade: Grade }[] = [
  { key: "M", label: "M · Mint", grade: "M" },
  { key: "NM", label: "NM · Near Mint", grade: "NM" },
  { key: "VG+", label: "VG+ · Muito bom +", grade: "VG+" },
  { key: "VG", label: "VG · Muito bom", grade: "VG" },
  { key: "G+", label: "G+ · Bom +", grade: "G+" },
  { key: "G", label: "G · Bom", grade: "G" },
  { key: "F", label: "F/P · Ruim", grade: "F/P" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function EffectTag({ effect }: { effect: "set" | "cap" }) {
  return (
    <span
      className={`rounded-full border px-1.5 text-[10px] ${
        effect === "cap"
          ? "border-amber-500/60 text-amber-600 dark:text-amber-400"
          : "border-border text-muted-foreground"
      }`}
      title={
        effect === "cap"
          ? "Limita o disco a esta condição (defeito que afeta a audição)"
          : "Define o estado quando o texto não traz Disco e Capa com grau"
      }
    >
      {effect === "cap" ? "limita" : "define"}
    </span>
  );
}

export function CorrelTab({ draft, setDraft }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<CondKey | null>(null);
  const [phrase, setPhrase] = useState("");
  const [grade, setGrade] = useState<Grade>("G+");
  const [effect, setEffect] = useState<"set" | "cap">("set");
  const [test, setTest] = useState(
    "LP Gilberto Gil | Em ótimo estado, mas com riscos que podem afetar a audição",
  );

  const vocab = useMemo(() => {
    const by = new Map<CondKey, string[]>();
    for (const t of VOCABULARY_TERMS) {
      const k = gradeToCondKey(normalizeGrade(t));
      if (!k) continue;
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return by;
  }, []);

  const result = useMemo(() => {
    const rules = effectiveTextRules(draft.rules, draft.disabledRules);
    const cond = parseConditionFromText(test, rules);
    const hits = matchTextRules(fold(test), rules);
    const mirrored = scoreCondition(cond.media, cond.sleeve).media;
    return { cond, hits, discogs: gradeToCondKey(mirrored) };
  }, [test, draft.rules, draft.disabledRules]);

  const dropOn = (col: (typeof COLS)[number]) => (e: DragEvent) => {
    e.preventDefault();
    if (dragId) {
      setDraft((d) => ({
        ...d,
        rules: d.rules.map((r) => (r.id === dragId ? { ...r, grade: col.grade } : r)),
      }));
    }
    setDragId(null);
    setOverCol(null);
  };
  const addRule = () => {
    const p = phrase.trim();
    if (p.length < 3) return;
    const rule: UserTextRule = { id: `u${Date.now().toString(36)}`, phrase: p, grade, effect };
    setDraft((d) => ({ ...d, rules: [...d.rules, rule] }));
    setPhrase("");
  };
  const colOf = (g: Grade) => gradeToCondKey(g) ?? "F";

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Como o vocabulário dos leilões vira condição do Discogs. Arraste suas expressões para a
        coluna certa; as do app (cinza) podem ser desligadas. O mesmo resultado vale para o estado
        mostrado nos cards e para o preço de referência.
      </p>

      <section className="rounded-md border border-border bg-card p-3">
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-7 gap-2">
            {COLS.map((col) => (
              <div
                key={col.key}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    setOverCol(col.key);
                  }
                }}
                onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                onDrop={dropOn(col)}
                className={`min-h-40 rounded border p-2 ${
                  overCol === col.key ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <h3 className="mb-2 text-xs font-bold text-primary">{col.label}</h3>
                <div className="space-y-1">
                  {draft.rules
                    .filter((r) => colOf(r.grade) === col.key)
                    .map((r) => (
                      <div
                        key={r.id}
                        draggable
                        onDragStart={(e) => {
                          setDragId(r.id);
                          e.dataTransfer.effectAllowed = "move";
                          try {
                            e.dataTransfer.setData("text/plain", r.id);
                          } catch {
                            /* ignorado */
                          }
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverCol(null);
                        }}
                        className="flex cursor-grab flex-wrap items-center gap-1 rounded border border-border bg-secondary/60 px-1.5 py-1 text-xs"
                      >
                        <span className="min-w-[5rem] flex-1 break-words">{r.phrase}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              rules: d.rules.map((x) =>
                                x.id === r.id
                                  ? { ...x, effect: x.effect === "cap" ? "set" : "cap" }
                                  : x,
                              ),
                            }))
                          }
                        >
                          <EffectTag effect={r.effect} />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remover ${r.phrase}`}
                          onClick={() =>
                            setDraft((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }))
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  {TEXT_RULES.filter((r) => colOf(r.grade) === col.key).map((r) => {
                    const off = draft.disabledRules.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            disabledRules: off
                              ? d.disabledRules.filter((x) => x !== r.id)
                              : [...d.disabledRules, r.id],
                          }))
                        }
                        title={
                          off ? "Desligada — clique para ligar" : "Do app — clique para desligar"
                        }
                        className={`flex w-full flex-wrap items-center gap-1 rounded border border-dashed border-border px-1.5 py-1 text-left text-xs text-muted-foreground ${
                          off ? "line-through opacity-50" : ""
                        }`}
                      >
                        <span className="min-w-[5rem] flex-1 break-words">{r.label}</span>
                        <EffectTag effect={r.effect} />
                      </button>
                    );
                  })}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(vocab.get(col.key) ?? []).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title="Termo que o sistema já reconhece como grau"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Termos em cinza arredondado: siglas e palavras que o sistema já entende como grau (bom,
          muito bom, excelente, regular, ótimo, lacrado…). Valem depois de «Disco», «Capa» ou
          «Estado»; «lacrado», «mint» e «near mint» valem também soltos. Linhas tracejadas:
          expressões do app. <b>define</b>: fixa o estado quando o texto não traz Disco e Capa com
          grau. <b>limita</b>: rebaixa o disco mesmo com outro grau no texto. «sem» ou «não» antes
          anula; a vírgula encerra o alcance.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Nova expressão (use * para um trecho variável)
            <Input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRule()}
              placeholder="ex.: riscos * audição"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Condição
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={grade}
              onChange={(e) => setGrade(e.target.value as Grade)}
            >
              {GRADE_ORDER.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Efeito
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={effect}
              onChange={(e) => setEffect(e.target.value as "set" | "cap")}
            >
              <option value="set">define o estado</option>
              <option value="cap">limita o disco</option>
            </select>
          </label>
          <Button variant="outline" onClick={addRule} disabled={phrase.trim().length < 3}>
            Adicionar
          </Button>
        </div>
      </section>

      <section className="max-w-3xl rounded-md border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Testar com uma descrição
        </h2>
        <textarea
          value={test}
          onChange={(e) => setTest(e.target.value)}
          aria-label="Descrição do lote para testar"
          className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
        />
        <div className="mt-2 space-y-1 text-sm">
          {result.hits.length ? (
            result.hits.map((h) => (
              <div key={h.rule.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">«{h.rule.label}»</span>
                <EffectTag effect={h.rule.effect} />
                <span className="text-muted-foreground">{h.rule.grade}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma expressão encontrada.</p>
          )}
          <p className="pt-1">
            Disco <b>{result.cond.media ?? "—"}</b> · Capa <b>{result.cond.sleeve ?? "—"}</b> ·
            condição no Discogs <b>{result.discogs ?? `padrão (${draft.defaultCond})`}</b>
          </p>
        </div>
      </section>
    </div>
  );
}
